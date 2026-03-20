import { useState, useRef, useCallback, useEffect } from "react";
import { transcribeAudio } from "../api/interview";

export default function useVoiceInput({ onResult } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const onResultRef = useRef(onResult);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // Check if getUserMedia is available
  const isSupported = typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia;

  const stopListening = useCallback(async () => {
    setIsListening(false);

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    // Stop recording — triggers ondataavailable + onstop
    return new Promise((resolve) => {
      recorder.onstop = async () => {
        // Build audio blob from chunks
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];

        // Release microphone
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        // Skip if too short (< 0.5s of data, likely accidental)
        if (blob.size < 1000) {
          resolve();
          return;
        }

        // Send to backend for transcription
        setIsTranscribing(true);
        try {
          const { text } = await transcribeAudio(blob);
          if (text && onResultRef.current) {
            onResultRef.current(text);
          }
        } catch (err) {
          console.error("Transcription failed:", err);
        } finally {
          setIsTranscribing(false);
        }
        resolve();
      };

      recorder.stop();
    });
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) return;

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

      mediaRecorderRef.current = recorder;
      recorder.start(250); // Collect data every 250ms
      setIsListening(true);
    } catch (err) {
      console.error("Microphone access failed:", err);
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (mediaRecorderRef.current?.state !== "inactive") {
        try { mediaRecorderRef.current?.stop(); } catch { /* cleanup, safe to ignore */ }
      }
    };
  }, []);

  return { isListening, isTranscribing, isSupported, toggle };
}
