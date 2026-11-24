import type { ChatMessage, InterviewMode, InterviewQuestion, QuestionId } from "../interview/types";

export interface ReviewAnswer {
  question_id: QuestionId;
  answer: string;
}

export interface ReviewScore {
  question_id: QuestionId;
  score?: number | null;
  assessment?: string;
  improvement?: string;
  understanding?: string;
  key_missing?: string[];
  role_expectation?: string;
}

export type DimensionScoreMap = Partial<Record<string, number | null>>;

export interface ReviewedTopic {
  topic?: string;
  score?: number | null;
  assessment?: string;
  understanding?: string;
  errors?: string[];
  missing?: string[];
}

export interface ReviewOverall {
  avg_score?: number | null;
  summary?: string;
  dimension_scores?: DimensionScoreMap;
  new_weak_points?: unknown[];
  new_strong_points?: unknown[];
  topics_covered?: ReviewedTopic[];
  role_fit_summary?: string;
  interviewer_hotspots?: unknown[];
  prep_priorities?: unknown[];
  communication_observations?: {
    style_update?: string;
    new_habits?: string[];
    new_suggestions?: string[];
  };
  thinking_patterns?: {
    new_strengths?: string[];
    new_gaps?: string[];
  };
}

export interface ReviewMeta {
  company?: string;
  position?: string;
  jd_text?: string;
  jd_excerpt?: string;
  use_resume?: boolean;
  preview?: Record<string, unknown>;
  recording_mode?: "dual" | "solo";
}

export interface ReviewPayload {
  session_id?: string;
  mode?: InterviewMode;
  topic?: string | null;
  review?: string | null;
  scores?: ReviewScore[] | null;
  overall?: ReviewOverall | null;
  questions?: InterviewQuestion[];
  answers?: ReviewAnswer[];
  messages?: ChatMessage[];
  transcript?: ChatMessage[];
  topics_covered?: ReviewedTopic[];
  weak_points?: unknown[];
  meta?: ReviewMeta;
  reference_answers?: Record<string, string>;
  dimension_scores?: DimensionScoreMap;
  avg_score?: number | null;
  recording_mode?: ReviewMeta["recording_mode"];
}

export interface QuestionReviewProps {
  scores?: ReviewPayload["scores"];
  overall?: ReviewPayload["overall"];
  questions: InterviewQuestion[];
  answers: ReviewAnswer[];
}
