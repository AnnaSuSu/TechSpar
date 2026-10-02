/** A socket with no automatic open/error event; tests control the provider boundary. */
export class ControlledAsrSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING
  bufferedAmount = 0
  closeCalls = 0
  closeBehavior: 'close' | 'silent' | 'throw' = 'close'
  sendFailure = false
  readonly sent: Array<Record<string, unknown>> = []
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
    if (callback) { const listeners = this.listeners.get(type) || new Set(); listeners.add(callback); this.listeners.set(type, listeners) }
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, callback, options)
    if (callback) this.listeners.get(type)?.delete(callback)
  }
  get listenerCount(): number { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0) }
  asWebSocket(): WebSocket { return this as unknown as WebSocket }
  open(): void { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event('open')) }
  message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  remoteClose(): void { this.readyState = WebSocket.CLOSED; this.dispatchEvent(new Event('close')) }
  send(value: string): void {
    if (this.sendFailure) throw new Error('synthetic send failure')
    this.sent.push(JSON.parse(value) as Record<string, unknown>)
  }
  close(): void {
    this.closeCalls += 1
    if (this.closeBehavior === 'throw') throw new Error('synthetic close failure')
    this.readyState = WebSocket.CLOSING
    if (this.closeBehavior === 'close') this.remoteClose()
  }
}

export async function within<T>(promise: Promise<T>, milliseconds = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ASR lifecycle did not settle')), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
