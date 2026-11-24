import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import ChatBubble from "@/components/ChatBubble";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import useVoiceInput from "@/hooks/useVoiceInput";
import MicButton from "./MicButton";
import type { InterviewSession } from "./useInterviewSession";

export default function LiveChatInterviewView({ session }: { session: InterviewSession }) {
  const { initData, sessionId, task, sessionStatus, finished, handleKeyDown, chat } = session;
  const { messages, input, setInput, sending, reviewing, resumeError, handleEndResume, handleRetryResumeReview } = chat;
  const { progress } = initData;
  const navigate = useNavigate();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldRestoreFocus = useRef(false);
  const chatVoice = useVoiceInput({ onResult: (text) => setInput((previous) => previous + text) });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (sending) shouldRestoreFocus.current = true;
    else if (shouldRestoreFocus.current) {
      textareaRef.current?.focus();
      shouldRestoreFocus.current = false;
    }
  }, [sending]);

  const taskDone = task?.status === "done" || sessionStatus === "reviewed";
  const taskError = task?.status === "error" || sessionStatus === "review_failed";
  const reviewInFlight = (task && task.status !== "done" && task.status !== "error") || sessionStatus === "reviewing";
  let handler: (() => void) | undefined;
  let label: string;
  if (taskDone) {
    handler = () => navigate(`/review/${sessionId}`);
    label = "查看复盘";
  } else if (taskError) {
    handler = handleRetryResumeReview;
    label = reviewing ? "重新生成中..." : "重新生成复盘";
  } else if (reviewInFlight) {
    label = "复盘生成中...";
  } else {
    handler = handleEndResume;
    label = reviewing ? "生成复盘中..." : finished ? "生成复盘" : "结束面试";
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 md:px-6 border-b border-border bg-card">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <Badge>简历面试</Badge>
          {initData.topic && <span className="text-sm text-dim">{initData.topic}</span>}
          {progress && (
            <span className="text-[13px] text-dim flex items-center gap-1.5">
              <span className="text-border">|</span>
              进度: {progress}
            </span>
          )}
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handler}
          disabled={reviewing || (!handler && !taskDone)}
        >
          {label}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 flex flex-col gap-7 max-w-3xl w-full mx-auto">
        {sessionStatus === "review_failed" && (
          <div role="alert" className="rounded-xl border border-red/20 bg-red/5 px-4 py-3 text-[13px] leading-6 text-red/90">
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

      <div className="px-4 pt-4 pb-5 md:px-6 md:pb-6 flex flex-col items-center gap-2">
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
        {chatVoice.error && <p role="alert" className="w-full max-w-3xl text-sm text-red">{chatVoice.error}</p>}
        {chatVoice.isListening && <p role="status" className="w-full max-w-3xl text-xs text-dim">正在录音，再次点击麦克风停止并转成文字。</p>}
      </div>
    </div>
  );
}
