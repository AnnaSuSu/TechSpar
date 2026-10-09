import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  AuthConfigSchema,
  AuthIdentitySchema,
  AuthResponseSchema,
  ChangePasswordRequestSchema,
  ChangePasswordResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ServiceInfoSchema,
} from '@techspar/contracts'
import type { AuthPolicy, AuthUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'
import { SERVICE_VERSION } from '../version.ts'

export function registerAuthRoutes(
  app: OpenAPIHono,
  deps: { auth: AuthUseCases; registration: AuthPolicy; tokens: TokenService },
): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/auth/me',
      responses: { 200: { content: { 'application/json': { schema: AuthIdentitySchema } }, description: 'Verified token identity' } },
    }),
    async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      return c.json(AuthIdentitySchema.parse({ id: context.userId }))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/',
      responses: { 200: { content: { 'application/json': { schema: ServiceInfoSchema } }, description: 'Service info' } },
    }),
    (c) => c.json({ service: 'TechSpar' as const, version: SERVICE_VERSION }),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/password',
      request: { body: { content: { 'application/json': { schema: ChangePasswordRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: ChangePasswordResponseSchema } }, description: 'Password changed' } },
    }),
    async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      const body = c.req.valid('json')
      return c.json(await deps.auth.changePassword(context.userId!, body.current_password, body.new_password))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/auth/config',
      responses: { 200: { content: { 'application/json': { schema: AuthConfigSchema } }, description: 'Registration configuration' } },
    }),
    (c) => c.json({ allow_registration: deps.registration.allowRegistration }),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/login',
      request: { body: { content: { 'application/json': { schema: LoginRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Authenticated user' } },
    }),
    async (c) => {
      const body = c.req.valid('json')
      return c.json(await deps.auth.login(body.email, body.password))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/register',
      request: { body: { content: { 'application/json': { schema: RegisterRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Registered user' } },
    }),
    async (c) => {
      const body = c.req.valid('json')
      return c.json(await deps.auth.register(body.email, body.password, body.name))
    },
  )
}
