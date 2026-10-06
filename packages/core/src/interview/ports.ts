import type { InterviewStreamEvent } from './results.ts'
import type { IdGenerator } from '../account/ports.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { KnowledgeQuery, KnowledgeStore } from '../knowledge/ports.ts'
import type { TextGenerationUseCases } from '../provider/ports.ts'
import type { ProviderSettingsRepository } from '../provider/ports.ts'
import type { ResumeUseCases } from '../resume/ports.ts'
import type { InterviewDraftResult, InterviewResumeResult, InterviewReviewSubmissionResult, InterviewStartResult, JobPrepPreview, JobPrepStartResult, TaskStatusResult } from './results.ts'
import type {
  InterviewAnswer,
  InterviewMessage,
  InterviewMode,
  InterviewQuestion,
  InterviewSession,
  JobPrepInput,
  ResumeInterviewState,
  SessionStatus,
  SessionSummary,
  StartInterviewInput,
  TaskRecord,
} from './model.ts'

export interface InterviewSessionRepository {
  initialize(): void
  create(input: { sessionId: string; userId: string; mode: InterviewMode; topic?: string; questions?: InterviewQuestion[]; meta?: Record<string, unknown> }): Promise<void>
  get(sessionId: string, userId: string): Promise<InterviewSession | undefined>
  appendMessage(sessionId: string, userId: string, role: 'user' | 'assistant', content: string): Promise<boolean>
  saveQuestions(sessionId: string, userId: string, questions: InterviewQuestion[]): Promise<boolean>
  saveAnswers(sessionId: string, userId: string, answers: InterviewAnswer[]): Promise<boolean>
  updateStatus(sessionId: string, userId: string, status: SessionStatus, options?: { reviewError?: string; clearError?: boolean }): Promise<boolean>
  saveReview(input: { sessionId: string; userId: string; review: string; scores?: Array<Record<string, unknown>>; weakPoints?: unknown[]; overall?: Record<string, unknown> }): Promise<boolean>
  updateMeta(sessionId: string, userId: string, patch: Record<string, unknown>): Promise<boolean>
  saveReferenceAnswer(sessionId: string, userId: string, questionId: string, answer: string): Promise<boolean>
  list(input: { userId: string; limit: number; offset: number; mode?: InterviewMode; topic?: string }): Promise<{ items: SessionSummary[]; total: number }>
  delete(sessionId: string, userId: string): Promise<boolean>
  topics(userId: string): Promise<string[]>
  recentQuestions(userId: string, topic: string, options?: { sessionLimit?: number; maxQuestions?: number }): Promise<string[]>
  reviewedByTopic(userId: string, topic: string, limit?: number): Promise<InterviewSession[]>
  expireStaleReviewing(userId?: string, maxAgeSeconds?: number): Promise<number>
}

export interface ResumeInterviewStateRepository {
  initialize(): void
  load(sessionId: string, userId: string): Promise<ResumeInterviewState | undefined>
  save(sessionId: string, userId: string, state: ResumeInterviewState): Promise<void>
  delete(sessionId: string, userId: string): Promise<void>
}

export type TaskLease = Readonly<{ owner: string; durationMs: number }>

export interface TaskRepository {
  initialize(): void
  upsert(input: { taskId: string; userId: string; type: string; payload: Record<string, unknown> }): Promise<TaskRecord>
  get(taskId: string, userId: string): Promise<TaskRecord | undefined>
  claim(taskId: string, userId: string, lease: TaskLease): Promise<TaskRecord | undefined>
  renew(taskId: string, userId: string, lease: TaskLease): Promise<boolean>
  complete(taskId: string, userId: string, owner: string, result?: Record<string, unknown>): Promise<boolean>
  fail(taskId: string, userId: string, owner: string, error: string): Promise<boolean>
  recoverable(): Promise<TaskRecord[]>
}

export interface PersistentTaskDispatcher {
  enqueue(input: { taskId: string; userId: string; type: string; payload: Record<string, unknown> }): Promise<TaskRecord>
  get(taskId: string, userId: string): Promise<TaskRecord | undefined>
}

export interface CandidateProfilePort {
  summary(userId: string, topic?: string, memoryQuery?: string): Promise<string>
  targetRole(userId: string): Promise<string>
  updateTargetRole(userId: string, role: string): Promise<void>
  afterReview?(input: { userId: string; session: InterviewSession }): Promise<Record<string, unknown> | undefined>
  addPredictedWeakPoints?(input: { userId: string; topic: string; points: string[] }): Promise<void>
}

export interface InterviewUseCases {
  previewJob(context: RequestContext, input: JobPrepInput): Promise<{ preview: JobPrepPreview }>
  startJob(context: RequestContext, input: JobPrepInput): Promise<JobPrepStartResult>
  start(context: RequestContext, input: StartInterviewInput): Promise<InterviewStartResult>
  chat(context: RequestContext, sessionId: string, message: string): Promise<{ session_id: string; message: string; is_finished: boolean }>
  chatStream(context: RequestContext, sessionId: string, message: string): AsyncIterable<InterviewStreamEvent>
  end(context: RequestContext, sessionId: string, answers: InterviewAnswer[]): Promise<InterviewReviewSubmissionResult>
  draft(context: RequestContext, sessionId: string, answers: InterviewAnswer[]): Promise<InterviewDraftResult>
  generateReview(context: RequestContext, sessionId: string): Promise<InterviewReviewSubmissionResult>
  referenceAnswer(context: RequestContext, sessionId: string, questionId: string | number): Promise<{ reference_answer: string; cached: boolean }>
  resume(context: RequestContext, sessionId: string): Promise<InterviewResumeResult>
  review(context: RequestContext, sessionId: string): Promise<InterviewSession>
  history(context: RequestContext, input: { limit?: number; offset?: number; mode?: InterviewMode; topic?: string }): Promise<{ items: SessionSummary[]; total: number }>
  delete(context: RequestContext, sessionId: string): Promise<{ ok: true }>
  topics(context: RequestContext): Promise<string[]>
  task(context: RequestContext, taskId: string): Promise<TaskStatusResult>
  runReviewTask(task: TaskRecord): Promise<Record<string, unknown> | undefined>
}

export type InterviewDependencies = {
  sessions: InterviewSessionRepository
  states: ResumeInterviewStateRepository
  tasks: PersistentTaskDispatcher
  ids: IdGenerator
  ai: TextGenerationUseCases
  resume: ResumeUseCases
  knowledge: KnowledgeQuery
  knowledgeStore: KnowledgeStore
  settings: ProviderSettingsRepository
  profile: CandidateProfilePort
  maxQuestionsPerPhase?: number
}
