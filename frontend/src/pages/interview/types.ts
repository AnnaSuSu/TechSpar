import type { getResumableSession } from "@/api/sessions";

type ResumeResponse = Awaited<ReturnType<typeof getResumableSession>>;

export type InterviewMode = ResumeResponse["mode"];
export type InterviewStatus = ResumeResponse["status"];
export type QuestionId = string | number;
export type ConfidenceLevel = "high" | "low";

export interface InterviewQuestion {
  id: QuestionId;
  question: string;
  difficulty?: number;
  focus_area?: string;
  category?: string;
  intent?: string;
}

export interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

export interface InterviewInitData {
  session_id: string;
  mode: InterviewMode;
  topic?: string | null;
  company?: string;
  position?: string;
  questions?: InterviewQuestion[];
  message?: string;
  progress?: string;
  status?: InterviewStatus;
  review_error?: string | null;
  transcript?: ChatMessage[];
  can_continue?: boolean;
  is_finished?: boolean;
}
