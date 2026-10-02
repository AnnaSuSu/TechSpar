import type { InterviewMessage, InterviewMode, InterviewQuestion, SessionStatus } from './model.ts'

export type InterviewStreamEvent = { token: string } | { done: true; is_finished: boolean }

/** Application results stay independent of HTTP/Zod; adapters validate the wire. */
export type JobPrepPreview = {
  company: string
  position: string
  role_summary: string
  focus_areas: Array<{ area: string; priority: string; reason: string }>
  likely_question_groups: Array<{ title: string; reason: string; sample_questions: string[] }>
  resume_alignment: {
    resume_used: boolean
    fit_assessment: string
    matching_evidence: string[]
    risk_gaps: string[]
    recommended_stories: Array<{ project: string; reason: string }>
  }
  prep_priorities: string[]
  question_blueprint: unknown[]
  jd_excerpt: string
}
export type JobPrepStartResult = {
  session_id: string
  mode: 'jd_prep'
  questions: InterviewQuestion[]
  preview: Record<string, unknown>
  company: string
  position: string
  meta: { company: string; position: string; jd_text: string; use_resume: boolean; preview: Record<string, unknown> }
}
export type InterviewStartResult =
  | { session_id: string; mode: 'topic_drill'; topic: string; questions: InterviewQuestion[] }
  | { session_id: string; mode: 'resume'; topic?: string | null; target_role: string; job_description: string; message: string }
export type InterviewReviewSubmissionResult = { session_id: string; mode: InterviewMode; status: 'pending' | 'done' }
export type InterviewDraftResult =
  | { session_id: string; status: 'ongoing'; saved: true }
  | { session_id: string; status: Exclude<SessionStatus, 'ongoing'>; saved: false }
export type InterviewResumeResult = {
  session_id: string
  mode: InterviewMode
  topic?: string | null
  status: SessionStatus
  review_error?: string | null
  transcript: InterviewMessage[]
  questions: InterviewQuestion[]
  target_role: string
  job_description: string
  meta: Record<string, unknown>
  can_continue: boolean
  is_finished: boolean
  has_review: boolean
}
/** Task handlers are extensible; known result payloads are checked by the adapter. */
export type TaskStatusResult = {
  status: 'pending' | 'done' | 'error'
  type: string
  error?: string | null
  [key: string]: unknown
}
