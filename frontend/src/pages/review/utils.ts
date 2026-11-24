import type { ChatMessage, InterviewQuestion } from "../interview/types";
import type { ReviewAnswer, ReviewPayload } from "./types";

export const RESUME_DIMENSION_LABELS = {
  technical_depth: "技术深度",
  project_articulation: "项目表达",
  communication: "表达能力",
  problem_solving: "问题解决",
};

export const JOB_PREP_DIMENSION_LABELS = {
  role_fit: "岗位匹配",
  technical_depth: "技术深度",
  project_relevance: "项目相关性",
  engineering_quality: "工程质量",
  communication: "表达能力",
};

export function getReviewPresentation(data: ReviewPayload) {
  const isRecording = data.mode === "recording";
  const isJobPrep = data.mode === "jd_prep";
  const isRecordingDual = isRecording && (
    data.recording_mode === "dual" || data.meta?.recording_mode === "dual" || Boolean(data.questions?.length)
  );
  const showDrill = data.mode === "topic_drill" || isRecordingDual;
  const title = isRecording ? "录音复盘" : isJobPrep ? "JD 备面复盘" : showDrill ? "训练复盘" : "面试复盘";
  return { title, isRecording, isJobPrep, showDrill };
}

export function inferAnswers(
  questions?: readonly InterviewQuestion[] | null,
  transcript?: readonly ChatMessage[] | null,
): ReviewAnswer[] {
  if (!questions?.length || !transcript?.length) return [];
  return questions.map((q) => {
    const qIdx = transcript.findIndex((m) => m.role === "assistant" && m.content === q.question);
    const next = qIdx >= 0 ? transcript[qIdx + 1] : null;
    return { question_id: q.id, answer: next?.role === "user" ? next.content : "" };
  });
}
