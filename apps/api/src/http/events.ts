import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { z } from 'zod'
import { CopilotServerEventSchema } from '@techspar/contracts/events'
import type { RequestContext } from '@techspar/core'
import { ResponseContractError, validateResponse } from './response.ts'

export function encodeEvent(schema: z.ZodType, value: unknown, operation: string, requestId: string): string {
  const event = validateResponse(schema, value, operation, requestId)
  try { return JSON.stringify(event) }
  catch { throw new ResponseContractError(operation, requestId, [{ code: 'invalid_json', path: [] }]) }
}

/** Every source of WS output, including route errors, uses this boundary. */
export function copilotSender(options: { requestId: string; send(data: string): void; fail(): void; closed(): boolean }) {
  const operation = 'WS /ws/copilot/{session_id}'
  let failed = false
  return async (value: unknown): Promise<void> => {
    if (failed || options.closed()) return
    let data: string
    try { data = encodeEvent(CopilotServerEventSchema, value, operation, options.requestId) }
    catch (error) {
      // Error objects contain only sanitized schema diagnostics, never model data.
      console.error(error)
      const type = value && typeof value === 'object' && 'type' in value ? value.type : undefined
      if (type === 'hr_profile_update' || type === 'monitor_update') return
      failed = true
      try { options.send(encodeEvent(CopilotServerEventSchema, { type: 'error', message: 'Internal Server Error' }, operation, options.requestId)) }
      catch { /* The socket may have closed during validation. */ }
      finally { options.fail() }
      return
    }
    try { options.send(data) }
    catch { failed = true; options.fail() }
  }
}

/** Keep the terminal event until the producer has completed its final writes. */
export function validatedSse<T>(c: Context, options: {
  context: RequestContext
  operation: string
  schema: z.ZodType<T>
  events(context: RequestContext): AsyncIterable<unknown>
  terminal(event: T): boolean
  failure(message: string): T
}) {
  const controller = new AbortController()
  const context = { ...options.context, requestId: (c.get('requestId') as string) || options.context.requestId, signal: AbortSignal.any([options.context.signal, controller.signal]) }
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => controller.abort())
    const encode = (value: unknown) => encodeEvent(options.schema, value, options.operation, context.requestId)
    let completion: string | undefined
    try {
      if (context.signal.aborted) return
      for await (const value of options.events(context)) {
        if (context.signal.aborted || stream.aborted) return
        const event = validateResponse(options.schema, value, options.operation, context.requestId)
        if (completion !== undefined) throw new ResponseContractError(options.operation, context.requestId, [{ code: 'event_after_terminal', path: [] }])
        const data = encode(event)
        if (options.terminal(event)) completion = data
        else await stream.writeSSE({ data })
      }
      if (context.signal.aborted || stream.aborted) return
      if (completion === undefined) throw new ResponseContractError(options.operation, context.requestId, [{ code: 'missing_terminal', path: [] }])
      await stream.writeSSE({ data: completion })
    } catch (error) {
      if (context.signal.aborted || stream.aborted) return
      if (error instanceof ResponseContractError) console.error(error)
      const message = error instanceof ResponseContractError ? 'Internal Server Error' : error instanceof Error ? error.message : String(error)
      await stream.writeSSE({ data: encode(options.failure(message)) })
    } finally { controller.abort() }
  })
}
