import type { IdGenerator } from '../account/ports.ts'
import type { CandidateProfilePort, InterviewSessionRepository, PersistentTaskDispatcher } from '../interview/ports.ts'
import type { TaskRecord } from '../interview/model.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { TextGenerationUseCases } from '../provider/ports.ts'
import type { LongTranscriptionUseCases } from './transcription-service.ts'
import type { RecordingAnalyzeInput, RecordingMode, ConversationAnalyzeInput } from './model.ts'

export interface RecordingUseCases {
  transcribe(context: RequestContext, filename: string, bytes: Uint8Array, mode?: RecordingMode): Promise<{ transcript: string; segments: unknown[] }>
  analyze(context: RequestContext, input: RecordingAnalyzeInput): Promise<{ session_id: string; status: 'pending' }>
  analyzeConversation(context: RequestContext, input: ConversationAnalyzeInput): Promise<{ session_id: string; status: 'pending' }>
  recoverConversation(context: RequestContext, sessionId: string): Promise<boolean>
  runAnalysisTask(task: TaskRecord): Promise<Record<string, unknown>>
}

export type RecordingDependencies = {
  sessions: InterviewSessionRepository
  tasks: PersistentTaskDispatcher
  ids: IdGenerator
  ai: TextGenerationUseCases
  profile: CandidateProfilePort
  transcription: LongTranscriptionUseCases
}
