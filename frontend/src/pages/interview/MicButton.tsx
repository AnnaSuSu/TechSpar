import type useVoiceInput from "@/hooks/useVoiceInput";
import { cn } from "@/lib/utils";

type VoiceInput = ReturnType<typeof useVoiceInput>;

export default function MicButton({ voice, disabled = false }: { voice: VoiceInput; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0",
        voice.isListening ? "bg-red text-white animate-pulse-dot" : voice.isTranscribing ? "bg-orange text-white animate-pulse-dot" : "bg-hover text-dim hover:text-text"
      )}
      onClick={voice.toggle}
      disabled={disabled || voice.isStarting || voice.isTranscribing}
      aria-label={voice.isStarting ? "正在请求麦克风权限" : voice.isListening ? "停止录音并转成文字" : voice.isTranscribing ? "正在识别语音" : "语音输入"}
      title={voice.isStarting ? "正在请求麦克风权限" : voice.isListening ? "停止录音" : voice.isTranscribing ? "正在识别..." : "语音输入"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
  );
}
