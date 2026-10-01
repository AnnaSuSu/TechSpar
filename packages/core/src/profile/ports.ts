import type { RequestContext } from '../kernel/context.ts'
import type { InterviewSessionRepository, PersistentTaskDispatcher } from '../interview/ports.ts'
import type { InterviewSession, TaskRecord } from '../interview/model.ts'
import type { KnowledgeStore } from '../knowledge/ports.ts'
import type { EmbeddingUseCases, TextGenerationUseCases } from '../provider/ports.ts'
import type { ResumeUseCases } from '../resume/ports.ts'
import type { CandidateProfile, ProfileViewMarker, RetrospectiveResult, WeakPoint } from './model.ts'

export interface CandidateProfileRepository {
  load(userId: string): Promise<CandidateProfile>
  save(userId: string, profile: CandidateProfile): Promise<void>
  update<T>(userId: string, mutate: (profile: CandidateProfile) => T | Promise<T>): Promise<T>
}

export type ProfileMemoryEntry = {
  chunkType: 'session_summary' | 'insight' | 'weak_point'
  content: string
  topic?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  embedding: Float32Array
  createdAt: string
}

export type ProfileMemorySearchResult = Omit<ProfileMemoryEntry, 'embedding' | 'metadata'> & { score: number }

export interface ProfileVectorMemoryPort {
  appendProfileMemories(input: { userId: string; entries: readonly ProfileMemoryEntry[] }): Promise<void>
  replaceSessionMemories(input: { userId: string; sessionId: string; entries: readonly ProfileMemoryEntry[] }): Promise<void>
  listProfileMemories(input: { userId: string; chunkTypes?: readonly ProfileMemoryEntry['chunkType'][]; topic?: string }): Promise<ProfileMemoryEntry[]>
}

export interface ProfileUseCases {
  get(context: RequestContext): Promise<CandidateProfile>
  inferTargetRole(context: RequestContext): Promise<{ target_role: string }>
  viewed(context: RequestContext): Promise<ProfileViewMarker>
  feedback(context: RequestContext, point: string, verdict: string): Promise<WeakPoint>
  dueReviews(context: RequestContext, topic?: string): Promise<WeakPoint[]>
  topicHistory(context: RequestContext, topic: string): Promise<InterviewSession[]>
  retrospective(context: RequestContext, topic: string): Promise<{ task_id: string; status: 'pending' }>
  runRetrospectiveTask(task: TaskRecord): Promise<RetrospectiveResult>
}

export type ProfileDependencies = {
  repository: CandidateProfileRepository
  sessions: InterviewSessionRepository
  tasks: PersistentTaskDispatcher
  ai: TextGenerationUseCases
  embeddings: EmbeddingUseCases
  vectors: ProfileVectorMemoryPort
  resume: ResumeUseCases
  knowledgeStore: KnowledgeStore
}
