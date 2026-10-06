import { describe, expect, test } from 'bun:test'
import { QwenStreamingAsrFactory } from '@techspar/providers'
import { ControlledAsrSocket, within } from './helpers/realtime-asr.ts'

class QwenSocket extends ControlledAsrSocket {
  readonly audio: Uint8Array[] = []
  override send(value: string | Uint8Array): void {
    if (typeof value !== 'string') { this.audio.push(value.slice()); return }
    super.send(value)
    const message = JSON.parse(value)
    if (message.header.action === 'finish-task') this.event('task-finished')
  }
  event(event: string, payload: unknown = {}): void {
    const header = this.sent[0]?.header as { task_id?: string } | undefined
    this.message({ header: { event, task_id: header?.task_id }, payload })
  }
}
function fixture(timeout = 100) {
  const socket = new QwenSocket()
  const interim: string[] = [], final: string[] = [], errors: string[] = []
  let url = ''
  const session = new QwenStreamingAsrFactory({ handshakeTimeoutMs: timeout, createWebSocket(value) { url = value; return socket.asWebSocket() } }).create({
    apiKey: 'test', workspaceId: 'llm-test', async onInterim(value) { interim.push(value) },
    async onFinal(value) { final.push(value) }, async onError(value) { errors.push(value) },
  })
  return { socket, session, interim, final, errors, url: () => url }
}
describe('Qwen 3.1 streaming ASR', () => {
  test('waits for task-started, sends raw PCM and accepts revisions but emits each final only once', async () => {
    const f = fixture()
    let started = false
    const startup = f.session.start(new AbortController().signal).then(() => { started = true })
    f.socket.open()
    await Promise.resolve()
    expect(started).toBeFalse()
    expect(f.session.sendAudio(new Uint8Array(3200))).toBeFalse()
    expect(f.url()).toBe('wss://llm-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference')
    expect(f.socket.sent[0]).toMatchObject({ payload: { model: 'qwen-audio-3.1-asr-flash-streaming', parameters: { format: 'pcm', sample_rate: 16000 } } })
    f.socket.event('task-started')
    await startup
    const audio = new Uint8Array(6400).fill(12)
    expect(f.session.sendAudio(audio)).toBeTrue()
    expect(f.socket.audio).toEqual([audio.slice(0, 3200), audio.slice(3200)])
    f.socket.event('result-generated', { output: { sentence: { sentence_id: 0, text: '缓村', sentence_end: false } } })
    for (const id of [0, 0, 1]) f.socket.event('result-generated', { output: { sentence: { sentence_id: id, text: '缓存', sentence_end: true } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.interim).toEqual(['缓村', '', ''])
    expect(f.final).toEqual(['缓存', '缓存'])
    await f.session.stop()
    f.socket.event('result-generated', { output: { sentence: { sentence_id: 2, text: 'late', sentence_end: true } } })
    expect(f.final).toHaveLength(2)
    expect(f.socket.listenerCount).toBe(0)
    expect(f.session.sendAudio(audio)).toBeFalse()
  })

  for (const action of ['stop', 'abort', 'timeout', 'close', 'failure'] as const) test(`settles startup on ${action} without leaking listeners`, async () => {
    const f = fixture(20)
    const controller = new AbortController()
    const startup = f.session.start(controller.signal)
    const rejected = expect(within(startup)).rejects.toThrow()
    f.socket.open()
    if (action === 'stop') await f.session.stop()
    if (action === 'abort') controller.abort()
    if (action === 'close') f.socket.remoteClose()
    if (action === 'failure') f.socket.event('task-failed')
    await rejected
    expect(f.socket.listenerCount).toBe(0)
    expect(f.session.sendAudio(new Uint8Array(3200))).toBeFalse()
  })

  test('reports an unexpected live disconnect and limits queued audio', async () => {
    const f = fixture()
    const startup = f.session.start(new AbortController().signal)
    f.socket.open(); f.socket.event('task-started'); await startup
    f.socket.bufferedAmount = 64001
    expect(f.session.sendAudio(new Uint8Array(3200))).toBeFalse()
    f.socket.remoteClose()
    expect(f.errors).toHaveLength(1)
    expect(f.socket.listenerCount).toBe(0)
    await f.session.stop()
  })
})
