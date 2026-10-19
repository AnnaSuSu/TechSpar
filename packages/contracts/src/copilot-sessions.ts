import { z } from 'zod'

export const CopilotConversationTurnSchema = z.strictObject({ role: z.enum(['hr', 'candidate']), text: z.string(), at: z.string() })
export const CopilotReviewStatusSchema = z.enum(['pending', 'done', 'error'])
export const CopilotSessionSummarySchema = z.strictObject({
  session_id: z.string(), prep_id: z.string(), status: z.enum(['active', 'stopped']),
  hr_turns: z.number().int().nonnegative(), candidate_turns: z.number().int().nonnegative(),
  created_at: z.string(), updated_at: z.string(),
  in_progress: z.boolean().describe('Still receiving turns; review and deletion return 409 until it ends.'),
  review_session_id: z.string().nullable(),
  review_status: z.union([CopilotReviewStatusSchema, z.literal('missing')]).nullable().describe('null: never reviewed; missing: the linked review was deleted and can be generated again.'),
})
export const CopilotSessionListSchema = z.array(CopilotSessionSummarySchema)
export const CopilotSessionDetailSchema = CopilotSessionSummarySchema.extend({ company: z.string(), position: z.string(), conversation: z.array(CopilotConversationTurnSchema) })
export const CopilotReviewSubmissionResponseSchema = z.strictObject({ copilot_session_id: z.string(), review_session_id: z.string(), mode: z.literal('copilot'), status: CopilotReviewStatusSchema, created: z.boolean() })
