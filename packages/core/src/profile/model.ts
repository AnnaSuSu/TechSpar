export type WeakPoint = {
  point: string
  topic?: string
  first_seen?: string
  last_seen?: string
  times_seen?: number
  improved?: boolean
  archived?: boolean
  source?: string
  axis?: string
  confidence?: number
  sr?: Record<string, unknown>
  [key: string]: unknown
}

export type ProfileViewMarker = { at: string; total_sessions: number; topic_scores: Record<string, number> }
export type RetrospectiveResult = { topic: string; topic_name: string; retrospective: string; retrospective_at: string; session_count: number }

/** Saved with the profile until its session memories have been written successfully. */
export type PendingProfileMemory = {
  createdAt: string
  entries: Array<{
    chunkType: 'session_summary' | 'insight' | 'weak_point'
    content: string
    topic?: string
    metadata?: Record<string, unknown>
  }>
}

export type CandidateProfile = {
  name: string
  target_role: string
  updated_at: string
  last_consolidation_at: string
  topic_mastery: Record<string, Record<string, unknown>>
  weak_points: WeakPoint[]
  strong_points: Array<Record<string, unknown> & { point: string }>
  behavior_signals: Record<string, Record<string, unknown>>
  communication: { style: string; habits: string[]; suggestions: string[] }
  thinking_patterns: { strengths: string[]; gaps: string[] }
  stats: {
    total_sessions: number
    resume_sessions: number
    drill_sessions: number
    job_prep_sessions: number
    avg_score: number
    score_history: Array<Record<string, unknown>>
    [key: string]: unknown
  }
  view_marker?: Record<string, unknown>
  due_reviews?: Array<Record<string, unknown>>
  /** Internal retry state; excluded from profile responses and agent context. */
  _pending_memory?: Record<string, PendingProfileMemory>
  [key: string]: unknown
}

export function defaultProfile(): CandidateProfile {
  return {
    name: '', target_role: '', updated_at: '', last_consolidation_at: '', topic_mastery: {},
    weak_points: [], strong_points: [], behavior_signals: {},
    communication: { style: '', habits: [], suggestions: [] },
    thinking_patterns: { strengths: [], gaps: [] },
    stats: { total_sessions: 0, resume_sessions: 0, drill_sessions: 0, job_prep_sessions: 0, avg_score: 0, score_history: [] },
  }
}
