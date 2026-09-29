import { z } from 'zod'

export const InterviewModeSchema = z.enum(['resume', 'topic_drill', 'jd_prep', 'recording'])
export const SessionStatusSchema = z.enum(['ongoing', 'ended', 'reviewing', 'reviewed', 'review_failed'])
export const InterviewQuestionSchema = z.object({
  id: z.union([z.string(), z.number()]),
  question: z.string(),
  difficulty: z.number().optional(),
  focus_area: z.string().optional(),
  category: z.string().optional(),
  intent: z.string().optional(),
}).passthrough()
