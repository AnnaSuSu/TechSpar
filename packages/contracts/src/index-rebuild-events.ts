import { z } from 'zod'

const step = { completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), label: z.string() }
export const IndexRebuildProgressSchema = z.discriminatedUnion('status', [
  z.object({ ...step, status: z.literal('running') }).strict(),
  z.object({ ...step, status: z.literal('done') }).strict(),
  z.object({ ...step, status: z.literal('error'), error: z.string() }).strict(),
])
export const IndexRebuildDoneSchema = z.object({
  done: z.literal(true),
  rebuilt: z.object({ weak_points: z.boolean(), personal_documents: z.boolean(), topics: z.array(z.string()) }).strict(),
  // Preserve the current second-precision timestamp without adding a timezone.
  last_rebuild_at: z.string(),
}).strict()
export const IndexRebuildFatalSchema = z.object({ fatal: z.literal(true), error: z.string() }).strict()
export const IndexRebuildEventSchema = z.union([
  IndexRebuildProgressSchema, IndexRebuildDoneSchema, IndexRebuildFatalSchema,
]).meta({ id: 'IndexRebuildEvent' })
export type IndexRebuildEvent = z.infer<typeof IndexRebuildEventSchema>
export type IndexRebuildProgress = z.infer<typeof IndexRebuildProgressSchema>
export type IndexRebuildDone = z.infer<typeof IndexRebuildDoneSchema>
