export type ConversationAnalyzeInput = { sessionId: string; transcript: string; company?: string; position?: string; meta: { copilot_session_id: string; prep_id: string } }

export type RecordingMode = 'dual' | 'solo'

export type RecordingAnalyzeInput = {
  transcript: string
  recording_mode?: RecordingMode
  company?: string | null
  position?: string | null
}
