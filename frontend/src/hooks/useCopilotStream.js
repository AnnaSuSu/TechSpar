import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Copilot 实时面试辅助 WebSocket hook。
 *
 * 职责：
 * 1. 建立 WebSocket 连接
 * 2. 采集麦克风音频并转为 PCM 推流
 * 3. 接收 ASR 结果和 Agent 分析结果
 */
export default function useCopilotStream({ prepId, onUpdate } = {}) {
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [asrText, setAsrText] = useState("");       // 中间结果（实时字幕）
  const [lastFinal, setLastFinal] = useState("");    // 最近的句末结果

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const workletRef = useRef(null);
  const audioCtxRef = useRef(null);
  const onUpdateRef = useRef(onUpdate);
  const reconnectTimer = useRef(null);
  const sessionIdRef = useRef(null);
  const manualClose = useRef(false);

  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const scheduleReconnect = useCallback(() => {
    if (manualClose.current || !sessionIdRef.current) return;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      console.log("[Copilot WS] reconnecting...");
      connect(sessionIdRef.current);
    }, 2000);
  }, []);  // connect added below via circular ref — safe because scheduleReconnect only reads it

  /** 建立 WebSocket 连接 */
  const connect = useCallback((sessionId) => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    sessionIdRef.current = sessionId;
    manualClose.current = false;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Append JWT so backend can load per-user voiceprint config
    const token = localStorage.getItem("token") || "";
    const tokenQs = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/copilot/${sessionId}${tokenQs}`);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "start", prep_id: prepId }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log("[Copilot WS]", msg.type, msg);
        switch (msg.type) {
          case "asr_interim":
            setAsrText(msg.text || "");
            break;
          case "asr_final":
            setAsrText("");
            setLastFinal(msg.text || "");
            if (onUpdateRef.current) onUpdateRef.current(msg);
            break;
          case "copilot_update":
          case "risk_alert":
          case "answer_chunk":
          case "answer_meta":
          case "answer_done":
          case "hr_profile_update":
          case "monitor_update":
          case "progress":
          case "started":
          case "stopped":
          case "error":
            if (onUpdateRef.current) onUpdateRef.current(msg);
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      if (wsRef.current === ws) {
        setConnected(false);
      }
    };

    wsRef.current = ws;
  }, [prepId, scheduleReconnect]);

  /** 开始录音并推流 PCM */
  const startListening = useCallback(async () => {
    if (!wsRef.current || listening) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessor fallback (AudioWorklet requires HTTPS + module)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        // Float32 → Int16 PCM
        const pcm = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      workletRef.current = processor;
      setListening(true);
    } catch (err) {
      console.error("Mic access failed:", err);
    }
  }, [listening]);

  /** 停止录音 */
  const stopListening = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setListening(false);
  }, []);

  /** 手动输入 HR 发言 */
  const sendManualText = useCallback((text) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "manual", text }));
    }
  }, []);

  /** 手动输入候选人回答 */
  const sendCandidateResponse = useCallback((text) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "candidate_response", text }));
    }
  }, []);

  /** 断开连接 */
  const disconnect = useCallback(() => {
    manualClose.current = true;
    clearTimeout(reconnectTimer.current);
    stopListening();
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch { /* ok */ }
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, [stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      manualClose.current = true;
      clearTimeout(reconnectTimer.current);
      stopListening();
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* cleanup */ }
      }
    };
  }, [stopListening]);

  return {
    connected,
    listening,
    asrText,
    lastFinal,
    connect,
    startListening,
    stopListening,
    sendManualText,
    sendCandidateResponse,
    disconnect,
  };
}
