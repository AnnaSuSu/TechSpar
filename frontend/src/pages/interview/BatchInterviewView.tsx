import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Check, Minus, Star } from "lucide-react";
import useVoiceInput from "@/hooks/useVoiceInput";
import VoiceInputFeedback from "@/components/VoiceInputFeedback";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import MicButton from "./MicButton";
import type { InterviewSession } from "./useInterviewSession";

export default function BatchInterviewView({ session }: { session: InterviewSession }) {
  const { initData, sessionId, task, sessionStatus, finished, handleKeyDown, batch } = session;
  const {
    questions, currentQ, currentIndex, answers, drillInput, setDrillInput,
    confidences, setConfidences, submitting, submitted, handleEndBatch,
    handleDrillSubmit, handleSkip, handlePrev,
  } = batch;
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const drillVoice = useVoiceInput({ onResult: (text) => setDrillInput((previous) => previous + text) });
  const cancelDrillVoice = drillVoice.cancel;
  const [selfAssess, setSelfAssess] = useState(() => localStorage.getItem("drill-self-assess") !== "off");
  const isJobPrep = initData.mode === "jd_prep";
  const isDrill = initData.mode === "topic_drill";
  const totalQ = questions.length;
  const answeredCount = Object.keys(answers).length;
  const taskDone = task?.status === "done";
  const taskError = task?.status === "error" || sessionStatus === "review_failed";
  const canRetry = (submitted || sessionStatus === "review_failed") && taskError;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [currentIndex]);

  useEffect(() => {
    return () => { cancelDrillVoice(); };
  }, [sessionId, currentIndex, cancelDrillVoice]);

  useEffect(() => {
    if (finished) cancelDrillVoice();
  }, [finished, cancelDrillVoice]);

  const onEndBatch = () => {
    cancelDrillVoice();
    void handleEndBatch();
  };

  const toggleSelfAssess = () => {
    localStorage.setItem("drill-self-assess", selfAssess ? "off" : "on");
    setSelfAssess(!selfAssess);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-border bg-card">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <Badge variant={isJobPrep ? "blue" : "success"}>{isJobPrep ? "JD 备面" : "专项训练"}</Badge>
          {isJobPrep
            ? (
              <span className="text-sm text-dim">
                {initData.company ? `${initData.company} · ` : ""}{initData.position || "目标岗位"}
              </span>
            )
            : initData.topic && <span className="text-sm text-dim">{initData.topic}</span>}
          <span className="text-[13px] text-dim">{answeredCount}/{totalQ} 已答</span>
          {isJobPrep && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/mock-interview?mode=targeted&session=${encodeURIComponent(sessionId)}`)}
            >
              查看岗位方案
            </Button>
          )}
        </div>
        <Button variant="destructive" size="sm" onClick={onEndBatch} disabled={submitting || (submitted && !taskError)}>
          {submitting ? "评估中..." : taskError ? "重新评估" : finished ? "查看评估" : isJobPrep ? "结束备面" : "结束训练"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col items-center gap-5">
        {submitting ? (
          <div className="w-full max-w-[720px] flex flex-col items-center justify-center gap-4 py-15 text-dim text-base">
            <div className="flex gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.2s]" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.4s]" />
            </div>
            <span>{isJobPrep ? "正在生成岗位匹配复盘..." : "正在批量评估你的回答..."}</span>
            <span className="text-[13px] text-dim opacity-60">
              {isJobPrep ? "AI 会结合 JD 判断你的真实匹配度" : `AI 将对 ${totalQ} 道题逐一点评`}
            </span>
          </div>
        ) : finished ? (
          <div className="w-full max-w-[720px]">
            <Card className="mb-5">
              <CardContent className="p-6 md:p-8 text-center">
                <div className="text-xl font-semibold mb-3">{isJobPrep ? "定向备面完成" : "训练完成"}</div>
                <div className="text-[15px] text-dim mb-6 leading-relaxed">
                  共 {totalQ} 题，已回答 {answeredCount} 题，跳过 {totalQ - answeredCount} 题
                </div>
                <Button
                  variant="gradient"
                  size="lg"
                  className="px-10"
                  onClick={
                    submitted && taskDone
                      ? () => navigate(`/review/${sessionId}`)
                      : !submitted || canRetry
                      ? onEndBatch
                      : undefined
                  }
                  disabled={submitting || (submitted && !taskDone && !taskError)}
                >
                  {submitting ? "提交中..." : !submitted ? "提交评估" : taskDone ? "查看复盘" : taskError ? "重新评估" : "复盘生成中..."}
                </Button>
                {submitted && !taskDone && !taskError && (
                  <div className="flex items-center gap-2 mt-3 text-[13px] text-dim">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
                    AI 正在生成复盘报告，请稍候
                  </div>
                )}
                {taskError && (
                  <div className="mt-3 text-[13px] text-red">
                    评估生成失败，点击上方按钮可重新提交
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="flex flex-col gap-1.5">
              {questions.map((q) => (
                <div key={q.id} className="flex items-center gap-2 px-3 py-2 bg-hover rounded-lg text-[13px] text-dim">
                  {answers[q.id]
                    ? <Check size={14} className="text-green" />
                    : <Minus size={14} className="text-dim opacity-50" />}
                  <span>Q{q.id}: {q.question.slice(0, 60)}{q.question.length > 60 ? "..." : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ) : currentQ ? (
          <>
            <div className="w-full max-w-[720px] flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-in-out" style={{ width: `${(currentIndex / totalQ) * 100}%` }} />
              </div>
              <span className="text-[13px] text-dim whitespace-nowrap">{currentIndex + 1} / {totalQ}</span>
            </div>

            <Card className="w-full max-w-[720px] animate-fade-in">
              <CardContent className="p-5 md:p-8">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary/30">
                      Q{currentQ.id}
                    </Badge>
                    {currentQ.category && (
                      <Badge variant={isJobPrep ? "blue" : "secondary"}>{currentQ.category}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {currentQ.focus_area && (
                      <Badge variant="secondary">{currentQ.focus_area}</Badge>
                    )}
                    {currentQ.difficulty && (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} size={13} className={i < (currentQ.difficulty ?? 0) ? "text-primary fill-primary" : "text-dim"} />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-base leading-[1.8]">
                  <div className="md-content">
                    <ReactMarkdown>{currentQ.question}</ReactMarkdown>
                  </div>
                </div>
                {isJobPrep && currentQ.intent && (
                  <div className="mt-4 rounded-xl bg-blue-500/8 border border-blue-500/15 px-4 py-3 text-sm leading-relaxed text-dim">
                    <span className="text-blue-300 font-medium">面试官在看什么：</span> {currentQ.intent}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="w-full max-w-[720px] flex flex-col gap-3 py-2">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  className="w-full min-h-[80px] max-h-[240px] px-4 py-3 rounded-xl border border-border bg-input-bg text-text resize-none text-sm leading-relaxed pr-12 placeholder:text-dim/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30"
                  value={drillInput}
                  onChange={(e) => setDrillInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={drillVoice.isListening ? "正在录音..." : drillVoice.isTranscribing ? "正在识别语音..." : "输入你的回答... (Enter 提交)"}
                  rows={3}
                />
                {drillVoice.isSupported && (
                  <div className="absolute bottom-3 right-3">
                    <MicButton voice={drillVoice} disabled={submitting} />
                  </div>
                )}
              </div>
              <VoiceInputFeedback voice={drillVoice} />
              <div className="flex items-center justify-end gap-3">
                {isDrill && (selfAssess ? (
                  <div className="mr-auto flex items-center gap-2">
                    <span className="text-[12px] text-dim">这题有把握吗？</span>
                    {([
                      { key: "high", label: "有把握" },
                      { key: "low", label: "没把握" },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setConfidences((prev) => ({
                          ...prev,
                          [currentQ.id]: prev[currentQ.id] === key ? undefined : key,
                        }))}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[12px] transition-colors cursor-pointer",
                          confidences[currentQ.id] === key
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border text-dim hover:text-text"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={toggleSelfAssess}
                      className="text-[12px] text-dim/50 hover:text-dim transition-colors cursor-pointer"
                      title="关闭答题自评"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={toggleSelfAssess}
                    className="mr-auto text-[11px] text-dim/50 hover:text-dim transition-colors cursor-pointer"
                  >
                    开启答题自评
                  </button>
                ))}
                <Button variant="ghost" size="sm" onClick={handleSkip}>
                  跳过
                </Button>
                <Button variant="gradient" className="px-7 py-3.5 text-[15px]" disabled={!drillInput.trim()} onClick={handleDrillSubmit}>
                  {currentIndex < totalQ - 1 ? "下一题" : "完成"}
                </Button>
              </div>
            </div>

            {currentIndex > 0 && (
              <div className="w-full max-w-[720px]">
                <button className="py-1.5 text-dim text-[13px] hover:text-text transition-colors cursor-pointer" onClick={handlePrev}>
                  ← 上一题
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
