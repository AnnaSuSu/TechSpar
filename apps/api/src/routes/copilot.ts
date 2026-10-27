import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import type { UpgradeWebSocket, WSContext, WSMessageReceive } from 'hono/ws'
import { z } from 'zod'
import { CopilotSessionListSchema, CopilotSessionDetailSchema, CopilotReviewSubmissionResponseSchema, decodeCopilotAudio, CopilotClientMessageSchema, CopilotPrepCreateSchema, CopilotPrepCreatedSchema, CopilotPrepListSchema, CopilotPrepObjectSchema, OkSchema } from '@techspar/contracts'
import type { CopilotSessionUseCases, CopilotPrepUseCases, CopilotRealtimeConnection, CopilotRealtimeUseCases, RequestContext, TokenService } from '@techspar/core'
import { copilotSender } from '../http/events.ts'
import { authenticatedContext } from '../http/context.ts'

import { validateResponse } from '../http/response.ts'

const PrepPath = z.object({ prep_id: z.string() })

export function registerCopilotRoutes(app: OpenAPIHono, deps: { prep: CopilotPrepUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'post', path: '/api/copilot/prep', request: { body: { content: { 'application/x-www-form-urlencoded': { schema: CopilotPrepCreateSchema }, 'multipart/form-data': { schema: CopilotPrepCreateSchema } } } }, responses: { 200: { content: { 'application/json': { schema: CopilotPrepCreatedSchema } }, description: 'Queued Copilot preparation' } } }),
    async (c) => c.json(await deps.prep.start(await authenticatedContext(c, deps.tokens), c.req.valid('form'))))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/preps', responses: { 200: { content: { 'application/json': { schema: CopilotPrepListSchema } }, description: 'Copilot preparations' } } }),
    async (c) => c.json(await deps.prep.list(await authenticatedContext(c, deps.tokens))))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/prep/{prep_id}', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: CopilotPrepObjectSchema } }, description: 'Copilot preparation status' } } }),
    async (c) => c.json(await deps.prep.get(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id)))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/prep/{prep_id}/tree', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: CopilotPrepObjectSchema } }, description: 'Copilot strategy tree' } } }),
    async (c) => c.json(await deps.prep.tree(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id)))
  app.openapi(createRoute({ method: 'delete', path: '/api/copilot/prep/{prep_id}', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Deleted Copilot preparation' } } }),
    async (c) => c.json(await deps.prep.delete(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id)))
}

export function registerCopilotSessionRoutes(app: OpenAPIHono, deps: { sessions: CopilotSessionUseCases; tokens: TokenService }): void {
  const SessionPath = z.object({ session_id: z.string() })
  const error = { content: { 'application/json': { schema: z.object({ detail: z.string() }) } }, description: 'Request could not be completed' }
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/prep/{prep_id}/sessions', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: CopilotSessionListSchema } }, description: 'Copilot session list' }, 400: error, 401: error, 404: error, 409: error } }),
    async (c) => c.json(validateResponse(CopilotSessionListSchema, await deps.sessions.list(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id), 'GET /api/copilot/prep/{prep_id}/sessions', c.get('requestId')), 200))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/sessions/{session_id}', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: CopilotSessionDetailSchema } }, description: 'Copilot session get' }, 400: error, 401: error, 404: error, 409: error } }),
    async (c) => c.json(validateResponse(CopilotSessionDetailSchema, await deps.sessions.get(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'GET /api/copilot/sessions/{session_id}', c.get('requestId')), 200))
  app.openapi(createRoute({ method: 'delete', path: '/api/copilot/sessions/{session_id}', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Copilot session delete' }, 400: error, 401: error, 404: error, 409: error } }),
    async (c) => c.json(validateResponse(OkSchema, await deps.sessions.delete(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'DELETE /api/copilot/sessions/{session_id}', c.get('requestId')), 200))
  app.openapi(createRoute({ method: 'post', path: '/api/copilot/sessions/{session_id}/review', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: CopilotReviewSubmissionResponseSchema } }, description: 'Copilot session review' }, 400: error, 401: error, 404: error, 409: error } }),
    async (c) => c.json(validateResponse(CopilotReviewSubmissionResponseSchema, await deps.sessions.review(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'POST /api/copilot/sessions/{session_id}/review', c.get('requestId')), 200))
}

function bytes(value: WSMessageReceive): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

export function registerCopilotWebSocket(app: OpenAPIHono, deps: { realtime: CopilotRealtimeUseCases; tokens: TokenService; upgrade: UpgradeWebSocket }): void {
  app.get('/ws/copilot/:session_id', deps.upgrade(async (c) => {
    const userId = await deps.tokens.decode(c.req.query('token') || '')
    let socket: WSContext | undefined
    let connection: CopilotRealtimeConnection | undefined
    let dualAudio = false
    const controller = new AbortController()
    const requestId = c.get('requestId') as string
    let cleanupPromise: Promise<void> | undefined
    const cleanup = () => {
      controller.abort()
      return cleanupPromise ||= Promise.resolve().then(() => connection?.close()).catch(() => {
        console.error({ operation: 'WS /ws/copilot/{session_id}', requestId, code: 'cleanup_failed' })
      })
    }
    const emit = copilotSender({
      requestId,
      closed: () => controller.signal.aborted || !socket || socket.readyState !== 1,
      send: (data) => socket?.send(data),
      fail: () => {
        // Never await connection.close() from inside emit: close waits for the
        // current handle chain, which may itself be awaiting this callback.
        void cleanup()
        socket?.close(1011, 'Internal Server Error')
      },
    })
    if (userId) {
      const context: RequestContext = { requestId, userId, signal: controller.signal }
      connection = deps.realtime.connect(context, c.req.param('session_id') || '', emit)
    }
    return {
      onOpen(_event, ws) { socket = ws; if (!userId) ws.close(1008, 'Authentication required') },
      async onMessage(event) {
        if (!connection || controller.signal.aborted) return
        try {
          if (typeof event.data !== 'string') {
            const value = bytes(event.data)
            if (value) {
              if (dualAudio) { const { source, pcm } = decodeCopilotAudio(value); connection.audio(pcm, source) }
              else connection.audio(value)
            }
            return
          }
          const parsed = CopilotClientMessageSchema.safeParse((() => { try { return JSON.parse(event.data) } catch { return undefined } })())
          if (!parsed.success) { await emit({ type: 'error', message: 'Invalid message' }); return }
          if (parsed.data.type === 'start') dualAudio = parsed.data.audio_mode === 'dual'
          await connection.handle(parsed.data)
        } catch (error) { await emit({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
      },
      async onClose() { await cleanup() },
      async onError() { await cleanup() },
    }
  }))
}
