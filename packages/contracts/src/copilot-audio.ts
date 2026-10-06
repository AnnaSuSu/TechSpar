export type CopilotAudioSource = 'system' | 'microphone'

// Negotiated by start.audio_mode=dual. PCM is signed 16-bit LE, mono, 16 kHz.
// Header: TS, version 1, source (0=system, 1=microphone).
export function encodeCopilotAudio(source: CopilotAudioSource, pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!pcm.length || pcm.length % 2 || pcm.length > 64_000) throw new Error('Invalid PCM frame')
  const frame = new Uint8Array(pcm.length + 4)
  frame.set([0x54, 0x53, 1, source === 'system' ? 0 : 1])
  frame.set(pcm, 4)
  return frame
}

export function decodeCopilotAudio(frame: Uint8Array): { source: CopilotAudioSource; pcm: Uint8Array } {
  if (frame.length < 6 || frame.length > 64_004 || frame.length % 2 || frame[0] !== 0x54 || frame[1] !== 0x53 || frame[2] !== 1 || frame[3]! > 1) throw new Error('Invalid dual-channel audio frame')
  return { source: frame[3] === 0 ? 'system' : 'microphone', pcm: frame.subarray(4) }
}
