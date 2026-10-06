import { randomUUID } from 'node:crypto'
import type { RealtimeAsrFactory, RealtimeAsrSession } from '@techspar/core'

type Input = Parameters<RealtimeAsrFactory['create']>[0]
type Options = {
  createWebSocket?: (url: string, options: { headers: Record<string, string> }) => WebSocket
  handshakeTimeoutMs?: number
}
const MODEL = 'qwen-audio-3.1-asr-flash-streaming'
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

class QwenStreamingAsrSession implements RealtimeAsrSession {
  private socket?: WebSocket
  private ready = false
  private stopped = false
  private stopping?: Promise<void>
  private settleStart?: (error?: Error) => void
  private cleanup?: () => void
  private readonly taskId = randomUUID().replaceAll('-', '')
  // Deduplicate events, not text: repeating the same words in another sentence is valid.
  private readonly finalSentences = new Set<number>()

  constructor(private readonly input: Input, private readonly options: Options) {}

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.socket || this.stopped) throw new Error('Qwen ASR session already started or stopped')
    const workspace = this.input.workspaceId?.trim()
    if (workspace && !/^[a-zA-Z0-9-]{1,100}$/.test(workspace)) throw new Error('Invalid DashScope workspace ID')
    const host = workspace ? `${workspace}.cn-beijing.maas.aliyuncs.com` : 'dashscope.aliyuncs.com'
    const NativeSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket
    const socket = (this.options.createWebSocket || ((url, options) => new NativeSocket(url, options)))(
      `wss://${host}/api-ws/v1/inference`, { headers: { Authorization: `Bearer ${this.input.apiKey}` } },
    )
    this.socket = socket
    const onAbort = () => { this.settleStart?.(new Error('Qwen ASR startup cancelled')); void this.stop() }
    const onMessage = (event: MessageEvent) => {
      if (!this.stopped) void this.receive(event.data).catch(() => this.fail('Qwen ASR response processing failed'))
    }
    const onError = () => this.fail('Qwen ASR connection failed; check the API key and Beijing workspace')
    const onClose = () => { if (!this.stopped) this.fail('Qwen ASR connection closed unexpectedly') }
    const onOpen = () => {
      try {
        socket.send(JSON.stringify({
          header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
          payload: { task_group: 'audio', task: 'asr', function: 'recognition', model: MODEL,
            parameters: { format: 'pcm', sample_rate: 16000 }, input: {} },
        }))
      } catch { this.fail('Qwen ASR could not start the recognition task') }
    }
    this.cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('error', onError)
      socket.removeEventListener('close', onClose)
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => this.settleStart?.(new Error('Qwen ASR task startup timed out')), this.options.handshakeTimeoutMs ?? 10_000)
        this.settleStart = (error) => {
          clearTimeout(timer)
          this.settleStart = undefined
          if (error) reject(error); else resolve()
        }
        socket.addEventListener('open', onOpen)
        socket.addEventListener('message', onMessage)
        socket.addEventListener('error', onError)
        socket.addEventListener('close', onClose)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
      signal.throwIfAborted()
      if (this.stopped) throw new Error('Qwen ASR session stopped')
    } catch (error) { await this.stop(); throw error }
  }

  private fail(message: string): void {
    if (this.stopped) return
    const starting = Boolean(this.settleStart)
    this.settleStart?.(new Error(message))
    void this.stop()
    if (!starting) void this.input.onError(message).catch(() => {})
  }

  private async receive(raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return
    let data: Record<string, unknown>
    try { data = record(JSON.parse(raw)) } catch { return }
    const header = record(data.header)
    if (header.task_id !== this.taskId) return
    if (header.event === 'task-started') { this.ready = true; this.settleStart?.(); return }
    if (header.event === 'task-failed') {
      const code = String(header.error_code || 'unknown').slice(0, 100)
      this.fail(`Qwen ASR task failed (${code}); check model access and account balance`)
      return
    }
    if (header.event === 'task-finished') { this.fail('Qwen ASR task ended unexpectedly'); return }
    if (header.event !== 'result-generated' || !this.ready) return
    const output = record(record(data.payload).output)
    const sentence = record(output.sentence || record(output.output).sentence)
    const text = typeof sentence.text === 'string' ? sentence.text.trim() : ''
    if (sentence.sentence_end === true) {
      const id = sentence.sentence_id
      if (typeof id !== 'number' || this.finalSentences.has(id)) return
      this.finalSentences.add(id)
      if (this.finalSentences.size > 512) this.finalSentences.delete(this.finalSentences.values().next().value!)
      await this.input.onInterim('')
      if (text && !this.stopped) await this.input.onFinal(text)
    } else if (text) await this.input.onInterim(text)
  }

  sendAudio(bytes: Uint8Array): boolean {
    const socket = this.socket
    if (this.stopped || !this.ready || !socket || socket.readyState !== WebSocket.OPEN || !bytes.length || bytes.length % 2) return false
    if (socket.bufferedAmount > 32000 * 2) return false
    try {
      for (let offset = 0; offset < bytes.length; offset += 3200) socket.send(bytes.slice(offset, offset + 3200))
      return true
    } catch { this.fail('Qwen ASR audio send failed'); return false }
  }

  stop(): Promise<void> { return this.stopping ||= this.stopSocket() }

  private async stopSocket(): Promise<void> {
    this.stopped = true
    this.settleStart?.(new Error('Qwen ASR session stopped'))
    this.cleanup?.()
    this.cleanup = undefined
    const socket = this.socket
    this.socket = undefined
    const wasReady = this.ready
    this.ready = false
    this.finalSentences.clear()
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    // Let the provider close out billing, but suppress transcripts after the user stops.
    if (wasReady && socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); socket.removeEventListener('message', onMessage); socket.removeEventListener('close', finish); resolve() }
        const onMessage = (event: MessageEvent) => {
          try { const data = JSON.parse(String(event.data)); if (data.header?.task_id === this.taskId && ['task-finished', 'task-failed'].includes(data.header?.event)) finish() } catch {}
        }
        const timer = setTimeout(finish, 500)
        socket.addEventListener('message', onMessage)
        socket.addEventListener('close', finish)
        try { socket.send(JSON.stringify({ header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' }, payload: { input: {} } })) } catch { finish() }
      })
    }
    try { socket.close() } catch {}
  }
}

export class QwenStreamingAsrFactory implements RealtimeAsrFactory {
  constructor(private readonly options: Options = {}) {}
  create(input: Input): RealtimeAsrSession { return new QwenStreamingAsrSession(input, this.options) }
}
