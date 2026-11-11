import { useId } from "react";
import type useVoiceInput from "../hooks/useVoiceInput";

export default function VoiceInputFeedback({ voice }: { voice: ReturnType<typeof useVoiceInput> }) {
  const id = useId();
  if (!voice.isSupported) return null;
  return (
    <div className="w-full max-w-3xl space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
        <label htmlFor={id}>输入麦克风</label>
        <select id={id} value={voice.microphoneId} disabled={voice.isBusy}
          onChange={(event) => voice.setMicrophoneId(event.target.value)}
          className="max-w-64 rounded border border-border bg-surface px-2 py-1">
          <option value="">系统默认麦克风</option>
          {voice.microphoneId && !voice.microphones.some((device) => device.deviceId === voice.microphoneId) && (
            <option value={voice.microphoneId}>所选麦克风已断开，请重新选择</option>
          )}
          {voice.microphones.filter((device) => device.deviceId && device.deviceId !== "default")
            .map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
        </select>
        {voice.isBusy && <button type="button" onClick={voice.cancel} className="text-text underline">取消语音输入</button>}
        {voice.error && window.techsparDesktop?.openAudioSettings && (
          <button type="button" onClick={() => {
            void window.techsparDesktop?.openAudioSettings?.("microphone").catch(() => {});
          }} className="text-text underline">打开麦克风设置</button>
        )}
      </div>
      {voice.isStarting && <p role="status" className="text-xs text-dim">正在请求麦克风权限，可在授权窗口中允许访问。</p>}
      {voice.isListening && (
        <div className="space-y-1 text-xs text-dim">
          <p role="status">正在录音 · {voice.inputLabel}。再次点击麦克风停止并转成文字。</p>
          {voice.level !== null && <div className="flex items-center gap-2">
            <meter aria-label="麦克风输入音量" min={0} max={1} value={voice.level} className="w-28" />
            <span>{voice.heard ? "已检测到声音" : "暂未检测到声音，请说话并检查输入音量或静音开关。"}</span>
          </div>}
        </div>
      )}
      {voice.isTranscribing && <p role="status" className="text-xs text-dim">正在转成文字，请稍候。</p>}
      {voice.error && <p role="alert" className="text-sm text-red">{voice.error}</p>}
    </div>
  );
}
