import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { BookOpen, BriefcaseBusiness, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { startInterview, startJobPrep } from "@/api/sessions";
import ErrorState from "@/components/ErrorState";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import useAuth from "@/hooks/useAuth";
import { errorMessage } from "@/lib/errorMessage";
import { jobPrepDraftKey } from "@/lib/jobPrepAccount";
import { clearJobPrepRestart, jobPrepRestartRequest } from "@/lib/jobPrepRestart";
import DrillReview from "./review/DrillReview";
import JobPrepReview from "./review/JobPrepReview";
import ResumeReview from "./review/ResumeReview";
import SoloRecordingReview from "./review/SoloRecordingReview";
import type { ReviewPayload } from "./review/types";
import { useReviewData } from "./review/useReviewData";
import { getReviewPresentation, inferAnswers } from "./review/utils";

function ReviewContent({ data, sessionId }: { data: ReviewPayload; sessionId: string }) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [restarting, setRestarting] = useState(false);
  const restartOperation = useRef<{ key: string; id: string } | null>(null);
  const restartBusy = useRef(false);
  const restartKey = `${jobPrepDraftKey(token)}:restart:${sessionId}`;
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const { mode, topic, scores, meta, questions = [], reference_answers: referenceAnswers } = data;
  const { title, isCopilot, isJobPrep, isRecording, showDrill } = getReviewPresentation(data);
  const messages = data.messages ?? data.transcript ?? [];
  const answers = data.answers ?? ((isJobPrep || showDrill) ? inferAnswers(questions, messages) : []);
  const overall = data.overall && Object.keys(data.overall).length
    ? data.overall
    : data.weak_points?.length ? { new_weak_points: data.weak_points } : undefined;

  const handleRestart = async () => {
    if (!mode || mode === "recording" || mode === "copilot" || restartBusy.current) return;
    restartBusy.current = true;
    setRestarting(true);
    try {
      let next;
      if (mode === "jd_prep") {
        if (restartOperation.current?.key !== restartKey) {
          restartOperation.current = { key: restartKey, id: crypto.randomUUID() };
        }
        const requestId = jobPrepRestartRequest(window.sessionStorage, restartKey, restartOperation.current.id);
        restartOperation.current.id = requestId;
        next = await startJobPrep({
          request_id: requestId,
          jd_text: meta?.jd_text || meta?.jd_excerpt || "",
          company: meta?.company,
          position: meta?.position,
          use_resume: meta?.use_resume ?? true,
          preview_data: meta?.preview,
        });
        clearJobPrepRestart(window.sessionStorage, restartKey);
        restartOperation.current = null;
      } else {
        next = await startInterview(mode, topic);
      }
      const nextMeta = "meta" in next ? next.meta : undefined;
      if (active.current) navigate(`/interview/${next.session_id}`, { state: { ...next, mode, topic, meta: nextMeta || meta } });
    } catch (error) {
      if (active.current) toast.error("启动失败: " + errorMessage(error));
    } finally {
      restartBusy.current = false;
      if (active.current) setRestarting(false);
    }
  };

  return (
    <PageContainer size="narrow">
      <PageHeader
        className="mb-8 animate-fade-in"
        title={title}
        description={`Session: ${sessionId}`}
        icon={isRecording ? <BookOpen size={18} /> : isJobPrep ? <BriefcaseBusiness size={18} /> : showDrill ? <Sparkles size={18} /> : undefined}
      />
      <div className="stagger-children">
        {isRecording && !showDrill ? (
          <SoloRecordingReview topicsCovered={data.topics_covered ?? overall?.topics_covered ?? []} overall={overall} />
        ) : isJobPrep ? (
          <JobPrepReview scores={scores} overall={overall} questions={questions} answers={answers} meta={meta} />
        ) : showDrill ? (
          <DrillReview
            key={sessionId}
            scores={scores}
            overall={overall}
            questions={questions}
            answers={answers}
            topic={topic}
            sessionId={sessionId}
            initialRefAnswers={referenceAnswers}
          />
        ) : (
          <ResumeReview
            review={data.review}
            messages={messages}
            dimensionScores={data.dimension_scores ?? overall?.dimension_scores}
            avgScore={data.avg_score ?? overall?.avg_score}
          />
        )}
      </div>
      <div className="flex items-center gap-3 mt-6">
        {mode && !isRecording && !isCopilot && (
          <Button variant="gradient" onClick={handleRestart} disabled={restarting}>
            <RotateCcw size={15} className={restarting ? "animate-spin" : ""} />
            {restarting ? "正在生成题目..." : "再次练习"}
          </Button>
        )}
        <Button variant="outline" onClick={() => navigate("/")}>返回首页</Button>
      </div>
    </PageContainer>
  );
}

function ReviewRoute({ sessionId, preloaded }: { sessionId: string; preloaded: ReviewPayload | null }) {
  const { state, retry } = useReviewData(sessionId, preloaded);

  if (state.status === "ready") return <ReviewContent data={state.data} sessionId={sessionId} />;

  if (state.status === "error") {
    return (
      <PageContainer size="narrow">
        <ErrorState title="复盘报告加载失败" message={state.message} onRetry={retry} />
      </PageContainer>
    );
  }

  return (
    <div role="status" className="flex-1 flex items-center justify-center py-15 text-dim">
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.2s]" />
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.4s]" />
        </div>
        <span className="text-sm">加载复盘报告中...</span>
      </div>
    </div>
  );
}

export default function Review() {
  const { sessionId } = useParams<"sessionId">();
  const location = useLocation();
  const data: ReviewPayload | null = location.state;
  if (!sessionId) return null;

  const preloaded = (data?.review || data?.scores) && (data.session_id == null || data.session_id === sessionId)
    ? data
    : null;
  return <ReviewRoute key={`${sessionId}:${location.key}`} sessionId={sessionId} preloaded={preloaded} />;
}
