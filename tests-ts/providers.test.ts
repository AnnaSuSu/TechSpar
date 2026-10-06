import { describe, expect, test } from 'bun:test'
import { DEFAULT_EMBEDDING_MODEL, USER_PROVIDER } from '@techspar/core'
import { ApiEmbeddingClient, OpenAiChatDriverFactory, PcmSpeechSegmenter, normalizeEmbeddingApiBase } from '@techspar/providers'

function completion(choices: unknown, usage = { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 }) {
  return { id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'test-model', choices, usage }
}

function chatFetch(replies: unknown[], requests: Array<Record<string, unknown>>): typeof globalThis.fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
    const reply = replies.length > 1 ? replies.shift() : replies[0]
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
}

describe('chat provider compatibility', () => {
  const config = { api_base: 'https://example.test/v1', api_key: 'key', model: 'test-model', temperature: 0.7, compatibility: 'generic' as const, use_platform: false, source: USER_PROVIDER }
  const valid = completion([{ index: 0, message: { role: 'assistant', content: '[{"id":1,"question":"题目"}]' }, finish_reason: 'stop' }], { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 })

  test('disables thinking for DeepSeek live advice without changing generic providers', async () => {
    const requests: Array<Record<string, unknown>> = []
    const factory = new OpenAiChatDriverFactory({ fetch: (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch })
    for (const compatibility of ['deepseek', 'generic'] as const) {
      const chunks: string[] = []
      for await (const chunk of factory.create({ ...config, compatibility }).stream([{ role: 'user', content: '问题' }], new AbortController().signal, { reasoningEffort: 'none', maxTokens: 600 })) chunks.push(chunk)
      expect(chunks.join('')).toBe('回答')
    }
    expect(requests[0]).toMatchObject({ reasoning_effort: 'none', max_tokens: 600, stream: true })
    expect(requests[1]).not.toHaveProperty('reasoning_effort')
  })

  test('retries null choices with backoff and preserves the output limit', async () => {
    const requests: Array<Record<string, unknown>> = []
    const delays: number[] = []
    const factory = new OpenAiChatDriverFactory({
      fetch: chatFetch([completion(null), valid], requests),
      retryDelaysMs: [10, 20],
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })
    const result = await factory.create(config).complete([{ role: 'user', content: 'generate' }], new AbortController().signal, { maxTokens: 4096 })

    expect(result).toEqual({ text: '[{"id":1,"question":"题目"}]', promptTokens: 4, completionTokens: 4, cachedTokens: 0 })
    expect(delays).toEqual([10])
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.max_tokens === 4096)).toBeTrue()
  })

  test('raises a readable 502 after repeated null choices', async () => {
    const requests: Array<Record<string, unknown>> = []
    const delays: number[] = []
    const factory = new OpenAiChatDriverFactory({
      fetch: chatFetch([completion(null)], requests),
      retryDelaysMs: [10, 20],
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })

    await expect(factory.create(config).complete([{ role: 'user', content: 'generate' }], new AbortController().signal)).rejects.toMatchObject({
      status: 502,
      code: 'provider_response_error',
      message: '模型服务连续返回空内容，已自动重试，请稍后再试或更换模型。',
    })
    expect(requests).toHaveLength(3)
    expect(delays).toEqual([10, 20])
  })

  test('sends DeepSeek-only structured parameters only in DeepSeek mode', async () => {
    const requests: Array<Record<string, unknown>> = []
    const factory = new OpenAiChatDriverFactory({ fetch: chatFetch([valid], requests), retryDelaysMs: [], sleep: async () => {} })
    await factory.create({ ...config, compatibility: 'deepseek' }).complete(
      [{ role: 'user', content: 'return json' }],
      new AbortController().signal,
      { maxTokens: 4096, jsonMode: true, reasoningEffort: 'low' },
    )
    expect(requests[0]).toMatchObject({
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
      max_tokens: 4096,
    })

    requests.length = 0
    await factory.create(config).complete(
      [{ role: 'user', content: 'return json' }],
      new AbortController().signal,
      { maxTokens: 4096, jsonMode: true, reasoningEffort: 'low' },
    )
    expect(requests[0]?.response_format).toBeUndefined()
    expect(requests[0]?.reasoning_effort).toBeUndefined()

    requests.length = 0
    await factory.create({ ...config, compatibility: 'deepseek' }).complete(
      [{ role: 'user', content: 'answer normally' }],
      new AbortController().signal,
      { reasoningEffort: 'low' },
    )
    expect(requests[0]?.response_format).toBeUndefined()
    expect(requests[0]?.reasoning_effort).toBeUndefined()
  })
})

describe('embedding provider compatibility', () => {
  test('defaults local inference to a Transformers.js ONNX checkpoint', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('Xenova/bge-m3')
  })

  test.each([
    ['https://example.test/v1', 'https://example.test/v1'],
    ['https://example.test/v1/', 'https://example.test/v1'],
    ['https://example.test/v1/embeddings', 'https://example.test/v1'],
    ['https://example.test/v1/EMBEDDINGS/', 'https://example.test/v1'],
  ])('normalizes %s', (input, expected) => expect(normalizeEmbeddingApiBase(input)).toBe(expected))

  test('falls back after a 400 and remembers scalar-only capability', async () => {
    const calls: Array<string | string[]> = []
    const client = {
      embeddings: {
        async create(input: { input: string | string[] }) {
          calls.push(input.input)
          if (Array.isArray(input.input)) throw Object.assign(new Error('bad request'), { status: 400 })
          return { data: [{ index: 0, embedding: [input.input.length] }] }
        },
      },
    }
    const embedding = new ApiEmbeddingClient({ apiBase: 'https://example.test/v1', apiKey: 'key', model: 'model', batchSize: 10 }, client)
    expect(await embedding.embed(['a', 'bb', 'ccc'])).toEqual([[1], [2], [3]])
    expect(await embedding.embed(['dddd', 'eeeee'])).toEqual([[4], [5]])
    expect(calls).toEqual([['a', 'bb', 'ccc'], 'a', 'bb', 'ccc', 'dddd', 'eeeee'])
  })

  test('does not hide non-400 provider failures', async () => {
    const calls: Array<string | string[]> = []
    const client = {
      embeddings: {
        async create(input: { input: string | string[] }): Promise<{ data: Array<{ index: number; embedding: number[] }> }> {
          calls.push(input.input)
          throw Object.assign(new Error('unavailable'), { status: 503 })
        },
      },
    }
    const embedding = new ApiEmbeddingClient({ apiBase: '', apiKey: 'key', model: 'model' }, client)
    await expect(embedding.embed(['a', 'b'])).rejects.toThrow('unavailable')
    expect(calls).toEqual([['a', 'b']])
  })
})

describe('realtime PCM segmentation', () => {
  test('buffers split 16 kHz frames and emits sustained speech after silence', () => {
    const frameBytes = 960
    const pcm = new Uint8Array(frameBytes * 63)
    const view = new DataView(pcm.buffer)
    for (let frame = 0; frame < 50; frame += 1) {
      for (let offset = frame * frameBytes; offset < (frame + 1) * frameBytes; offset += 2) view.setInt16(offset, 1200, true)
    }
    const segmenter = new PcmSpeechSegmenter()
    expect(segmenter.feed(pcm.slice(0, 123))).toHaveLength(0)
    const segments = segmenter.feed(pcm.slice(123))
    expect(segments).toHaveLength(1)
    expect(segments[0]?.length).toBe(frameBytes * 50)
  })
})
