import { OpenAPIHono } from '@hono/zod-openapi'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import type { UpgradeWebSocket } from 'hono/ws'
import {
  AppError,
  type AuthPolicy,
  type AuthUseCases,
  type KnowledgeUseCases,
  type InterviewUseCases,
  type QuotaUseCases,
  type ResumeUseCases,
  type ProfileUseCases,
  type PersonalAgentUseCases,
  type DataMigrationUseCases,
  type RecordingUseCases,
  type CopilotPrepUseCases,
  type CopilotSessionUseCases,
  type CopilotRealtimeUseCases,
  type VoiceprintUseCases,
  type SettingsUseCases,
  type SettingsOperationsUseCases,
  type TokenService,
} from '@techspar/core'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerSettingsRoutes } from './routes/settings.ts'
import { registerKnowledgeRoutes } from './routes/knowledge.ts'
import { registerResumeRoutes } from './routes/resume.ts'
import { registerInterviewRoutes } from './routes/interview.ts'
import { registerProfileRoutes } from './routes/profile.ts'
import { registerPersonalAgentRoutes } from './routes/personal-agent.ts'
import { registerDataMigrationRoutes } from './routes/data-migration.ts'
import { registerRecordingRoutes } from './routes/recording.ts'
import { registerCopilotRoutes, registerCopilotSessionRoutes, registerCopilotWebSocket } from './routes/copilot.ts'
import { registerVoiceprintRoutes } from './routes/voiceprint.ts'
import { registerStaticFrontend } from './http/static-frontend.ts'
import { createOpenApiDocument } from './http/openapi.ts'
import { fastApiValidationBody } from './http/validation.ts'
import { LoginRateLimiter } from './http/login-rate-limiter.ts'
import type { LoginRateLimiter as LoginRateLimiterType } from './http/login-rate-limiter.ts'
import { requestBodyLimit } from './http/request-body-limit.ts'

export type AppDependencies = {
  auth: AuthUseCases
  registration: AuthPolicy
  settings: SettingsUseCases
  settingsOperations?: SettingsOperationsUseCases
  quota: QuotaUseCases
  tokens: TokenService
  knowledge: KnowledgeUseCases
  resume: ResumeUseCases
  interview?: InterviewUseCases
  profile?: ProfileUseCases
  personalAgent?: PersonalAgentUseCases
  migration?: DataMigrationUseCases
  recording?: RecordingUseCases
  copilotSessions?: CopilotSessionUseCases
  copilotPrep?: CopilotPrepUseCases
  copilotRealtime?: CopilotRealtimeUseCases
  websocketUpgrade?: UpgradeWebSocket
  voiceprint?: VoiceprintUseCases
  /** 追加路由。必须在静态前端兜底之前注册,否则会被 app.get('*') 吃掉。 */
  extendRoutes?: (app: OpenAPIHono) => void
  webDir?: string
  loginLimiter?: LoginRateLimiterType
  trustProxy?: boolean
}

export function createApp(deps: AppDependencies): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return c.json(fastApiValidationBody(result.target, result.error.issues, (result as { data?: unknown }).data), 422)
    },
  })

  app.use('*', requestId())
  app.use('/api/*', logger())
  app.use('/api/*', (c, next) => requestBodyLimit(c.req.path)(c, next))

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const response = error.getResponse()
      if (response.headers.get('content-type')?.includes('application/json')) return response
      return c.json({ detail: error.message }, error.status as 400)
    }
    if (error instanceof AppError) {
      return c.json({ detail: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details || {}) }, error.status as 400)
    }
    console.error(error)
    return c.json({ detail: 'Internal Server Error' }, 500)
  })

  registerAuthRoutes(app, { ...deps, loginLimiter: deps.loginLimiter || new LoginRateLimiter(), trustProxy: deps.trustProxy })
  registerSettingsRoutes(app, deps)
  registerKnowledgeRoutes(app, deps)
  registerResumeRoutes(app, deps)
  if (deps.interview) registerInterviewRoutes(app, { interview: deps.interview, tokens: deps.tokens })
  if (deps.profile) registerProfileRoutes(app, { profile: deps.profile, tokens: deps.tokens })
  if (deps.personalAgent) registerPersonalAgentRoutes(app, { personalAgent: deps.personalAgent, tokens: deps.tokens })
  if (deps.migration) registerDataMigrationRoutes(app, { migration: deps.migration, tokens: deps.tokens })
  if (deps.recording) registerRecordingRoutes(app, { recording: deps.recording, tokens: deps.tokens })
  if (deps.copilotSessions) registerCopilotSessionRoutes(app, { sessions: deps.copilotSessions, tokens: deps.tokens })
  if (deps.copilotPrep) registerCopilotRoutes(app, { prep: deps.copilotPrep, tokens: deps.tokens })
  if (deps.copilotRealtime && deps.websocketUpgrade) registerCopilotWebSocket(app, { realtime: deps.copilotRealtime, tokens: deps.tokens, upgrade: deps.websocketUpgrade })
  if (deps.voiceprint) registerVoiceprintRoutes(app, { voiceprint: deps.voiceprint, tokens: deps.tokens })
  deps.extendRoutes?.(app)
  app.get('/openapi.json', (c) => c.json(createOpenApiDocument(app)))
  if (deps.webDir) registerStaticFrontend(app, deps.webDir)
  return app
}
