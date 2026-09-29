import type { z } from 'zod'

const dynamicMaps = new Set(['topic_mastery', 'behavior_signals', 'topic_scores', 'reference_answers', 'dimension_scores', 'session_extractions'])

/** Only sanitized diagnostics cross the app's centralized 500 handler. */
export class ResponseContractError extends Error {
  constructor(readonly operation: string, readonly requestId: string, readonly issues: ReadonlyArray<{ code: string; path: PropertyKey[] }>) {
    super(`Response contract violation: ${operation}`)
    this.name = 'ResponseContractError'
  }
}

export function validateResponse<S extends z.ZodType>(schema: S, value: unknown, operation: string, requestId: string): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    // Never attach the raw value, ZodError messages or union issue payloads: these
    // can contain private resume/chat/provider data or unrecognized field names.
    throw new ResponseContractError(operation, requestId, parsed.error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.map((part, index) => index > 0 && dynamicMaps.has(String(issue.path[index - 1])) ? '*' : part),
    })))
  }
  return parsed.data
}
