import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { validatedSse } from '../http/events.ts'
import { IndexRebuildEventSchema } from '@techspar/contracts/events'
import { z } from 'zod'
import { EmbeddingSettingsSchema, LlmSettingsSchema, QuotaStatusSchema, SettingsProbeResponseSchema, SettingsUpdateResponseSchema, SettingsViewSchema } from '@techspar/contracts'
import type { QuotaUseCases, SettingsOperationsUseCases, SettingsUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

export function registerSettingsRoutes(
  app: OpenAPIHono,
  deps: { settings: SettingsUseCases; settingsOperations?: SettingsOperationsUseCases; quota: QuotaUseCases; tokens: TokenService },
): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/settings',
      responses: { 200: { content: { 'application/json': { schema: SettingsViewSchema } }, description: 'User settings' } },
    }),
    async (c) => c.json(await deps.settings.get(await authenticatedContext(c, deps.tokens))),
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/settings',
      request: { body: { content: { 'application/json': { schema: SettingsViewSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: SettingsUpdateResponseSchema } }, description: 'Updated settings' } },
    }),
    async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      return c.json(await deps.settings.update(context, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/usage/quota',
      responses: { 200: { content: { 'application/json': { schema: QuotaStatusSchema } }, description: 'Current quota' } },
    }),
    async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      const userId = context.userId!
      return c.json(await deps.quota.status(userId, await deps.settings.llmSource(context)))
    },
  )

  if (deps.settingsOperations) {
    app.openapi(
      createRoute({
        method: 'post',
        path: '/api/settings/test-llm',
        request: { body: { content: { 'application/json': { schema: LlmSettingsSchema } } } },
        responses: { 200: { content: { 'application/json': { schema: SettingsProbeResponseSchema } }, description: 'Test submitted LLM settings' } },
      }),
      async (c) => c.json(await deps.settingsOperations!.testLlm(await authenticatedContext(c, deps.tokens), c.req.valid('json'))),
    )

    app.openapi(
      createRoute({
        method: 'post',
        path: '/api/settings/test-embedding',
        request: { body: { content: { 'application/json': { schema: EmbeddingSettingsSchema } } } },
        responses: { 200: { content: { 'application/json': { schema: SettingsProbeResponseSchema } }, description: 'Test submitted embedding settings' } },
      }),
      async (c) => c.json(await deps.settingsOperations!.testEmbedding(await authenticatedContext(c, deps.tokens), c.req.valid('json'))),
    )

    app.openapi(createRoute({
      method: 'post', path: '/api/settings/rebuild-index',
      responses: { 200: { content: { 'text/event-stream': { schema: z.string(), 'x-event-schema': { $ref: '#/components/schemas/IndexRebuildEvent' } } }, description: 'JSON data frames: step progress/error, done, or fatal. See IndexRebuildEvent.' } },
    }), async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      return validatedSse(c, {
        context, operation: 'POST /api/settings/rebuild-index', schema: IndexRebuildEventSchema,
        events: (streamContext) => deps.settingsOperations!.rebuildIndex(streamContext),
        terminal: (event) => 'done' in event || 'fatal' in event,
        failure: (message) => ({ fatal: true as const, error: message }),
      })
    })
  }
}
