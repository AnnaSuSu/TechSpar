import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Radio,
  Send,
  Sparkles,
} from "lucide-react";

import { getVoiceprintStatus } from "../../api/voiceprint";
import useCopilotStream from "../../hooks/useCopilotStream";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import CopilotPanel from "./CopilotPanel";

export default function RealtimePhase({ prepId, onBack }) {
  const [sessionId] = useState(() => crypto.randomUUID().slice(0, 12));
  const [conversation, setConversation] = useState([]);
  const [manualInput, setManualInput] = useState("");
  const [currentUpdate, setCurrentUpdate] = useState(null);
  const [riskAlert, setRiskAlert] = useState(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerStreaming, setAnswerStreaming] = useState(false);
  const [hrProfile, setHrProfile] = useState(null);
  const [monitorData, setMonitorData] = useState(null);
  const [perfMetrics, setPerfMetrics] = useState(null);
  const [inputRole, setInputRole] = useState("hr");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progressMsg, setProgressMsg] = useState("连接中...");
  const [started, setStarted] = useState(false);
  const [voiceprintAuto, setVoiceprintAuto] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    getVoiceprintStatus()
      .then((status) => setVoiceprintAuto(Boolean(status?.configured && status?.enrolled)))
      .catch(() => {});
  }, []);

  const handleUpdate = useCallback((msg) => {
    switch (msg.type) {
      case "copilot_update":
        setCurrentUpdate(msg);
        setStreamingAnswer("");
        setAnswerLoading(true);
        setAnswerStreaming(false);
        setPerfMetrics(null);
        break;
      case "answer_chunk":
        setStreamingAnswer((prev) => prev + (msg.text || ""));
        setAnswerLoading(false);
        setAnswerStreaming(true);
        break;
      case "answer_meta":
        setPerfMetrics((prev) => ({ ...prev, warming: false, firstTokenMs: msg.first_token_ms }));
        break;
      case "answer_done":
        setAnswerLoading(false);
        setAnswerStreaming(false);
        setPerfMetrics((prev) => ({ ...prev, warming: false, totalMs: msg.total_ms, chunkCount: msg.chunk_count }));
        break;
      case "hr_profile_update":
        setHrProfile(msg);
        break;
      case "monitor_update":
        setMonitorData(msg);
        break;
      case "risk_alert":
        setRiskAlert(msg);
        break;
      case "progress":
        setProgressMsg(msg.message);
        break;
      case "started":
        setStarted(true);
        setProgressMsg("");
        setPerfMetrics({ warming: true });
        break;
      case "asr_final":
        if (msg.text) {
          const role = msg.role === "candidate" ? "candidate" : "hr";
          setConversation((prev) => [...prev, { role, text: msg.text }]);
        }
        break;
      case "error":
        setAnswerLoading(false);
        setAnswerStreaming(false);
        setProgressMsg(`Error: ${msg.message}`);
        break;
    }
  }, []);

  const {
    connected,
    listening,
    asrText,
    connect,
    startListening,
    stopListening,
    sendManualText,
    sendCandidateResponse,
    disconnect,
  } = useCopilotStream({ prepId, onUpdate: handleUpdate });

  useEffect(() => {
    connect(sessionId);
  }, [connect, sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, currentUpdate]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  const handleManualSend = () => {
    const text = manualInput.trim();
    if (!text) return;

    if (inputRole === "hr") {
      setConversation((prev) => [...prev, { role: "hr", text }]);
      sendManualText(text);
    } else {
      setConversation((prev) => [...prev, { role: "candidate", text }]);
      sendCandidateResponse(text);
    }

    setManualInput("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleManualSend();
    }
  };

  const handleEnd = () => {
    disconnect();
    onBack();
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0 bg-card/50">
        <div className="flex items-center gap-3">
          <Brain size={20} className="text-primary" />
          <span className="font-semibold text-sm">面试 Copilot</span>
          <Badge variant={connected ? "green" : "destructive"} className={cn("text-xs", connected && "copilot-connected-pulse")}>
            <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1.5", connected ? "bg-green copilot-breathe" : "bg-red")} />
            {connected ? "已连接" : "未连接"}
          </Badge>
          {perfMetrics && (
            <div className="flex items-center gap-1.5 text-[11px] text-dim/70 tabular-nums ml-2 bg-card/80 border border-border/50 rounded-full px-2.5 py-1">
              {perfMetrics.warming ? (
                <>
                  <Loader2 size={10} className="animate-spin text-primary/50" />
                  <span>LLM 测速中...</span>
                </>
              ) : (
                <>
                  <Sparkles size={10} className="text-primary/50" />
                  <span>{(perfMetrics.firstTokenMs / 1000).toFixed(1)}s 首token</span>
                  {perfMetrics.totalMs > 0 && (
                    <>
                      <span className="text-border">·</span>
                      <span>{(perfMetrics.totalMs / 1000).toFixed(1)}s 总耗时</span>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={listening ? "destructive" : "outline"}
            className="rounded-2xl"
            onClick={listening ? stopListening : startListening}
            disabled={!connected || !started}
          >
            {listening ? <MicOff size={14} className="mr-1.5" /> : <Mic size={14} className="mr-1.5" />}
            {listening ? "停止录音" : "开始录音"}
          </Button>
          <Button size="icon" variant="ghost" className="rounded-2xl h-9 w-9" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button size="sm" variant="ghost" className="rounded-2xl" onClick={handleEnd}>
            结束面试
          </Button>
        </div>
      </div>

      {progressMsg && (
        <div className="px-5 py-2.5 bg-gradient-to-r from-primary/8 to-primary/3 border-b border-primary/10 text-sm text-primary flex items-center gap-2 shrink-0">
          <Loader2 size={14} className="animate-spin" /> {progressMsg}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          {asrText && (
            <div className="px-5 py-2.5 bg-card/50 border-b border-border/50 text-sm text-dim shrink-0">
              <span className="inline-block w-2 h-2 rounded-full bg-red animate-pulse mr-2 align-middle" />
              HR: {asrText}
            </div>
          )}

          <div className="px-5 py-3 border-b border-border/40 bg-background/40 backdrop-blur-md shrink-0 grid grid-cols-2 gap-3 shadow-[0_1px_15px_rgba(0,0,0,0.02)] z-10">
            <div className="min-w-0 rounded-xl border border-border/50 bg-card/65 px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", monitorData?.phase ? "bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "bg-dim/30")} />
                <span className="font-bold text-text uppercase tracking-[0.16em] text-[11px]">
                  {monitorData?.phase || "监听引擎"}
                </span>
              </div>
              <p className={cn("text-[12.5px] leading-[1.55] line-clamp-2", monitorData?.strategy_tip ? "text-cyan-400/95 font-medium" : "text-dim/40")}>
                {monitorData?.strategy_tip || "等待对话启动分析..."}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-border/50 bg-card/65 px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", hrProfile ? "bg-violet-500 animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.8)]" : "bg-dim/30")} />
                <span className="font-bold text-text uppercase tracking-[0.16em] text-[11px]">HR 行为基线</span>
              </div>
              <p className={cn("text-[12.5px] leading-[1.55] line-clamp-2", hrProfile ? "text-violet-400/95 font-medium" : "text-dim/40")}>
                {hrProfile ? `${hrProfile.style} · ${hrProfile.advice}` : "数据采集中 (0/3 轮)"}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 relative bg-card/10">
            {conversation.length === 0 && started && (
              <div className="flex flex-col items-center justify-center h-full text-dim text-sm relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 dark:opacity-30">
                  <div className="w-[120px] h-[120px] rounded-full border border-primary/20 animate-ping" style={{ animationDuration: "3s" }} />
                  <div className="absolute w-[240px] h-[240px] rounded-full border border-primary/10 animate-ping" style={{ animationDuration: "4s" }} />
                </div>

                <div className="relative mb-6 z-10 flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)]">
                  <Mic size={28} className="animate-pulse" />
                </div>
                <p className="font-medium tracking-widest uppercase text-[12px] z-10 text-text/80">AI Copilot 雷达已开启</p>
                <p className="text-[12px] text-dim/50 mt-1.5 z-10">开始录音或在下方手动输入 HR 的开场白...</p>
              </div>
            )}
            {conversation.length === 0 && !started && (
              <div className="flex flex-col items-center justify-center h-full">
                <Loader2 size={28} className="animate-spin text-primary/30 mb-3" />
                <p className="text-sm text-dim/50 uppercase tracking-widest text-[10px] font-bold">Initializing Engine...</p>
              </div>
            )}
            {conversation.map((msg, index) => (
              <div
                key={index}
                className={cn(
                  "text-sm rounded-2xl px-4 py-3 max-w-[85%] shadow-sm",
                  msg.role === "hr" ? "bg-background border border-border/60" : "bg-primary/15 ml-auto border border-primary/10"
                )}
              >
                <span className="text-[10px] uppercase tracking-widest text-dim/70 font-bold block mb-1">
                  {msg.role === "hr" ? "HR" : "You"}
                </span>
                <span className="leading-relaxed">{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3 bg-card/20 md:px-6">
            {voiceprintAuto ? (
              <div
                className="rounded-xl h-[46px] px-3 shrink-0 text-[11px] font-semibold min-w-[56px] shadow-sm flex items-center justify-center bg-primary/10 text-primary border border-primary/25"
                title="已启用声纹自动识别 HR/You"
              >
                <Radio size={14} className="mr-1" />
                Auto
              </div>
            ) : (
              <Button
                size="sm"
                variant={inputRole === "hr" ? "outline" : "secondary"}
                className="rounded-xl h-[46px] px-3 shrink-0 text-xs font-semibold min-w-[56px] shadow-sm transition-all"
                onClick={() => setInputRole(inputRole === "hr" ? "candidate" : "hr")}
                disabled={!connected || !started}
              >
                {inputRole === "hr" ? "HR" : "You"}
              </Button>
            )}
            <Input
              className="h-[46px] rounded-xl border-border/80 bg-background shadow-sm px-4 focus-visible:bg-card/50"
              placeholder={inputRole === "hr" ? "手动输入 HR 的问题..." : "记录你的回答..."}
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!connected || !started}
            />
            <Button
              size="icon"
              className="rounded-xl h-[46px] w-[46px] shrink-0 shadow-sm"
              onClick={handleManualSend}
              disabled={!manualInput.trim() || !started}
            >
              <Send size={16} />
            </Button>
          </div>
        </div>

        <div className="w-[340px] xl:w-[420px] shrink-0 overflow-y-auto bg-card/[0.03] border-l border-border/50">
          <CopilotPanel
            update={currentUpdate}
            riskAlert={riskAlert}
            streamingAnswer={streamingAnswer}
            answerLoading={answerLoading}
            answerStreaming={answerStreaming}
            monitorData={monitorData}
          />
        </div>
      </div>
    </div>
  );
}
