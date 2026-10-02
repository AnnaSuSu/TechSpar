import type { IdGenerator } from '../account/ports.ts'
import type { CandidateProfilePort, PersistentTaskDispatcher } from '../interview/ports.ts'
import type { TaskRecord } from '../interview/model.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { EmbeddingUseCases, ProviderSettingsRepository, TextGenerationUseCases } from '../provider/ports.ts'
import type { ResumeUseCases } from '../resume/ports.ts'
import type { VoiceRoleDetectionUseCases, VoiceRoleDetector } from '../voiceprint/ports.ts'
import type { CopilotClientMessage, CopilotPrepRecord, CopilotServerEvent, CopilotSessionState } from './model.ts'

export interface CopilotRepository {
  initialize(): void
  createPrep(input: { prepId: string; userId: string; company: string; position: string; jdText: string }): Promise<void>
  getPrep(prepId: string, userId: string): Promise<CopilotPrepRecord | undefined>
  listPreps(userId: string): Promise<CopilotPrepRecord[]>
  updatePrepProgress(prepId: string, userId: string, progress: string): Promise<void>
  completePrep(prepId: string, userId: string, result: Record<string, unknown>): Promise<void>
  failPrep(prepId: string, userId: string, error: string): Promise<void>
  deletePrep(prepId: string, userId: string): Promise<boolean>
  loadSession(sessionId: string, userId: string): Promise<CopilotSessionState | undefined>
  saveSession(state: CopilotSessionState): Promise<void>
}

export type SearchResult = { title: string; content: string; url: string }
export interface WebSearchDriver { search(input: { apiKey: string; query: string; maxResults: number; signal: AbortSignal }): Promise<SearchResult[]> }

export interface CopilotPrepUseCases {
  start(context: RequestContext, input: { jd_text: string; company?: string; position?: string }): Promise<{ prep_id: string }>
  get(context: RequestContext, prepId: string): Promise<Record<string, unknown>>
  list(context: RequestContext): Promise<Array<Record<string, unknown>>>
  tree(context: RequestContext, prepId: string): Promise<Record<string, unknown>>
  delete(context: RequestContext, prepId: string): Promise<{ ok: true }>
  runPrepTask(task: TaskRecord): Promise<Record<string, unknown>>
}

export interface RealtimeAsrSession {
  /** Abort cancels startup and closes the session; stop must settle pending startup. */
  start(signal: AbortSignal): Promise<void>
  sendAudio(bytes: Uint8Array): boolean
  stop(): Promise<void>
}
export interface RealtimeAsrFactory {
  create(input: { apiKey: string; roleDetector?: VoiceRoleDetector; onInterim(text: string): Promise<void>; onFinal(text: string, role?: 'hr' | 'candidate'): Promise<void>; onError(message: string): Promise<void> }): RealtimeAsrSession
}

export interface CopilotRealtimeConnection {
  handle(message: CopilotClientMessage): Promise<void>
  audio(bytes: Uint8Array): void
  close(): Promise<void>
}
export interface CopilotRealtimeUseCases {
  connect(context: RequestContext, sessionId: string, emit: (event: CopilotServerEvent) => Promise<void>): CopilotRealtimeConnection
}

export type CopilotDependencies = {
  repository: CopilotRepository
  tasks: PersistentTaskDispatcher
  ids: IdGenerator
  ai: TextGenerationUseCases
  embeddings: EmbeddingUseCases
  profile: CandidateProfilePort & { get?(context: RequestContext): Promise<Record<string, unknown>> }
  resume: ResumeUseCases
  settings: ProviderSettingsRepository
  search: WebSearchDriver
  asr: RealtimeAsrFactory
  voiceprint?: VoiceRoleDetectionUseCases
}
