import { z } from 'zod'

export const InterviewTokenEventSchema = z.object({ token: z.string() }).strict()
export const InterviewDoneEventSchema = z.object({ done: z.literal(true), is_finished: z.boolean() }).strict()
export const InterviewStreamErrorSchema = z.object({ error: z.string() }).strict()
export const InterviewStreamEventSchema = z.union([
  InterviewTokenEventSchema, InterviewDoneEventSchema, InterviewStreamErrorSchema,
]).meta({ id: 'InterviewStreamEvent' })
export type InterviewStreamEvent = z.infer<typeof InterviewStreamEventSchema>
export type InterviewDoneEvent = z.infer<typeof InterviewDoneEventSchema>
