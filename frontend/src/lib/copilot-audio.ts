import type { CopilotAudioSource } from '@techspar/contracts';

export type AudioLevel = { rms: number; peak: number; active: boolean; received: boolean; heard: boolean };
export const emptyAudioLevel = (): AudioLevel => ({ rms: 0, peak: 0, active: false, received: false, heard: false });

type CaptureOptions = {
  microphoneId?: string;
  onPcm(source: CopilotAudioSource, pcm: Uint8Array): void;
  onLevel(source: CopilotAudioSource, level: AudioLevel): void;
  onInterrupted(message: string): void;
};

/** Owns both independent capture tracks. Failure/cancellation releases everything. */
export class CopilotAudioCapture {
  private stopped = false;
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private nodes: AudioNode[] = [];
  private cleanups: Array<() => void> = [];
  private lastFrame = { system: Date.now(), microphone: Date.now() };

  constructor(private readonly options: CaptureOptions) {}

  private adopt(stream: MediaStream): MediaStream {
    if (this.stopped) { stream.getTracks().forEach((track) => track.stop()); throw new Error('采集已取消'); }
    this.streams.push(stream);
    return stream;
  }

  async start(): Promise<void> {
    try {
      // First call stays in the click's user gesture. The display track is never sent.
      const system = this.adopt(await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }));
      if (!system.getAudioTracks().length) throw new Error('未获取到对方音频，请在系统授权窗口允许共享音频后重试');
      const microphone = this.adopt(await navigator.mediaDevices.getUserMedia({ audio: {
        ...(this.options.microphoneId ? { deviceId: { exact: this.options.microphoneId } } : {}),
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } }));
      if (!microphone.getAudioTracks().length) throw new Error('未获取到麦克风音频');
      const context = new AudioContext({ sampleRate: 16000 });
      this.context = context;
      if (context.sampleRate !== 16000) throw new Error('当前设备不支持 16 kHz 音频采集');
      await context.audioWorklet.addModule(new URL('./copilot-pcm-worklet.js?no-inline', import.meta.url).href);
      if (this.stopped) throw new Error('采集已取消');
      this.wire('system', system, context);
      this.wire('microphone', microphone, context);
      await context.resume();
      if (this.stopped) throw new Error('采集已取消');
      this.lastFrame = { system: Date.now(), microphone: Date.now() };
      const timer = setInterval(() => {
        for (const source of ['system', 'microphone'] as const) {
          if (Date.now() - this.lastFrame[source] > 6000) {
            this.interrupt(`${source === 'system' ? '对方音频' : '麦克风'}采集中断，请检查设备和系统权限后重新开始`);
            break;
          }
        }
      }, 1000);
      this.cleanups.push(() => clearInterval(timer));
    } catch (error) { this.stop(); throw error; }
  }

  private wire(source: CopilotAudioSource, stream: MediaStream, context: AudioContext): void {
    const track = stream.getAudioTracks()[0]!;
    if (track.readyState !== 'live') throw new Error('音频授权已结束，请重新开始');
    const ended = () => this.interrupt(`${source === 'system' ? '对方音频共享' : '麦克风'}已断开，采集已停止`);
    // Keep the display track alive: stopping it can also end loopback on some OSes.
    for (const item of stream.getTracks()) {
      item.addEventListener('ended', ended);
      this.cleanups.push(() => item.removeEventListener('ended', ended));
    }
    const input = context.createMediaStreamSource(new MediaStream([track]));
    const processor = new AudioWorkletNode(context, 'copilot-pcm');
    const silent = context.createGain();
    silent.gain.value = 0;
    this.nodes.push(input, processor, silent);
    let heard = false;
    processor.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number; peak: number; active: boolean }>) => {
      if (this.stopped) return;
      this.lastFrame[source] = Date.now();
      const { pcm, rms, peak, active } = event.data;
      heard ||= active;
      this.options.onLevel(source, { rms, peak, active, received: true, heard });
      this.options.onPcm(source, new Uint8Array(pcm));
    };
    processor.onprocessorerror = () => this.interrupt('音频处理器已停止，请重新开始采集');
    this.cleanups.push(() => { processor.port.onmessage = null; processor.port.close(); processor.onprocessorerror = null; });
    input.connect(processor).connect(silent).connect(context.destination);
  }

  private interrupt(message: string): void {
    if (this.stopped) return;
    this.stop();
    this.options.onInterrupted(message);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.nodes.splice(0).forEach((node) => node.disconnect());
    this.streams.splice(0).forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    void this.context?.close().catch(() => {});
  }
}
