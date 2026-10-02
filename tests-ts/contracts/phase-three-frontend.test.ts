import { describe, expect, test } from 'bun:test'
import { consumeInterviewStream, consumeIndexRebuildStream, decodeCopilotEvent } from '../../frontend/src/api/events.ts'
import { consumeSSE } from '../../frontend/src/api/sse.ts'
import { loadTextFixture } from './fixture.ts'

function response(text: string, split = 1, keepOpen = false) {
  const bytes = new TextEncoder().encode(text)
  let position = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position < bytes.length) { controller.enqueue(bytes.slice(position, position + split)); position += split }
      else if (!keepOpen) controller.close()
    },
    cancel() { cancelled = true },
  })
  return { res: new Response(body), body, get cancelled() { return cancelled } }
}

describe('typed frontend stream consumers', () => {
  test('validates every Copilot fixture including legacy and model extension fields', async () => {
    for (const name of ['events', 'compatibility-events']) {
      const fixture = JSON.parse(await loadTextFixture(`copilot/${name}.json`)) as unknown[]
      expect<unknown>(fixture.map((event) => decodeCopilotEvent(JSON.stringify(event)))).toEqual(fixture)
    }
    for (const raw of ['not JSON', 'null', '[]', '{"type":"unknown"}', '{"type":"answer_chunk","text":1}', '{"type":"monitor_update","covered_topics":"PRIVATE-DATA"}', new ArrayBuffer(4)]) {
      expect(() => decodeCopilotEvent(raw)).toThrow('Invalid Copilot event')
    }
    const event = decodeCopilotEvent('{"type":"answer_chunk","text":"你好"}')
    // The union narrows to a concrete string payload without casts/coercion.
    if (event.type === 'answer_chunk') expect(event.text.toUpperCase()).toBe('你好')
  })

  test('parses fragmented UTF-8, CRLF, comments and multi-line data without losing tokens', async () => {
    const h = response(': heartbeat\r\n\r\nevent: message\r\ndata:{"token":\r\ndata: "你好🙂"}\r\n\r\ndata: {"done":true,"is_finished":false}\r\n\r\n', 1, true)
    const tokens: string[] = []
    const completed: unknown[] = []
    await consumeInterviewStream(h.res, { onToken: (text) => tokens.push(text), onDone: (event) => completed.push(event) })
    expect(tokens).toEqual(['你好🙂'])
    expect(completed).toEqual([{ done: true, is_finished: false }])
    expect(h.cancelled).toBeTrue()
    expect(h.body.locked).toBeFalse()
  })

  test('handles multiple frames in one network chunk and empty tokens', async () => {
    const h = response('data: {"token":""}\n\ndata: {"token":"下一句"}\n\ndata: {"done":true,"is_finished":true}\n\n', 4096)
    const received: string[] = []
    let finished = false
    await consumeInterviewStream(h.res, { onToken: (text) => received.push(text), onDone: (event) => { finished = event.is_finished } })
    expect(received).toEqual(['', '下一句'])
    expect(finished).toBeTrue()
    expect(h.body.locked).toBeFalse()
  })

  test('reports malformed events, truncation and missing completion once and releases readers', async () => {
    for (const text of ['data: not-json\n\n', 'data: {"token":3}\n\n', 'data: {"done":false}\n\n', 'data: {"token":"x"}\n\n', 'data: {"done":true,"is_finished":true}', '']) {
      const h = response(text)
      const errors: Error[] = []
      let completed = false
      await consumeInterviewStream(h.res, { onError: (error) => errors.push(error), onDone: () => { completed = true } })
      expect(errors).toHaveLength(1)
      expect(completed).toBeFalse()
      expect(h.body.locked).toBeFalse()
    }
    await expect(consumeInterviewStream(new Response(null), {})).rejects.toThrow('Missing event stream')
  })

  test('surfaces server errors and consumer exceptions rather than swallowing them as bad JSON', async () => {
    const h = response('data: {"token":"有效片段"}\n\n', 100, true)
    await expect(consumeSSE(h.res, (value) => value, () => { throw new Error('consumer failure') })).rejects.toThrow('consumer failure')
    expect(h.cancelled).toBeTrue()
    expect(h.body.locked).toBeFalse()
    const errorStream = response('data: {"error":"模型不可用"}\n\n', 100, true)
    await expect(consumeInterviewStream(errorStream.res, {})).rejects.toThrow('模型不可用')
    expect(errorStream.cancelled).toBeTrue()
    const callback = response('data: {"token":"x"}\n\n', 100, true)
    const errors: string[] = []
    await consumeInterviewStream(callback.res, { onToken() { throw new Error('view failure') }, onError(error) { errors.push(error.message) } })
    expect(errors).toEqual(['view failure'])
  })

  test('reports read failures and releases the reader', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('network failure')) } })
    await expect(consumeInterviewStream(new Response(body), {})).rejects.toThrow('network failure')
    expect(body.locked).toBeFalse()
  })

  test('keeps rebuild step errors nonterminal and routes done/fatal to the right callbacks', async () => {
    const step = { completed: 1, total: 2, label: '步骤', status: 'error', error: '局部失败' }
    const done = { done: true, rebuilt: { weak_points: false, personal_documents: false, topics: [] }, last_rebuild_at: '' }
    const h = response([step, done].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    const progress: unknown[] = []
    const completions: unknown[] = []
    await consumeIndexRebuildStream(h.res, { onProgress: (event) => progress.push(event), onDone: (event) => completions.push(event) })
    expect(progress).toEqual([step])
    expect(completions).toEqual([done])
    const errors: string[] = []
    await consumeIndexRebuildStream(response('data: {"fatal":true,"error":"整体失败"}\n\n').res, { onError: (error) => errors.push(error.message) })
    expect(errors).toEqual(['整体失败'])
    await expect(consumeIndexRebuildStream(response('data: {"completed":"1"}\n\n').res, {})).rejects.toThrow('Invalid index rebuild event')
  })
})
