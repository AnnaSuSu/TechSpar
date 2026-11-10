import { useState, useRef, useCallback, useEffect } from "react";
import { transcribeAudio } from "../api/interview";
import { HandledApiError } from "../api/client";

interface VoiceInputOptions {
  onResult?: (text: string) => void;
}

export default function useVoiceInput({ onResult }: VoiceInputOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Check if getUserMedia is available
  const isSupported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const stopListening = useCallback(() => {
    setIsListening(false);

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setIsTranscribing(true);

    // Stop recording — triggers ondataavailable + onstop
    recorder.onstop = async () => {
      // Build audio blob from chunks
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      chunksRef.current = [];

      // Release microphone
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;

      // Very small recordings may not contain enough audio to transcribe.
      if (blob.size < 1000) {
        setError("录音内容太少，请说完一句话后再点击停止。");
        setIsTranscribing(false);
        return;
      }

      // Send to backend for transcription
      try {
        const { text } = (await transcribeAudio(blob)) as { text?: string };
        if (text?.trim()) {
          onResultRef.current?.(text);
        } else {
          setError("未识别到语音，请检查系统默认麦克风和输入音量后重试。");
        }
      } catch (err) {
        console.error("Transcription failed:", err);
        if (!(err instanceof HandledApiError)) {
          setError("语音识别失败，请检查网络或语音服务配置后重试。");
        }
      } finally {
        setIsTranscribing(false);
      }
    };

    recorder.stop();
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) return;
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        setIsListening(false);
        setIsTranscribing(false);
        setError("录音中断，请检查麦克风连接后重新录音。");
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // Collect data every 250ms
      setIsListening(true);
    } catch (err) {
      console.error("Microphone access failed:", err);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      const name = err instanceof Error ? err.name : "";
      setError(name === "NotAllowedError"
        ? "无法访问麦克风，请在系统设置中允许此应用使用麦克风后重试。"
        : name === "NotFoundError"
          ? "未找到麦克风，请连接麦克风并检查系统默认输入设备。"
          : name === "NotReadableError"
            ? "麦克风无法使用，请检查设备连接或关闭占用麦克风的应用后重试。"
            : "录音启动失败，请检查麦克风和系统声音设置后重试。");
      setIsListening(false);
    }
  }, [isSupported]);

  const toggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else if (!isTranscribing) {
      startListening();
    }
  }, [isListening, isTranscribing, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.onerror = null;
      }
      if (mediaRecorderRef.current?.state !== "inactive") {
        try {
          mediaRecorderRef.current?.stop();
        } catch {
          /* cleanup, safe to ignore */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { isListening, isTranscribing, isSupported, error, toggle };
}
