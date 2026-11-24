import { useState, useRef, useCallback, useEffect } from "react";
import { VoiceInputSession, initialVoiceInputState } from "../lib/voice-input";

interface VoiceInputOptions {
  onResult?: (text: string) => void;
}

export default function useVoiceInput({ onResult }: VoiceInputOptions = {}) {
  const [state, setState] = useState(initialVoiceInputState);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const sessionRef = useRef<VoiceInputSession | null>(null);
  const onResultRef = useRef(onResult);
  const refreshDevicesRef = useRef<() => void>(() => {});

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const isSupported = typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const media = navigator.mediaDevices;
    const refresh = async () => {
      const current = ++revision;
      try {
        const devices = await media?.enumerateDevices?.();
        if (mounted && current === revision) setMicrophones(devices?.filter((device) => device.kind === "audioinput") || []);
      } catch { /* Recording can still use the system default device. */ }
    };
    refreshDevicesRef.current = () => { void refresh(); };
    void refresh();
    media?.addEventListener?.("devicechange", refresh);
    return () => {
      mounted = false;
      media?.removeEventListener?.("devicechange", refresh);
      refreshDevicesRef.current = () => {};
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setState(initialVoiceInputState);
  }, []);

  const toggle = useCallback(() => {
    const active = sessionRef.current;
    if (active?.state.status === "recording") { active.stop(); return; }
    // A synchronous session state also guards rapid clicks before React renders.
    if (active && active.state.status !== "idle") return;
    if (!isSupported) return;
    active?.cancel();
    const session = new VoiceInputSession({
      onChange(next) { if (sessionRef.current === session) setState(next); },
      onResult(text) { if (sessionRef.current === session) onResultRef.current?.(text); },
      onDeviceReady() { refreshDevicesRef.current(); },
    });
    sessionRef.current = session;
    void session.start(microphoneId);
  }, [isSupported, microphoneId]);

  return {
    ...state, isSupported, microphones, microphoneId, setMicrophoneId, toggle, cancel,
    isStarting: state.status === "starting",
    isListening: state.status === "recording",
    isTranscribing: state.status === "stopping" || state.status === "transcribing",
    isBusy: state.status !== "idle",
  };
}
