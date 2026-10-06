export type CopilotPrepStatus = 'running' | 'done' | 'error'

export type CopilotPrepRecord = {
  prep_id: string
  user_id: string
  company: string
  position: string
  jd_text: string
  status: CopilotPrepStatus
  progress: string
  error: string
  result?: Record<string, unknown> | null
  created_at: string
}

export type CopilotConversationTurn = { role: 'hr' | 'candidate'; text: string; at: string }

export type CopilotSessionState = {
  session_id: string
  user_id: string
  prep_id: string
  conversation: CopilotConversationTurn[]
  last_node_id?: string | null
  turn_count: number
  status: 'active' | 'stopped'
  created_at: string
  updated_at: string
}

export type CopilotClientMessage =
  | { type: 'start'; prep_id?: string; audio_mode?: 'dual' }
  | { type: 'manual'; text?: string }
  | { type: 'candidate_response'; text: string }
  | { type: 'stop' }

export type CopilotServerEvent =
  | { type: 'started'; session_id: string; audio_ready?: boolean }
  | { type: 'stopped' }
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string }
  | { type: 'asr_interim'; text: string; role?: 'hr' | 'candidate' }
  | { type: 'asr_final'; text: string; role?: 'hr' | 'candidate' }
  | { type: 'copilot_update'; intent: string; tree_position: string | null; topic: string; confidence: number; recommended_points: string[]; children: Array<{ topic: string; question: string }>; prep_hint: { safe_talking_points: string[]; redirect_suggestion: string } | null }
  | { type: 'risk_alert'; message: string; node_id: string | null }
  | { type: 'answer_chunk'; text: string }
  | { type: 'answer_meta'; first_token_ms: number }
  | { type: 'answer_done'; total_ms: number; chunk_count: number }
  // Transport compatibility permits partial historical events. Live producers
  // validate all required model fields before creating these events.
  | { type: 'hr_profile_update'; style?: string; focus?: string; satisfaction_signals?: string; advice?: string; [key: string]: unknown }
  | { type: 'monitor_update'; phase?: string; last_answer_feedback?: string; covered_topics?: string[]; uncovered_topics?: string[]; strategy_tip?: string; [key: string]: unknown }
