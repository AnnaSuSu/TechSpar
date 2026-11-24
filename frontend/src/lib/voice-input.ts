import { HandledApiError } from "../api/client";
import { transcribeAudio } from "../api/interview";

export type VoiceInputStatus = "idle" | "starting" | "recording" | "stopping" | "transcribing";
export type VoiceInputState = {
  status: VoiceInputStatus;
  error: string;
  inputLabel: string;
  level: number | null;
  heard: boolean;
};

export const initialVoiceInputState: VoiceInputState = {
  status: "idle", error: "", inputLabel: "", level: null, heard: false,
};
const MAX_AUDIO_BYTES = 7 * 1024 * 1024;

/** Owns one recording attempt, including pending permission and transcription. */
export class VoiceInputSession {
  state = { ...initialVoiceInputState };
  private cancelled = false;
  private finished = false;
  private stopRequested = false;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private meterTimer?: ReturnType<typeof setInterval>;
  private transcriptionTimer?: ReturnType<typeof setTimeout>;
  private abort = new AbortController();

  constructor(private readonly options: {
    onChange(state: VoiceInputState): void;
    onResult(text: string): void;
    onDeviceReady?(): void;
    transcriptionTimeoutMs?: number;
  }) {}

  private update(patch: Partial<VoiceInputState>): void {
    if (this.cancelled) return;
    this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }

  async start(microphoneId = ""): Promise<void> {
    if (this.cancelled || this.finished || this.state.status !== "idle") return;
    this.update({ status: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (this.cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live") {
        this.finish("未获取到可用的麦克风音频，请重新选择输入设备。");
        return;
      }
      track.addEventListener("ended", this.onTrackEnded);
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new DOMException("No supported audio format", "NotSupportedError");
      const recorder = new MediaRecorder(stream, { mimeType });
      this.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (this.cancelled || this.finished || !data.size) return;
        this.bytes += data.size;
        if (this.bytes > MAX_AUDIO_BYTES) {
          this.finish("录音超过 7 MiB，请缩短回答后重新录音。");
          return;
        }
        this.chunks.push(data);
      };
      // Install before start: automatic stops must also leave the recording state.
      recorder.onstop = () => {
        if (this.cancelled || this.finished) return;
        if (!this.stopRequested) {
          this.finish("录音意外停止，请检查麦克风连接后重新录音。");
          return;
        }
        void this.completeRecording();
      };
      recorder.onerror = () => this.finish("录音中断，请检查麦克风连接后重新录音。");
      recorder.start(250);
      this.startedAt = performance.now();
      this.update({ status: "recording", inputLabel: track.label || "系统默认麦克风" });
      this.options.onDeviceReady?.();
      this.startMeter(stream);
    } catch (error) {
      if (this.cancelled) return;
      const name = error instanceof Error ? error.name : "";
      this.finish(name === "NotAllowedError"
        ? "无法访问麦克风，请在系统设置中允许此应用使用麦克风后重试。"
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "所选麦克风不可用，请连接麦克风或重新选择输入设备。"
          : name === "NotReadableError"
            ? "麦克风无法使用，请检查设备连接或关闭占用麦克风的应用后重试。"
            : name === "NotSupportedError"
              ? "当前环境不支持录音格式，请更新客户端或使用最新版浏览器。"
              : "录音启动失败，请检查麦克风和系统声音设置后重试。");
    }
  }

  stop(): void {
    if (this.state.status !== "recording" || this.finished || this.cancelled) return;
    this.stopRequested = true;
    this.update({ status: "stopping" });
    try {
      if (this.recorder?.state === "inactive") void this.completeRecording();
      else this.recorder?.stop();
    } catch {
      this.finish("无法结束录音，请检查麦克风连接后重新录音。");
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.finished = true;
    this.releaseCapture();
    this.abort.abort();
    clearTimeout(this.transcriptionTimer);
  }

  private readonly onTrackEnded = () => {
    if (!this.stopRequested) this.finish("麦克风已断开，请重新选择输入设备后录音。");
  };

  private startMeter(stream: MediaStream): void {
    // Metering is diagnostic; unavailable Web Audio must not prevent recording.
    try {
      const context = new AudioContext();
      this.context = context;
      this.source = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.source.connect(this.analyser);
      void context.resume().catch(() => {});
      const samples = new Float32Array(this.analyser.fftSize);
      this.meterTimer = setInterval(() => {
        if (this.cancelled || this.finished || context.state !== "running") return;
        this.analyser!.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        this.update({ level: Math.min(1, rms * 5), heard: this.state.heard || rms >= 0.005 });
      }, 100);
    } catch {
      // Continue with ASR; byte size and signal level alone cannot prove speech.
      this.closeMeter();
    }
  }

  private async completeRecording(): Promise<void> {
    if (this.cancelled || this.finished || this.state.status === "transcribing") return;
    const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || "audio/webm" });
    const duration = performance.now() - this.startedAt;
    this.releaseCapture();
    // Opus can encode seconds of silence in less than 1000 bytes. Size alone
    // must not mislabel a quiet or muted microphone as an accidental short click.
    if (!blob.size || (blob.size < 1000 && duration < 500)) {
      this.finish("录音内容太少，请说完一句话后再点击停止。");
      return;
    }
    this.update({ status: "transcribing", level: null });
    let timedOut = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        this.transcriptionTimer = setTimeout(() => {
          timedOut = true;
          this.abort.abort();
          reject(new Error("Transcription timed out"));
        }, this.options.transcriptionTimeoutMs ?? 60_000);
      });
      const { text } = await Promise.race([transcribeAudio(blob, this.abort.signal), timeout]);
      if (this.cancelled) return;
      if (typeof text === "string" && text.trim()) this.options.onResult(text);
      this.finish(typeof text === "string" && text.trim()
        ? "" : "未识别到语音，请检查所选麦克风和输入音量后重试。");
    } catch (error) {
      if (!this.cancelled) this.finish(error instanceof HandledApiError ? "" : timedOut
        ? "语音识别超时，请检查网络后重新录音。"
        : "语音识别失败，请检查网络或语音服务配置后重试。");
    } finally {
      clearTimeout(this.transcriptionTimer);
    }
  }

  private finish(error: string): void {
    if (this.cancelled || this.finished) return;
    this.finished = true;
    this.releaseCapture();
    this.update({ status: "idle", error, level: null });
  }

  private closeMeter(): void {
    clearInterval(this.meterTimer);
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    this.source = undefined;
    this.analyser = undefined;
    this.context = undefined;
  }

  private releaseCapture(): void {
    this.closeMeter();
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== "inactive") {
        try { this.recorder.stop(); } catch { /* already stopped */ }
      }
      this.recorder = undefined;
    }
    this.stream?.getAudioTracks().forEach((track) => track.removeEventListener("ended", this.onTrackEnded));
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.chunks = [];
  }
}
