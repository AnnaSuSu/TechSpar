import { z } from 'zod'

export const CopilotConversationTurnSchema = z.strictObject({ role: z.enum(['hr', 'candidate']), text: z.string(), at: z.string() })
export const CopilotSessionSummarySchema = z.strictObject({
  session_id: z.string(), prep_id: z.string(), status: z.enum(['active', 'stopped']),
  hr_turns: z.number().int().nonnegative(), candidate_turns: z.number().int().nonnegative(),
  created_at: z.string(), updated_at: z.string(), review_session_id: z.string().nullable(),
})
export const CopilotSessionListSchema = z.array(CopilotSessionSummarySchema)
export const CopilotSessionDetailSchema = CopilotSessionSummarySchema.extend({ company: z.string(), position: z.string(), conversation: z.array(CopilotConversationTurnSchema) })
export const CopilotReviewSubmissionResponseSchema = z.strictObject({ copilot_session_id: z.string(), review_session_id: z.string(), mode: z.literal('copilot'), status: z.literal('pending'), created: z.boolean() })
