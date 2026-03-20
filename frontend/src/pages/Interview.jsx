import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Check, Minus, Star } from "lucide-react";
import ChatBubble from "../components/ChatBubble";
import { sendMessage, endInterview } from "../api/interview";
import useVoiceInput from "../hooks/useVoiceInput";

export default function Interview() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  const initData = location.state || {};
  const isDrill = initData.mode === "topic_drill";

  // Chat mode state (resume)
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [progress, setProgress] = useState(initData.progress || "");

  // Drill mode state
  const [questions] = useState(initData.questions || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [drillInput, setDrillInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Voice input for drill mode
  const drillVoice = useVoiceInput({
    onResult: useCallback((text) => setDrillInput((prev) => prev + text), []),
  });

  // Voice input for chat mode
  const chatVoice = useVoiceInput({
    onResult: useCallback((text) => setInput((prev) => prev + text), []),
  });

  useEffect(() => {
    if (!isDrill && initData.message) {
      setMessages([{ role: "assistant", content: initData.message }]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDrill) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDrill) textareaRef.current?.focus();
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drill handlers ──
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

  const handleEndDrill = async () => {
    setSubmitting(true);
    try {
      const answerList = questions.map((q) => ({
        question_id: q.id,
        answer: answers[q.id] || "",
      }));
      const data = await endInterview(sessionId, answerList);
      navigate(`/review/${sessionId}`, {
        state: { review: data.review, scores: data.scores, overall: data.overall, questions, answers: answerList, mode: "topic_drill" },
      });
    } catch (err) {
      alert("评估失败: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Resume chat handlers ──
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    try {
      const data = await sendMessage(sessionId, text);
      setMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
      if (data.progress) setProgress(data.progress);
      if (data.is_finished) setFinished(true);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `[错误] ${err.message}` }]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleEndResume = async () => {
    setReviewing(true);
    try {
      const data = await endInterview(sessionId);
      navigate(`/review/${sessionId}`, {
        state: {
          review: data.review,
          messages,
          mode: "resume",
          dimension_scores: data.dimension_scores,
          avg_score: data.avg_score,
        },
      });
    } catch (err) {
      alert("复盘生成失败: " + err.message);
    } finally {
      setReviewing(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      isDrill ? handleDrillSubmit() : handleSend();
    }
  };

  const modeBadge = isDrill
    ? { text: "专项训练", cls: "bg-green/15 text-green" }
    : { text: "简历面试", cls: "bg-accent/15 text-accent-light" };

  // ── Drill card mode ──
  if (isDrill) {
    return (
      <div className="flex-1 flex flex-col h-[calc(100vh-65px)]">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-border bg-card">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${modeBadge.cls}`}>{modeBadge.text}</span>
            {initData.topic && <span className="text-sm text-dim">{initData.topic}</span>}
            <div className="text-[13px] text-dim">{answeredCount}/{totalQ} 已答</div>
          </div>
          <button
            className={`px-4 py-2 md:px-5 rounded-lg bg-red/15 text-red text-sm font-medium transition-all ${submitting ? "opacity-40" : ""}`}
            onClick={handleEndDrill}
            disabled={submitting}
          >
            {submitting ? "评估中..." : finished ? "查看评估" : "结束训练"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col items-center gap-5">
          {submitting ? (
            <div className="w-full max-w-[720px] flex flex-col items-center justify-center gap-4 py-15 text-dim text-base">
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-light animate-pulse-dot" />
                <div className="w-1.5 h-1.5 rounded-full bg-accent-light animate-pulse-dot [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-accent-light animate-pulse-dot [animation-delay:0.4s]" />
              </div>
              <span>正在批量评估你的回答...</span>
              <span className="text-[13px] text-dim opacity-60">AI 将对 {totalQ} 道题逐一点评</span>
            </div>
          ) : finished ? (
            <div className="w-full max-w-[720px]">
              <div className="bg-card border border-border rounded-2xl px-6 py-7 md:px-8 text-center">
                <div className="text-xl font-semibold mb-3">训练完成</div>
                <div className="text-[15px] text-dim mb-6 leading-relaxed">
                  共 {totalQ} 题，已回答 {answeredCount} 题，跳过 {totalQ - answeredCount} 题
                </div>
                <button className="px-10 py-3.5 rounded-box bg-accent text-white font-semibold text-base" onClick={handleEndDrill}>
                  提交评估
                </button>
              </div>
              <div className="mt-5 flex flex-col gap-1.5">
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
              {/* Progress bar */}
              <div className="w-full max-w-[720px] flex items-center gap-2">
                <div className="flex-1 h-1 rounded-sm bg-border overflow-hidden">
                  <div className="h-full rounded-sm bg-accent transition-[width] duration-300 ease-in-out" style={{ width: `${(currentIndex / totalQ) * 100}%` }} />
                </div>
                <span className="text-[13px] text-dim whitespace-nowrap">{currentIndex + 1} / {totalQ}</span>
              </div>

              {/* Question card */}
              <div className="w-full max-w-[720px] bg-card border border-border rounded-2xl px-5 py-6 md:px-8 md:py-7 animate-fade-in">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] font-semibold text-accent-light bg-accent/12 px-3 py-1 rounded-md">Q{currentQ.id}</span>
                  <div className="flex items-center gap-2">
                    {currentQ.focus_area && (
                      <span className="text-xs text-dim bg-hover px-2 py-0.5 rounded">{currentQ.focus_area}</span>
                    )}
                    {currentQ.difficulty && (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} size={13} className={i < currentQ.difficulty ? "text-accent-light fill-accent-light" : "text-dim"} />
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
              </div>

              {/* Input area */}
              <div className="w-full max-w-[720px] flex flex-col md:flex-row gap-3 py-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    className="w-full px-4 py-3.5 rounded-box border border-border bg-input text-text resize-none outline-none min-h-[80px] max-h-[240px] leading-relaxed text-[15px]"
                    value={drillInput}
                    onChange={(e) => setDrillInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={drillVoice.isListening ? "正在录音，再次点击麦克风停止..." : drillVoice.isTranscribing ? "正在识别语音..." : "输入你的回答... (Enter 提交, Shift+Enter 换行)"}
                    rows={3}
                  />
                  {drillVoice.isSupported && (
                    <button
                      className={`absolute right-2 bottom-2 w-9 h-9 rounded-full flex items-center justify-center transition-all
                        ${drillVoice.isListening ? "bg-red text-white animate-pulse-dot" : drillVoice.isTranscribing ? "bg-orange text-white animate-pulse-dot" : "bg-hover text-dim hover:text-text"}`}
                      onClick={drillVoice.toggle}
                      disabled={drillVoice.isTranscribing}
                      title={drillVoice.isListening ? "停止录音" : drillVoice.isTranscribing ? "正在识别..." : "语音输入"}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="23"/>
                        <line x1="8" y1="23" x2="16" y2="23"/>
                      </svg>
                    </button>
                  )}
                </div>
                <div className="flex md:flex-col gap-2 self-end md:self-end">
                  <button
                    className={`px-7 py-3.5 rounded-box bg-accent text-white font-semibold text-[15px] transition-opacity ${!drillInput.trim() ? "opacity-40" : ""}`}
                    onClick={handleDrillSubmit}
                    disabled={!drillInput.trim()}
                  >
                    {currentIndex < totalQ - 1 ? "下一题" : "完成"}
                  </button>
                  <button className="px-4 py-2 rounded-box bg-transparent text-dim text-[13px] border border-border transition-all hover:bg-hover" onClick={handleSkip}>
                    跳过
                  </button>
                </div>
              </div>

              {currentIndex > 0 && (
                <div className="w-full max-w-[720px]">
                  <button className="py-1.5 bg-transparent text-dim text-[13px] border-none cursor-pointer transition-colors hover:text-text" onClick={handlePrev}>
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

  // ── Chat mode (resume interview) ──
  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-65px)]">
      <div className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-border bg-card">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${modeBadge.cls}`}>{modeBadge.text}</span>
          {initData.topic && <span className="text-sm text-dim">{initData.topic}</span>}
          {progress && (
            <div className="text-[13px] text-dim flex items-center gap-1.5">
              <span>|</span>
              <span>进度: {progress}</span>
            </div>
          )}
        </div>
        <button
          className="px-4 py-2 md:px-5 rounded-lg bg-red/15 text-red text-sm font-medium transition-all"
          onClick={handleEndResume}
          disabled={reviewing}
        >
          {reviewing ? "生成复盘中..." : finished ? "查看复盘" : "结束面试"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col gap-7 max-w-3xl w-full mx-auto">
        {messages.map((msg, i) => (
          <ChatBubble key={i} role={msg.role} content={msg.content} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 px-4 py-3 text-dim text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-light animate-pulse-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent-light animate-pulse-dot [animation-delay:0.2s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent-light animate-pulse-dot [animation-delay:0.4s]" />
            <span className="ml-1">面试官思考中...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="px-4 pt-4 pb-5 md:px-6 md:pb-6 flex justify-center">
        <div className="relative w-full max-w-3xl">
          <textarea
            ref={textareaRef}
            className="w-full px-4 py-4 md:px-5 pr-14 rounded-2xl border border-border bg-card text-text resize-none outline-none min-h-[80px] max-h-[240px] leading-normal text-[15px]"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={chatVoice.isListening ? "正在录音，再次点击麦克风停止..." : chatVoice.isTranscribing ? "正在识别语音..." : finished ? "面试已结束，点击右上角查看复盘" : "输入你的回答... (Enter 发送, Shift+Enter 换行)"}
            disabled={finished || sending}
            rows={3}
          />
          {chatVoice.isSupported && !finished && (
            <button
              className={`absolute right-3 bottom-3 w-9 h-9 rounded-full flex items-center justify-center transition-all
                ${chatVoice.isListening ? "bg-red text-white animate-pulse-dot" : chatVoice.isTranscribing ? "bg-orange text-white animate-pulse-dot" : "bg-hover text-dim hover:text-text"}`}
              onClick={chatVoice.toggle}
              disabled={chatVoice.isTranscribing}
              title={chatVoice.isListening ? "停止录音" : chatVoice.isTranscribing ? "正在识别..." : "语音输入"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
