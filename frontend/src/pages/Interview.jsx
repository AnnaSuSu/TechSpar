import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Check, Minus, Star } from "lucide-react";
import ChatBubble from "../components/ChatBubble";
import { sendMessage, sendMessageStream, endInterview, retryReview, getResumableSession } from "../api/interview";
import { useTaskStatus } from "../contexts/TaskStatusContext";
import useVoiceInput from "../hooks/useVoiceInput";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Interview() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks, startTask } = useTaskStatus();
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Session bootstrap: populate either from router state (fresh start) or by
  // fetching /interview/session/:id/resume (opened via history).
  const [initData, setInitData] = useState(() => location.state || null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [sessionStatus, setSessionStatus] = useState(location.state?.status || null);
  const [resumeError, setResumeError] = useState(location.state?.review_error || "");

  const isBatchMode = initData?.mode === "topic_drill" || initData?.mode === "jd_prep";
  const isJobPrep = initData?.mode === "jd_prep";

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [progress] = useState(location.state?.progress || "");

  const [questions, setQuestions] = useState(location.state?.questions || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [drillInput, setDrillInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const drillVoice = useVoiceInput({
    onResult: useCallback((text) => setDrillInput((prev) => prev + text), []),
  });
  const chatVoice = useVoiceInput({
    onResult: useCallback((text) => setInput((prev) => prev + text), []),
  });

  useEffect(() => {
    // Fresh start from a landing page → location.state carries everything.
    if (location.state) {
      if (!isBatchMode && location.state.message) {
        setMessages([{ role: "assistant", content: location.state.message }]);
      }
      return;
    }
    // Resume-from-history: rebuild from server state.
    let cancelled = false;
    (async () => {
      try {
        const data = await getResumableSession(sessionId);
        if (cancelled) return;
        setInitData({
          mode: data.mode,
          topic: data.topic,
          target_role: data.target_role,
          questions: data.questions,
          meta: data.meta,
          company: data.meta?.company,
          position: data.meta?.position,
        });
        setQuestions(data.questions || []);
        setSessionStatus(data.status);
        setResumeError(data.review_error || "");
        if (data.mode === "resume") {
          setMessages((data.transcript || []).map((m) => ({ role: m.role, content: m.content })));
          // A session past its chat phase (ended / failed review / reviewing / reviewed)
          // locks the input and offers retry/view-review controls.
          if (!data.can_continue || data.is_finished || data.status !== "ongoing") {
            setFinished(true);
          }
        } else {
          // Batch modes: replay saved answers so user can review which ones were skipped.
          const saved = {};
          (data.transcript || []).forEach((entry, idx, arr) => {
            if (entry.role !== "user") return;
            const prev = arr[idx - 1];
            if (!prev || prev.role !== "assistant") return;
            const q = (data.questions || []).find((q) => q.question === prev.content);
            if (q) saved[q.id] = entry.content;
          });
          setAnswers(saved);
          if (data.status !== "ongoing") {
            setFinished(true);
            setSubmitted(true);
          }
        }
        // If a review is already in flight server-side, subscribe to its status
        // so the UI polls to "done" without needing the user to click anything.
        if (data.status === "reviewing") {
          const type = data.mode === "resume" ? "resume_review"
            : data.mode === "jd_prep" ? "jd_review" : "drill_review";
          startTask(sessionId, type, "复盘生成中");
        }
      } catch (err) {
        if (!cancelled) setBootstrapError(err.message || "无法加载面试");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isBatchMode) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, isBatchMode]);

  useEffect(() => {
    if (isBatchMode) textareaRef.current?.focus();
  }, [currentIndex, isBatchMode]);

  const currentQ = questions[currentIndex];
  const totalQ = questions.length;
  const answeredCount = Object.keys(answers).length;

  const handleDrillSubmit = () => {
    const text = drillInput.trim();
    if (!text || !currentQ) return;
    setAnswers((prev) => ({ ...prev, [currentQ.id]: text }));
    setDrillInput("");
    if (currentIndex < totalQ - 1) setCurrentIndex((i) => i + 1);
    else setFinished(true);
  };

  const handleSkip = () => {
    if (!currentQ) return;
    setDrillInput("");
    if (currentIndex < totalQ - 1) setCurrentIndex((i) => i + 1);
    else setFinished(true);
  };

  const handlePrev = () => {
    if (currentIndex <= 0) return;
    setDrillInput(answers[questions[currentIndex - 1]?.id] || "");
    setCurrentIndex((i) => i - 1);
  };

  const handleEndBatch = async () => {
    if (submitting) return;
    // Allow retry when the previous background evaluation errored.
    const priorTask = tasks.find((t) => t.id === sessionId);
    const isRetry = submitted && priorTask?.status === "error";
    if (submitted && !isRetry) return;
    setSubmitting(true);
    try {
      const answerList = questions.map((q) => ({
        question_id: q.id,
        answer: answers[q.id] || "",
      }));
      await endInterview(sessionId, answerList);
      setSubmitted(true);
      setFinished(true);
      const label = isJobPrep ? "JD 备面复盘生成中" : "专项训练复盘生成中";
      const type = isJobPrep ? "jd_review" : "drill_review";
      startTask(sessionId, type, label);
    } catch (err) {
      alert("提交失败: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);

    // Insert empty assistant message for streaming
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      await sendMessageStream(sessionId, text, {
        onToken: (token) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + token };
            return updated;
          });
        },
        onDone: (data) => {
          if (data.is_finished) setFinished(true);
        },
        onError: (err) => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: `[错误] ${err.message}` };
            return updated;
          });
        },
      });
    } catch {
      // SSE failed — fallback to non-streaming
      try {
        const data = await sendMessage(sessionId, text);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: data.message };
          return updated;
        });
        if (data.is_finished) setFinished(true);
      } catch (err) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: `[错误] ${err.message}` };
          return updated;
        });
      }
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleEndResume = async () => {
    setReviewing(true);
    try {
      await endInterview(sessionId);
      setFinished(true);
      setSessionStatus("reviewing");
      setResumeError("");
      startTask(sessionId, "resume_review", "简历面试复盘生成中");
    } catch (err) {
      alert("结束面试失败: " + err.message);
    } finally {
      setReviewing(false);
    }
  };

  const handleRetryResumeReview = async () => {
    setReviewing(true);
    try {
      await retryReview(sessionId);
      setSessionStatus("reviewing");
      setResumeError("");
      startTask(sessionId, "resume_review", "简历面试复盘生成中");
    } catch (err) {
      alert("重新生成失败: " + err.message);
    } finally {
      setReviewing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      isBatchMode ? handleDrillSubmit() : handleSend();
    }
  };

  const modeBadge = isJobPrep
    ? { text: "JD 备面", variant: "blue" }
    : initData?.mode === "topic_drill"
      ? { text: "专项训练", variant: "success" }
      : { text: "简历面试", variant: "default" };

  const MicButton = ({ voice }) => (
    <button
      type="button"
      className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0",
        voice.isListening ? "bg-red text-white animate-pulse-dot" : voice.isTranscribing ? "bg-orange text-white animate-pulse-dot" : "bg-hover text-dim hover:text-text"
      )}
      onClick={voice.toggle}
      disabled={voice.isTranscribing}
      title={voice.isListening ? "停止录音" : voice.isTranscribing ? "正在识别..." : "语音输入"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
  );

  // Bootstrap gate: show a skeleton while the resume payload is in flight, or
  // an error view if the session doesn't exist / can't be loaded.
  if (!initData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        {bootstrapError ? (
          <>
            <div className="text-[15px] text-red">{bootstrapError}</div>
            <Button variant="outline" onClick={() => navigate("/history")}>返回历史记录</Button>
          </>
        ) : (
          <>
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-32 w-full max-w-[720px]" />
            <Skeleton className="h-32 w-full max-w-[720px]" />
          </>
        )}
      </div>
    );
  }

  if (isBatchMode) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-border bg-card">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <Badge variant={modeBadge.variant}>{modeBadge.text}</Badge>
            {isJobPrep
              ? (
                <span className="text-sm text-dim">
                  {initData?.company ? `${initData.company} · ` : ""}{initData?.position || "目标岗位"}
                </span>
              )
              : initData?.topic && <span className="text-sm text-dim">{initData.topic}</span>}
            <span className="text-[13px] text-dim">{answeredCount}/{totalQ} 已答</span>
          </div>
          {(() => {
            const task = tasks.find((t) => t.id === sessionId);
            const headerTaskError = task?.status === "error";
            const headerDisabled = submitting || (submitted && !headerTaskError);
            return (
              <Button variant="destructive" size="sm" onClick={handleEndBatch} disabled={headerDisabled}>
                {submitting ? "评估中..." : headerTaskError ? "重新评估" : finished ? "查看评估" : isJobPrep ? "结束备面" : "结束训练"}
              </Button>
            );
          })()}
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
                  {(() => {
                    const task = tasks.find((t) => t.id === sessionId);
                    const taskDone = task?.status === "done";
                    const taskError = task?.status === "error";
                    const canRetry = submitted && taskError;
                    return (
                      <>
                        <Button
                          variant="gradient"
                          size="lg"
                          className="px-10"
                          onClick={
                            submitted && taskDone
                              ? () => navigate(`/review/${sessionId}`)
                              : !submitted || canRetry
                              ? handleEndBatch
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
                      </>
                    );
                  })()}
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
                            <Star key={i} size={13} className={i < currentQ.difficulty ? "text-primary fill-primary" : "text-dim"} />
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
                    className="w-full min-h-[80px] max-h-[240px] px-4 py-3 rounded-xl border border-border bg-input text-text resize-none text-sm leading-relaxed pr-12 placeholder:text-dim/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30"
                    value={drillInput}
                    onChange={(e) => setDrillInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={drillVoice.isListening ? "正在录音..." : drillVoice.isTranscribing ? "正在识别语音..." : "输入你的回答... (Enter 提交)"}
                    rows={3}
                  />
                  {drillVoice.isSupported && (
                    <div className="absolute bottom-3 right-3">
                      <MicButton voice={drillVoice} />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-3">
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

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-border bg-card">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <Badge variant={modeBadge.variant}>{modeBadge.text}</Badge>
          {initData?.topic && <span className="text-sm text-dim">{initData.topic}</span>}
          {progress && (
            <span className="text-[13px] text-dim flex items-center gap-1.5">
              <span className="text-border">|</span>
              进度: {progress}
            </span>
          )}
        </div>
        {(() => {
          const task = tasks.find((t) => t.id === sessionId);
          const taskDone = task?.status === "done" || sessionStatus === "reviewed";
          const taskError = task?.status === "error" || sessionStatus === "review_failed";
          // Four branches: live chat → end, review failed → retry, review in-flight → wait, review done → view.
          let handler;
          let label;
          if (taskDone) {
            handler = () => navigate(`/review/${sessionId}`);
            label = "查看复盘";
          } else if (taskError) {
            handler = handleRetryResumeReview;
            label = reviewing ? "重新生成中..." : "重新生成复盘";
          } else if (!finished) {
            handler = handleEndResume;
            label = reviewing ? "生成复盘中..." : "结束面试";
          } else {
            handler = undefined;
            label = "复盘生成中...";
          }
          return (
            <Button
              variant="destructive"
              size="sm"
              onClick={handler}
              disabled={reviewing || (!handler && !taskDone)}
            >
              {label}
            </Button>
          );
        })()}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col gap-7 max-w-3xl w-full mx-auto">
        {sessionStatus === "review_failed" && (
          <div className="rounded-xl border border-red/20 bg-red/5 px-4 py-3 text-[13px] leading-6 text-red/90">
            <div className="font-medium">复盘生成失败</div>
            {resumeError && <div className="mt-1 text-red/80">{resumeError}</div>}
            <div className="mt-1 text-dim">面试问答已保存；点击右上角"重新生成复盘"再次尝试。</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatBubble key={i} role={msg.role} content={msg.content} />
        ))}
        {sending && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].content && (
          <div className="flex items-center gap-2 animate-fade-in opacity-75 -mt-4">
            <div className="w-5 h-5 flex items-center justify-center shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
            </div>
            <span className="text-[13px] font-medium text-primary tracking-wide">AI 面试官正在思考回复中...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

        <div className="px-4 pt-4 pb-5 md:px-6 md:pb-6 flex justify-center">
          <div className="relative w-full max-w-3xl">
            <textarea
              ref={textareaRef}
              className="w-full px-4 py-4 md:px-5 pr-12 min-h-[80px] max-h-[240px] rounded-2xl border border-border bg-card text-text resize-none text-[15px] leading-normal placeholder:text-dim/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={chatVoice.isListening ? "正在录音..." : finished ? "面试已结束" : "输入你的回答... (Enter 发送)"}
              disabled={finished || sending}
              rows={3}
            />
            {chatVoice.isSupported && !finished && (
              <div className="absolute bottom-4 right-3">
                <MicButton voice={chatVoice} />
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
