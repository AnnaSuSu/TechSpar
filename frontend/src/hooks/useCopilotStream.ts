import { useState, useRef, useCallback, useEffect } from 'react';
import { encodeCopilotAudio } from '@techspar/contracts';
import { decodeCopilotEvent, type CopilotServerEvent } from '../api/events';
import { CopilotAudioCapture, emptyAudioLevel } from '../lib/copilot-audio';
import { isDesktopApp } from '../lib/desktop';

export type CopilotMessage = CopilotServerEvent;
interface CopilotStreamOptions { prepId?: string; onUpdate?: (msg: CopilotMessage) => void }

export default function useCopilotStream({ prepId, onUpdate }: CopilotStreamOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [asrText, setAsrText] = useState({ hr: '', candidate: '' });
  const [levels, setLevels] = useState({ system: emptyAudioLevel(), microphone: emptyAudioLevel() });
  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<CopilotAudioCapture | null>(null);
  const readyRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionIdRef = useRef<string | null>(null);
  const manualClose = useRef(false);
  const connectRef = useRef<((sessionId: string) => void) | null>(null);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const stopListening = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setListening(false);
    setStarting(false);
    setLevels({ system: emptyAudioLevel(), microphone: emptyAudioLevel() });
    setAsrText({ hr: '', candidate: '' });
  }, []);

  const connect = useCallback((sessionId: string) => {
    if (!isDesktopApp() || (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN)) return;
    sessionIdRef.current = sessionId;
    manualClose.current = false;
    readyRef.current = false;
    setAudioReady(false);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('token') || '';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/copilot/${sessionId}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen = () => {
      if (wsRef.current !== ws || manualClose.current) { ws.close(); return; }
      setConnected(true);
      ws.send(JSON.stringify({ type: 'start', prep_id: prepId, audio_mode: 'dual' }));
    };
    ws.onmessage = (event) => {
      if (wsRef.current !== ws || manualClose.current) return;
      let msg: CopilotServerEvent;
      try { msg = decodeCopilotEvent(event.data); }
      catch { stopListening(); setAudioError('服务端返回了无法识别的消息，请更新桌面端或重新进入'); return; }
      if (msg.type === 'started') {
        readyRef.current = msg.audio_ready === true;
        setAudioReady(readyRef.current);
        if (!readyRef.current) setAudioError('双路语音识别未就绪，请检查 DashScope 配置及服务端版本后重新进入');
      }
      if (msg.type === 'asr_interim') { setAsrText((prev) => ({ ...prev, [msg.role || 'hr']: msg.text })); return; }
      if (msg.type === 'asr_final') setAsrText((prev) => ({ ...prev, [msg.role || 'hr']: '' }));
      if (msg.type === 'error' && msg.message.startsWith('ASR')) {
        readyRef.current = false;
        setAudioReady(false);
        stopListening();
        setAudioError(msg.message);
      }
      onUpdateRef.current?.(msg);
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      const wasCapturing = Boolean(captureRef.current);
      stopListening();
      readyRef.current = false;
      setAudioReady(false);
      setConnected(false);
      wsRef.current = null;
      if (wasCapturing) setAudioError('连接已断开，音频采集已停止。重连后请手动重新开始');
      if (!manualClose.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => { if (sessionIdRef.current) connectRef.current?.(sessionIdRef.current); }, 2000);
      }
    };
    ws.onerror = () => { if (wsRef.current === ws) ws.close(); };
  }, [prepId, stopListening]);
  useEffect(() => { connectRef.current = connect; }, [connect]);

  const startListening = useCallback(async (microphoneId?: string) => {
    if (!isDesktopApp() || captureRef.current || !readyRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setAudioError('');
    setStarting(true);
    const capture = new CopilotAudioCapture({
      microphoneId,
      onPcm: (source, pcm) => {
        const ws = wsRef.current;
        if (ws?.readyState !== WebSocket.OPEN || !readyRef.current) return;
        if (ws.bufferedAmount > 1024 * 1024) {
          stopListening();
          setAudioError('网络发送过慢，已停止采集，避免声音持续延迟。请检查网络后重试');
          return;
        }
        ws.send(encodeCopilotAudio(source, pcm));
      },
      onLevel: (source, level) => setLevels((prev) => ({ ...prev, [source]: level })),
      onInterrupted: (message) => { stopListening(); setAudioError(message); },
    });
    captureRef.current = capture;
    try {
      await capture.start();
      if (captureRef.current !== capture) return;
      setStarting(false);
      setListening(true);
    } catch (error) {
      if (captureRef.current !== capture) return;
      stopListening();
      const name = error instanceof Error ? error.name : '';
      setAudioError(name === 'NotAllowedError' ? '音频授权未完成。请允许麦克风和系统音频访问，再重新开始' : name === 'NotFoundError' || name === 'OverconstrainedError' ? '所选麦克风不可用，请重新选择设备' : error instanceof Error ? error.message : '音频采集启动失败');
    }
  }, [stopListening]);

  const sendManualText = useCallback((text: string) => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'manual', text })); }, []);
  const sendCandidateResponse = useCallback((text: string) => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'candidate_response', text })); }, []);
  const disconnect = useCallback(() => {
    manualClose.current = true;
    clearTimeout(reconnectTimer.current);
    stopListening();
    readyRef.current = false;
    setAudioReady(false);
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
    ws?.close();
    setConnected(false);
  }, [stopListening]);
  useEffect(() => () => disconnect(), [disconnect]);
  return { connected, listening, starting, audioReady, audioError, levels, asrText, connect, startListening, stopListening, sendManualText, sendCandidateResponse, disconnect };
}
