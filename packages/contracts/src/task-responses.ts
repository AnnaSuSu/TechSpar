import { z } from 'zod'

export const ReviewTaskTypeSchema = z.enum(['resume_review', 'drill_review', 'jd_review', 'recording_review', 'review'])
export const KNOWN_TASK_TYPES = [...ReviewTaskTypeSchema.options, 'copilot_prep', 'retrospective'] as const
// A pattern (rather than a runtime-only refinement) also expresses the exclusion
// in OpenAPI. Malformed known tasks cannot escape through the legacy branch.
const LegacyTaskTypeSchema = z.string().regex(new RegExp('^(?!(?:' + KNOWN_TASK_TYPES.join('|') + ')$)[^]*$'))
  .describe('Legacy/extension task type, explicitly excluding all known types.')
const error = z.string().nullish()
export const ReviewTaskDoneResponseSchema = z.strictObject({
  status: z.literal('done'), type: ReviewTaskTypeSchema, error,
  session_id: z.string().optional().describe('Omitted when a reviewed session short-circuits task polling.'),
})
export const CopilotPrepTaskDoneResponseSchema = z.strictObject({ status: z.literal('done'), type: z.literal('copilot_prep'), prep_id: z.string(), error })
export const RetrospectiveTaskDoneResponseSchema = z.strictObject({
  status: z.literal('done'), type: z.literal('retrospective'), error,
  topic: z.string(), topic_name: z.string(), retrospective: z.string(), retrospective_at: z.string(), session_count: z.number().int().nonnegative(),
})
export const LegacyTaskDoneResponseSchema = z.object({ status: z.literal('done'), type: LegacyTaskTypeSchema, error }).passthrough()
export const TaskDoneResponseSchema = z.union([ReviewTaskDoneResponseSchema, CopilotPrepTaskDoneResponseSchema, RetrospectiveTaskDoneResponseSchema, LegacyTaskDoneResponseSchema])
// Imported historical records can carry result fields in any status. Preserve
// that payload on pending/error; the envelope itself is always validated.
export const TaskStatusResponseSchema = z.union([
  z.object({ status: z.literal('pending'), type: z.string(), error }).passthrough(),
  z.object({ status: z.literal('error'), type: z.string(), error }).passthrough(),
  TaskDoneResponseSchema,
])
