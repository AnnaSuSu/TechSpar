import { z } from 'zod'
import { InterviewModeSchema, InterviewQuestionSchema, SessionStatusSchema } from './interview-shared.ts'

// Persisted/provider-owned JSON slots retain their wire contents. New LLM output
// is checked by core producers; response validation must not strip legacy fields.
export const InterviewMetadataSchema = z.record(z.string(), z.unknown()).describe('Persisted session metadata; legacy/provider extensions are preserved.')
const ReviewObjectSchema = z.record(z.string(), z.unknown()).describe('Persisted review content; new LLM output is validated before writes while legacy fields are preserved.')
export const JobPrepPreviewCompatibilitySchema = z.record(z.string(), z.unknown()).describe('Caller-supplied preview_data is echoed unchanged, including legacy partial previews.')

export const InterviewMessageSchema = z.object({
  role: z.enum(['user', 'assistant']), content: z.string(), time: z.string().optional(),
}).passthrough()

export const JobPrepPreviewResultSchema = z.strictObject({
  company: z.string(), position: z.string(), role_summary: z.string(),
  focus_areas: z.array(z.strictObject({ area: z.string(), priority: z.string(), reason: z.string() })),
  likely_question_groups: z.array(z.strictObject({ title: z.string(), reason: z.string(), sample_questions: z.array(z.string()) })),
  resume_alignment: z.strictObject({
    resume_used: z.boolean(), fit_assessment: z.string(),
    matching_evidence: z.array(z.string()), risk_gaps: z.array(z.string()),
    recommended_stories: z.array(z.strictObject({ project: z.string(), reason: z.string() })),
  }),
  prep_priorities: z.array(z.string()),
  question_blueprint: z.array(z.unknown()).describe('New model-produced blueprint items are validated in core; persisted and caller-supplied legacy items remain compatible.'),
  jd_excerpt: z.string(),
})
export const JobPrepPreviewResponseSchema = z.strictObject({ preview: JobPrepPreviewResultSchema })
export const JobPrepStartResponseSchema = z.strictObject({
  session_id: z.string(), mode: z.literal('jd_prep'), questions: z.array(InterviewQuestionSchema),
  preview: JobPrepPreviewCompatibilitySchema, company: z.string(), position: z.string(),
  meta: z.strictObject({ company: z.string(), position: z.string(), jd_text: z.string(), use_resume: z.boolean(), preview: JobPrepPreviewCompatibilitySchema }),
})
export const InterviewStartResponseSchema = z.discriminatedUnion('mode', [
  z.strictObject({ session_id: z.string(), mode: z.literal('topic_drill'), topic: z.string(), questions: z.array(InterviewQuestionSchema) }),
  z.strictObject({
    session_id: z.string(), mode: z.literal('resume'), topic: z.string().nullish(),
    target_role: z.string(), job_description: z.string(), message: z.string(),
  }),
])
export const InterviewChatResponseSchema = z.strictObject({ session_id: z.string(), message: z.string(), is_finished: z.boolean() })
export const InterviewReviewSubmissionResponseSchema = z.strictObject({ session_id: z.string(), mode: InterviewModeSchema, status: z.enum(['pending', 'done']) })
export const InterviewDraftResponseSchema = z.discriminatedUnion('saved', [
  z.strictObject({ session_id: z.string(), status: z.literal('ongoing'), saved: z.literal(true) }),
  z.strictObject({ session_id: z.string(), status: SessionStatusSchema.exclude(['ongoing']), saved: z.literal(false) }),
])
export const InterviewResumeResponseSchema = z.strictObject({
  session_id: z.string(), mode: InterviewModeSchema, topic: z.string().nullish(), status: SessionStatusSchema,
  review_error: z.string().nullish(), transcript: z.array(InterviewMessageSchema), questions: z.array(InterviewQuestionSchema),
  target_role: z.string(), job_description: z.string(), meta: InterviewMetadataSchema,
  can_continue: z.boolean(), is_finished: z.boolean(), has_review: z.boolean(),
})
export const InterviewSessionResponseSchema = z.strictObject({
  session_id: z.string(), mode: InterviewModeSchema, topic: z.string().nullish(), meta: InterviewMetadataSchema,
  questions: z.array(InterviewQuestionSchema), transcript: z.array(InterviewMessageSchema),
  scores: z.array(ReviewObjectSchema), weak_points: z.array(z.unknown()), overall: ReviewObjectSchema,
  reference_answers: z.record(z.string(), z.string()), review: z.string().nullish(),
  status: SessionStatusSchema, review_error: z.string().nullish(), user_id: z.string(),
  // SQLite timestamps and legacy empty values are part of the existing contract.
  created_at: z.string(), updated_at: z.string(),
})
export const InterviewSessionSummarySchema = z.strictObject({
  session_id: z.string(), mode: InterviewModeSchema, topic: z.string().nullish(), meta: InterviewMetadataSchema,
  created_at: z.string(), avg_score: z.number().nullable(), status: SessionStatusSchema, review_error: z.string().nullish(),
})
export const InterviewHistoryResponseSchema = z.strictObject({ items: z.array(InterviewSessionSummarySchema), total: z.number().int().nonnegative() })
