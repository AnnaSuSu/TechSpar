import { z } from 'zod'
import { InterviewSessionResponseSchema } from './interview-responses.ts'

// Profile imports preserve historical extensions at each stored object boundary.
// Known fields are checked; no defaults/coercions or unknown-key stripping occur.
export const ProfileHistoryEventSchema = z.object({ date: z.string().optional(), event: z.string().optional(), evidence: z.string().optional(), score: z.number().optional() }).passthrough()
export const SpacedRepetitionSchema = z.object({
  interval_days: z.number().optional(), ease_factor: z.number().optional(), repetitions: z.number().optional(),
  next_review: z.string().optional(), last_score: z.number().optional(),
}).passthrough()
const observation = {
  topic: z.string().optional(), first_seen: z.string().optional(), last_seen: z.string().optional(), times_seen: z.number().optional(),
  improved: z.boolean().optional(), improved_at: z.string().optional(), archived: z.boolean().optional(),
  archived_at: z.string().optional(), archived_reason: z.string().optional(), source: z.string().optional(), axis: z.string().optional(),
  confidence: z.number().optional(), history: z.array(ProfileHistoryEventSchema).optional(),
}
export const ProfileWeakPointSchema = z.object({
  point: z.string(), ...observation, sr: SpacedRepetitionSchema.optional(),
  consolidates: z.array(z.string()).optional(), user_acknowledged: z.boolean().optional(),
}).passthrough()
export const ProfileStrongPointSchema = z.object({ point: z.string(), ...observation }).passthrough()
export const TopicMasterySchema = z.object({
  score: z.number().optional(), level: z.number().optional(), notes: z.string().optional(), last_assessed: z.string().optional(),
  session_count: z.number().optional(), retrospective: z.string().optional(), retrospective_at: z.string().optional(),
}).passthrough()
export const BehaviorSignalSchema = z.object({
  ...observation, namespace: z.string().optional(), polarity: z.string().optional(), description: z.string().optional(),
  examples: z.array(z.object({ session_id: z.string().optional(), date: z.string().optional(), snippet: z.string().optional() }).passthrough()).optional(),
}).passthrough()
export const ProfileScoreHistoryEntrySchema = z.object({
  date: z.string().optional(), mode: z.string().optional(), topic: z.string().nullish(), avg_score: z.number().optional(),
  session_id: z.string().optional(), dimension_scores: z.record(z.string(), z.number()).optional(),
}).passthrough()
export const ProfileStatsSchema = z.object({
  total_sessions: z.number(), resume_sessions: z.number(), drill_sessions: z.number(), job_prep_sessions: z.number(),
  avg_score: z.number(), score_history: z.array(ProfileScoreHistoryEntrySchema),
  total_answers: z.number().optional(), recording_sessions: z.number().optional(), copilot_sessions: z.number().optional(),
  drill_avg_score: z.number().optional(), resume_avg_score: z.number().optional(), job_prep_avg_score: z.number().optional(), recording_avg_score: z.number().optional(),
  dimension_scores: z.record(z.string(), z.number()).optional(),
}).passthrough()
export const ProfileViewedResponseSchema = z.strictObject({ at: z.string(), total_sessions: z.number(), topic_scores: z.record(z.string(), z.number()) })
// Historical stored markers may be partial; POST /viewed always returns a full marker.
export const ProfileStoredViewMarkerSchema = ProfileViewedResponseSchema.partial().passthrough()
export const DueReviewSummarySchema = z.strictObject({ point: z.string(), topic: z.string().optional(), next_review: z.string().optional() })
export const CandidateProfileResponseSchema = z.object({
  name: z.string(), target_role: z.string(), updated_at: z.string(), last_consolidation_at: z.string(),
  topic_mastery: z.record(z.string(), TopicMasterySchema), weak_points: z.array(ProfileWeakPointSchema), strong_points: z.array(ProfileStrongPointSchema),
  behavior_signals: z.record(z.string(), BehaviorSignalSchema),
  communication: z.object({ style: z.string(), habits: z.array(z.string()), suggestions: z.array(z.string()) }).passthrough(),
  thinking_patterns: z.object({ strengths: z.array(z.string()), gaps: z.array(z.string()) }).passthrough(),
  stats: ProfileStatsSchema, view_marker: ProfileStoredViewMarkerSchema.optional(), due_reviews: z.array(DueReviewSummarySchema),
  session_extractions: z.record(z.string(), z.unknown()).optional().describe('Persisted extraction cache; new LLM extractions are validated before writes.'),
}).passthrough()
export const ProfilePatternFeedbackResponseSchema = ProfileWeakPointSchema
export const ProfileDueReviewsResponseSchema = z.array(ProfileWeakPointSchema)
export const ProfileTopicHistoryResponseSchema = z.array(InterviewSessionResponseSchema)
