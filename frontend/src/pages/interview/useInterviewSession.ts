import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  endInterview,
  getResumableSession,
  retryReview,
  saveDraftAnswers,
  sendMessage,
  sendMessageStream,
} from "@/api/sessions";
import useTaskStatus from "@/hooks/useTaskStatus";
import { errorMessage } from "@/lib/errorMessage";
import { buildInterviewAnswers } from "@/lib/interviewAnswers";
import type { ChatMessage, ConfidenceLevel, InterviewInitData, InterviewStatus, QuestionId } from "./types";

type BootstrapState =
  | { data: InterviewInitData; error: null }
  | { data: null; error: string | null };

export function useInterviewBootstrap(sessionId: string, routeData: InterviewInitData | null) {
  const [bootstrap, setBootstrap] = useState<BootstrapState>(() => ({
    data: routeData,
    error: null,
  }));

  useEffect(() => {
    if (routeData) return;
    const controller = new AbortController();
    const { signal } = controller;
    getResumableSession(sessionId, { signal }).then((data) => {
      if (signal.aborted) return;
      setBootstrap({
        data: {
          ...data,
          company: typeof data.meta.company === "string" ? data.meta.company : undefined,
          position: typeof data.meta.position === "string" ? data.meta.position : undefined,
        },
        error: null,
      });
    }).catch((error: unknown) => {
      if (!signal.aborted) {
        setBootstrap({ data: null, error: errorMessage(error, "无法加载面试") });
      }
    });
    return () => controller.abort();
  }, [routeData, sessionId]);

  return bootstrap;
}

function restoreAnswers({ questions = [], transcript = [] }: InterviewInitData) {
  const answers: Record<QuestionId, string> = {};
  transcript.forEach((entry, index) => {
    const previous = transcript[index - 1];
    if (entry.role !== "user" || previous?.role !== "assistant") return;
    const question = questions.find((q) => q.question === previous.content);
    if (question) answers[question.id] = entry.content;
  });
  return answers;
}

export function useInterviewSession(initData: InterviewInitData) {
  const { session_id: sessionId, mode, questions = [] } = initData;
  const isJobPrep = mode === "jd_prep";
  const isBatchMode = mode === "topic_drill" || isJobPrep;
  const { tasks, startTask } = useTaskStatus();
  const task = tasks.find((entry) => entry.id === sessionId);

  const [sessionStatus, setSessionStatus] = useState<InterviewStatus | null>(initData.status ?? null);
  const [resumeError, setResumeError] = useState(initData.review_error || "");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initData.transcript ?? (initData.message ? [{ role: "assistant", content: initData.message }] : []));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(() => Boolean(
    (initData.status && initData.status !== "ongoing")
    || (!isBatchMode && (initData.can_continue === false || initData.is_finished)),
  ));
  const [reviewing, setReviewing] = useState(false);

  const [answers, setAnswers] = useState(() => restoreAnswers(initData));
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (initData.status !== "ongoing" || !isBatchMode) return 0;
    return Math.max(0, questions.findIndex((question) => !answers[question.id]));
  });
  const currentQ = questions[currentIndex];
  const [drillInput, setDrillInput] = useState(() => currentQ ? answers[currentQ.id] || "" : "");
  const [confidences, setConfidences] = useState<Partial<Record<QuestionId, ConfidenceLevel>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(initData.status && initData.status !== "ongoing"));
  const pendingDraft = useRef(Promise.resolve());

  useEffect(() => {
    if (initData.status !== "reviewing") return;
    const type = mode === "resume" ? "resume_review"
      : mode === "jd_prep" ? "jd_review"
        : mode === "recording" ? "recording" : "drill_review";
    startTask(sessionId, type, "复盘生成中");
  }, [initData.status, mode, sessionId, startTask]);

  const goToQuestion = (index: number, savedAnswers = answers) => {
    if (index >= questions.length) {
      setFinished(true);
      return;
    }
    setCurrentIndex(index);
    setDrillInput(savedAnswers[questions[index].id] || "");
  };

  const handleDrillSubmit = () => {
    const text = drillInput.trim();
    if (!text || !currentQ) return;
    const nextAnswers = { ...answers, [currentQ.id]: text };
    setAnswers(nextAnswers);
    // Keep draft snapshots in order when answers are submitted in quick succession.
    const draft = questions
      .filter((question) => nextAnswers[question.id]?.trim())
      .map((question) => ({ question_id: question.id, answer: nextAnswers[question.id] }));
    pendingDraft.current = pendingDraft.current.then(async () => {
      await saveDraftAnswers(sessionId, draft);
    }).catch(() => {});
    goToQuestion(currentIndex + 1, nextAnswers);
  };

  const handleEndBatch = async () => {
    const isRetry = task?.status === "error" || sessionStatus === "review_failed";
    if (submitting || (submitted && !isRetry)) return;
    setSubmitting(true);
    try {
      const answerList = buildInterviewAnswers(questions, answers, confidences);
      // A draft snapshot must reach the server before the final answer list.
      await pendingDraft.current;
      await endInterview(sessionId, answerList);
      setSubmitted(true);
      setFinished(true);
      setSessionStatus("reviewing");
      startTask(sessionId, isJobPrep ? "jd_review" : "drill_review",
        isJobPrep ? "JD 备面复盘生成中" : "专项训练复盘生成中");
    } catch (error) {
      toast.error("提交失败: " + errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const startResumeReview = async (retry = false) => {
    if (retry) await retryReview(sessionId);
    else await endInterview(sessionId);
    setFinished(true);
    setSessionStatus("reviewing");
    setResumeError("");
    startTask(sessionId, "resume_review", "简历面试复盘生成中");
  };

  const requestResumeReview = async (retry = false, automatic = false) => {
    if (automatic) setFinished(true);
    setReviewing(true);
    try {
      await startResumeReview(retry);
    } catch (error) {
      if (!automatic) toast.error((retry ? "重新生成失败: " : "结束面试失败: ") + errorMessage(error));
    } finally {
      setReviewing(false);
    }
  };

  const updateReply = (content: string, append = false) => {
    setMessages((previous) => {
      const last = previous[previous.length - 1];
      return [
        ...previous.slice(0, -1),
        { role: "assistant", content: append ? last.content + content : content },
      ];
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || finished) return;
    setMessages((previous) => [...previous, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);

    try {
      await sendMessageStream(sessionId, text, {
        onToken: (token) => updateReply(token, true),
        onDone: (data) => {
          if (data.is_finished) void requestResumeReview(false, true);
        },
        onError: (error) => updateReply("[错误] " + errorMessage(error)),
      });
    } catch {
      try {
        const data = await sendMessage(sessionId, text);
        updateReply(data.message);
        if (data.is_finished) void requestResumeReview(false, true);
      } catch (error) {
        updateReply("[错误] " + errorMessage(error));
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (isBatchMode) handleDrillSubmit();
      else void handleSend();
    }
  };

  return {
    initData, sessionId, task, sessionStatus, finished, handleKeyDown,
    batch: {
      questions, currentQ, currentIndex, answers, drillInput, setDrillInput,
      confidences, setConfidences, submitting, submitted, handleEndBatch, handleDrillSubmit,
      handleSkip: () => { if (currentQ) goToQuestion(currentIndex + 1); },
      handlePrev: () => { if (currentIndex > 0) goToQuestion(currentIndex - 1); },
    },
    chat: {
      messages, input, setInput, sending, reviewing, resumeError,
      handleEndResume: () => requestResumeReview(),
      handleRetryResumeReview: () => requestResumeReview(true),
    },
  };
}

export type InterviewSession = ReturnType<typeof useInterviewSession>;
