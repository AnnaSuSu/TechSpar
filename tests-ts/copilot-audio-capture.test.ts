import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { CopilotAudioCapture } from '../frontend/src/lib/copilot-audio.ts'
import { decodeCopilotAudio, encodeCopilotAudio } from '@techspar/contracts'

const restore: Array<() => void> = []
afterEach(() => { while (restore.length) restore.pop()!() })
function globalValue(key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { configurable: true, value })
  restore.push(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key) })
}
class Track extends EventTarget {
  readyState = 'live'
  stops = 0
  constructor(readonly kind = 'audio') { super() }
  stop() { this.stops++; this.readyState = 'ended' }
}
class Stream {
  constructor(readonly tracks: Track[]) {}
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
}
class Node {
  gain = { value: 1 }
  connect(node: Node) { return node }
  disconnect() {}
}
class Processor extends Node {
  static instances: Processor[] = []
  port = { onmessage: null as ((event: { data: unknown }) => void) | null, close() {} }
  onprocessorerror: (() => void) | null = null
  constructor() { super(); Processor.instances.push(this) }
}
class Context {
  static instances: Context[] = []
  sampleRate = 16000
  closed = false
  destination = new Node()
  audioWorklet = { async addModule() {} }
  constructor() { Context.instances.push(this) }
  createMediaStreamSource() { return new Node() }
  createGain() { return new Node() }
  async resume() {}
  async close() { this.closed = true }
}
function fixture(mic?: () => Promise<Stream>, systemAudio = true) {
  Processor.instances = []; Context.instances = []
  const system = new Stream([...(systemAudio ? [new Track()] : []), new Track('video')])
  const microphone = new Stream([new Track()])
  globalValue('navigator', { mediaDevices: { async getDisplayMedia() { return system }, getUserMedia: mic || (async () => microphone) } })
  globalValue('MediaStream', Stream); globalValue('AudioContext', Context); globalValue('AudioWorkletNode', Processor)
  const errors: string[] = []; const frames: Array<{ source: string; bytes: number[] }> = []
  const capture = new CopilotAudioCapture({ onPcm(source, pcm) { frames.push({ source, bytes: [...pcm] }) }, onLevel() {}, onInterrupted(message) { errors.push(message) } })
  restore.push(() => capture.stop())
  return { capture, system, microphone, errors, frames }
}

test('cancel during a permission prompt stops tracks returned after cancellation', async () => {
  const pending = Promise.withResolvers<Stream>()
  const f = fixture(() => pending.promise)
  const start = f.capture.start()
  await Promise.resolve(); await Promise.resolve()
  f.capture.stop()
  pending.resolve(f.microphone)
  await expect(start).rejects.toThrow('采集已取消')
  expect(f.system.tracks.every((track) => track.stops === 1)).toBeTrue()
  expect(f.microphone.tracks[0]!.stops).toBe(1)
  expect(Context.instances).toHaveLength(0)
})

test('refuses a video-only stream and releases it', async () => {
  const f = fixture(undefined, false)
  await expect(f.capture.start()).rejects.toThrow('未获取到对方音频')
  expect(f.system.tracks[0]!.stops).toBe(1)
  expect(Context.instances).toHaveLength(0)
})

test('microphone refusal cleans up already granted system capture', async () => {
  const f = fixture(async () => { throw new Error('permission denied') })
  await expect(f.capture.start()).rejects.toThrow('permission denied')
  expect(f.system.tracks.every((track) => track.stops === 1)).toBeTrue()
})

test('independent processors keep source identity; track loss releases both and ignores late PCM', async () => {
  const f = fixture()
  await f.capture.start()
  expect(f.system.tracks.every((track) => track.stops === 0)).toBeTrue()
  const [system, mic] = Processor.instances
  const packet = { data: { pcm: Uint8Array.from([1, 0]).buffer, rms: .5, peak: .6, active: true } }
  system!.port.onmessage!(packet); mic!.port.onmessage!(packet)
  expect(f.frames.map((frame) => frame.source)).toEqual(['system', 'microphone'])
  const lateCallback = mic!.port.onmessage!
  f.system.tracks[0]!.dispatchEvent(new Event('ended'))
  lateCallback(packet)
  expect(f.frames).toHaveLength(2)
  expect(f.errors).toHaveLength(1)
  expect([...f.system.tracks, ...f.microphone.tracks].every((track) => track.stops === 1)).toBeTrue()
  expect(Context.instances[0]!.closed).toBeTrue()
  f.capture.stop()
  expect(f.microphone.tracks[0]!.stops).toBe(1)
})

test('worklet emits independent 100ms little-endian PCM and real level measurements', () => {
  type Worklet = { process(inputs: Float32Array[][]): boolean; port: { packets: Array<{ pcm: ArrayBuffer; rms: number; active: boolean }> } }
  let WorkletConstructor: new () => Worklet
  runInNewContext(readFileSync(new URL('../frontend/src/lib/copilot-pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { packets: [] as unknown[], postMessage(packet: unknown) { this.packets.push(packet) } } },
    registerProcessor(_name: string, ctor: typeof WorkletConstructor) { WorkletConstructor = ctor },
  })
  const system = new WorkletConstructor!(); const microphone = new WorkletConstructor!()
  for (let i = 0; i < 13; i++) { system.process([[new Float32Array(128).fill(.5)]]); microphone.process([[new Float32Array(128)]]); }
  expect(system.port.packets).toHaveLength(1)
  expect(microphone.port.packets).toHaveLength(1)
  const result = system.port.packets[0]!
  expect(result.pcm.byteLength).toBe(3200)
  expect(new DataView(result.pcm).getInt16(0, true)).toBe(16384)
  expect(result.rms).toBe(.5)
  expect(result.active).toBeTrue()
  expect(microphone.port.packets[0]!.active).toBeFalse()
})

test('dual-channel wire framing rejects invalid versions, roles, and incomplete PCM', () => {
  const pcm = Uint8Array.from([1, 0, 255, 127])
  expect(decodeCopilotAudio(encodeCopilotAudio('microphone', pcm))).toEqual({ source: 'microphone', pcm })
  for (const frame of [[0x54, 0x53, 2, 0, 1, 0], [0x54, 0x53, 1, 2, 1, 0], [0x54, 0x53, 1, 0, 1], [0, 0, 1, 0, 1, 0]]) expect(() => decodeCopilotAudio(Uint8Array.from(frame))).toThrow()
})
