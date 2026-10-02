import { describe, expect, spyOn, test } from 'bun:test'
import { DashScopeRealtimeAsrFactory } from '@techspar/providers'
import { ControlledAsrSocket, within } from './helpers/realtime-asr.ts'

function harness(handshakeTimeoutMs = 1000) {
  const socket = new ControlledAsrSocket()
  const controller = new AbortController()
  const callbacks: unknown[] = []
  let created = 0
  const session = new DashScopeRealtimeAsrFactory({
    createWebSocket() { created += 1; return socket.asWebSocket() }, handshakeTimeoutMs,
  }).create({
    apiKey: 'synthetic',
    async onInterim(text) { callbacks.push(['interim', text]) },
    async onFinal(text, role) { callbacks.push(['final', text, role]) },
    async onError(message) { callbacks.push(['error', message]) },
  })
  const start = () => session.start(controller.signal).then(() => undefined, (error: unknown) => error)
  return { socket, controller, callbacks, session, start, get created() { return created } }
}

describe('DashScope realtime ASR lifecycle', () => {
  test('stop settles a stalled handshake even when close emits no error', async () => {
    const h = harness()
    const started = h.start()
    try {
      expect(h.socket.readyState).toBe(WebSocket.CONNECTING)
      const first = h.session.stop()
      expect(h.session.stop()).toBe(first)
      const [error] = await within(Promise.all([started, first]))
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('stopped')
      expect(h.socket.closeCalls).toBe(1)
      expect(h.socket.listenerCount).toBe(0)
      h.socket.open()
      expect(h.socket.sent).toEqual([])
      expect(h.callbacks).toEqual([])
    } finally { await h.session.stop() }
  })

  test('abort cancels a connecting socket and removes the abort listener', async () => {
    const h = harness()
    const added = spyOn(h.controller.signal, 'addEventListener')
    const removed = spyOn(h.controller.signal, 'removeEventListener')
    try {
      const started = h.start()
      const reason = new Error('synthetic cancellation')
      h.controller.abort(reason)
      expect(await within(started)).toBe(reason)
      expect(h.socket.closeCalls).toBe(1)
      expect(h.socket.listenerCount).toBe(0)
      expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0]![1])
      expect(h.callbacks).toEqual([])
    } finally { await h.session.stop(); added.mockRestore(); removed.mockRestore() }
  })

  test('an already aborted request never creates an ASR socket', async () => {
    const h = harness()
    h.controller.abort(new Error('already cancelled'))
    expect((await h.start() as Error).message).toBe('already cancelled')
    expect(h.created).toBe(0)
    await h.session.stop()
  })

  test('a handshake deadline closes the socket and ignores a late open', async () => {
    const h = harness(20)
    try {
      expect((await within(h.start()) as Error).message).toContain('handshake timed out')
      expect(h.socket.closeCalls).toBe(1)
      expect(h.socket.listenerCount).toBe(0)
      h.socket.open()
      h.socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'late' })
      expect(h.socket.sent).toEqual([])
      expect(h.callbacks).toEqual([])
    } finally { await h.session.stop() }
  })

  test.each(['error', 'close', 'send failure'] as const)('startup %s rejects and releases all listeners', async (failure) => {
    const h = harness()
    try {
      const started = h.start()
      if (failure === 'error') h.socket.dispatchEvent(new Event('error'))
      else if (failure === 'close') h.socket.remoteClose()
      else { h.socket.sendFailure = true; h.socket.open() }
      const error = await within(started)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(failure === 'close' ? 'closed during startup' : failure)
      expect(h.socket.closeCalls).toBe(failure === 'close' ? 0 : 1)
      expect(h.socket.listenerCount).toBe(0)
      expect(h.callbacks).toEqual([])
    } finally { await h.session.stop() }
  })

  test.each(['silent', 'throw'] as const)('stop is bounded when socket close is %s', async (behavior) => {
    const h = harness()
    h.socket.closeBehavior = behavior
    const started = h.start()
    const [error] = await within(Promise.all([started, h.session.stop()]))
    expect((error as Error).message).toContain('stopped')
    expect(h.socket.closeCalls).toBe(behavior === 'silent' ? 2 : 1)
    expect(h.socket.listenerCount).toBe(0)
  })

  test('successful startup clears its deadline, streams audio, and abort closes an active session', async () => {
    const h = harness(20)
    try {
      const started = h.start()
      const audio = Uint8Array.from([1, 0, 2, 0])
      expect(h.session.sendAudio(audio)).toBeTrue()
      h.socket.open()
      h.socket.message({ type: 'session.created' })
      expect(await within(started)).toBeUndefined()
      expect(h.socket.sent.map((event) => event.type)).toEqual(['session.update', 'input_audio_buffer.append'])
      expect(h.socket.sent[1]?.audio).toBe(Buffer.from(audio).toString('base64'))
      h.socket.message({ type: 'conversation.item.input_audio_transcription.delta', delta: '字幕' })
      h.socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: '完成字幕' })
      expect(h.callbacks).toEqual([['interim', '字幕'], ['final', '完成字幕', undefined]])
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(h.socket.closeCalls).toBe(0)
      h.controller.abort()
      await within(h.session.stop())
      expect(h.socket.sent.at(-1)?.type).toBe('session.finish')
      expect(h.socket.closeCalls).toBe(1)
      expect(h.socket.listenerCount).toBe(0)
      expect(h.session.sendAudio(audio)).toBeFalse()
      h.socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'late' })
      h.socket.dispatchEvent(new Event('error'))
      expect(h.callbacks).toHaveLength(2)
    } finally { await h.session.stop() }
  })

  test('abort immediately after open cannot leave an active session', async () => {
    const h = harness()
    const started = h.start()
    h.socket.open()
    h.controller.abort(new Error('cancelled after open'))
    expect((await within(started) as Error).message).toBe('cancelled after open')
    expect(h.socket.closeCalls).toBe(1)
    expect(h.socket.listenerCount).toBe(0)
  })
})
