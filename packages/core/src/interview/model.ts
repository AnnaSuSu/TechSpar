export const INTERVIEW_MODES = ['resume', 'topic_drill', 'jd_prep', 'recording'] as const
export type InterviewMode = (typeof INTERVIEW_MODES)[number]

export const SESSION_STATUSES = ['prepared', 'ongoing', 'ended', 'reviewing', 'reviewed', 'review_failed'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const INTERVIEW_PHASES = [
  'greeting',
  'self_intro',
  'technical',
  'project_deep_dive',
  'behavioral',
  'reverse_qa',
] as const
export type InterviewPhase = (typeof INTERVIEW_PHASES)[number]

export type InterviewMessage = {
  role: 'user' | 'assistant'
  content: string
  time?: string
}

export type InterviewQuestion = {
  id: string | number
  question: string
  difficulty?: number
  focus_area?: string
  category?: string
  intent?: string
  [key: string]: unknown
}

export type InterviewAnswer = {
  question_id: string | number
  answer: string
  confidence?: number
  [key: string]: unknown
}

export type InlineEvaluation = {
  score?: number
  should_advance?: boolean
  brief?: string
  evidence?: string
  phase?: string
  question_index?: number
  [key: string]: unknown
}

export type ResumeInterviewState = {
  messages: InterviewMessage[]
  phase: InterviewPhase
  target_role: string
  job_description: string
  resume_context: string
  questions_asked: string[]
  phase_question_count: number
  is_finished: boolean
  last_eval: InlineEvaluation
  eval_history: InlineEvaluation[]
}

export type InterviewSession = {
  session_id: string
  mode: InterviewMode
  topic?: string | null
  meta: Record<string, unknown>
  questions: InterviewQuestion[]
  transcript: InterviewMessage[]
  scores: Array<Record<string, unknown>>
  weak_points: unknown[]
  overall: Record<string, unknown>
  reference_answers: Record<string, string>
  review?: string | null
  status: SessionStatus
  review_error?: string | null
  user_id: string
  created_at: string
  updated_at: string
}

export type SessionSummary = {
  session_id: string
  mode: InterviewMode
  topic?: string | null
  meta: Record<string, unknown>
  created_at: string
  avg_score?: number | null
  status: SessionStatus
  review_error?: string | null
}

export const TASK_STATUSES = ['pending', 'running', 'done', 'error'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskRecord = {
  task_id: string
  user_id: string
  type: string
  status: TaskStatus
  payload: Record<string, unknown>
  result?: Record<string, unknown> | null
  error?: string | null
  attempts: number
  lease_owner?: string | null
  lease_expires_at?: string | null
  created_at: string
  updated_at: string
}

export type StartInterviewInput = {
  mode: InterviewMode
  topic?: string
  num_questions?: number
  divergence?: number
  target_role?: string
  job_description?: string
}

export type JobPrepInput = {
  request_id?: string
  session_id?: string
  jd_text: string
  company?: string
  position?: string
  use_resume?: boolean
  preview_data?: Record<string, unknown>
}
