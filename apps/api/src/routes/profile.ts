import { CandidateProfileResponseSchema, ProfileDueReviewsResponseSchema, ProfilePatternFeedbackResponseSchema, ProfileTopicHistoryResponseSchema, ProfileViewedResponseSchema } from '@techspar/contracts'
import { validateResponse } from '../http/response.ts'
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { ProfileFeedbackSchema, RetrospectiveTaskSchema, TargetRoleSchema } from '@techspar/contracts'
import type { ProfileUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

const TopicPath = z.object({ topic: z.string() })
const TargetRoleResponseSchema = TargetRoleSchema.strict()
const RetrospectiveSubmissionResponseSchema = RetrospectiveTaskSchema.strict()

export function registerProfileRoutes(app: OpenAPIHono, deps: { profile: ProfileUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'get', path: '/api/profile', responses: { 200: { content: { 'application/json': { schema: CandidateProfileResponseSchema.meta({ id: 'CandidateProfileResponse' }) } }, description: 'Candidate profile' } } }),
    async (c) => c.json(validateResponse(CandidateProfileResponseSchema, await deps.profile.get(await authenticatedContext(c, deps.tokens)), 'GET /api/profile', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/infer-target-role', responses: { 200: { content: { 'application/json': { schema: TargetRoleResponseSchema } }, description: 'Infer role' } } }),
    async (c) => c.json(validateResponse(TargetRoleResponseSchema, await deps.profile.inferTargetRole(await authenticatedContext(c, deps.tokens)), 'POST /api/profile/infer-target-role', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/viewed', responses: { 200: { content: { 'application/json': { schema: ProfileViewedResponseSchema.meta({ id: 'ProfileViewedResponse' }) } }, description: 'Mark profile viewed' } } }),
    async (c) => c.json(validateResponse(ProfileViewedResponseSchema, await deps.profile.viewed(await authenticatedContext(c, deps.tokens)), 'POST /api/profile/viewed', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/pattern/feedback', request: { body: { content: { 'application/json': { schema: ProfileFeedbackSchema } } } }, responses: { 200: { content: { 'application/json': { schema: ProfilePatternFeedbackResponseSchema.meta({ id: 'ProfilePatternFeedbackResponse' }) } }, description: 'Pattern feedback' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(validateResponse(ProfilePatternFeedbackResponseSchema, await deps.profile.feedback(await authenticatedContext(c, deps.tokens), body.point, body.verdict), 'POST /api/profile/pattern/feedback', c.get('requestId'))) })

  app.openapi(createRoute({ method: 'get', path: '/api/profile/due-reviews', request: { query: z.object({ topic: z.string().optional() }) }, responses: { 200: { content: { 'application/json': { schema: ProfileDueReviewsResponseSchema.meta({ id: 'ProfileDueReviewsResponse' }) } }, description: 'Due reviews' } } }),
    async (c) => c.json(validateResponse(ProfileDueReviewsResponseSchema, await deps.profile.dueReviews(await authenticatedContext(c, deps.tokens), c.req.valid('query').topic), 'GET /api/profile/due-reviews', c.get('requestId'))))

  app.openapi(createRoute({ method: 'get', path: '/api/profile/topic/{topic}/history', request: { params: TopicPath }, responses: { 200: { content: { 'application/json': { schema: ProfileTopicHistoryResponseSchema.meta({ id: 'ProfileTopicHistoryResponse' }) } }, description: 'Topic history' } } }),
    async (c) => c.json(validateResponse(ProfileTopicHistoryResponseSchema, await deps.profile.topicHistory(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic), 'GET /api/profile/topic/{topic}/history', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/topic/{topic}/retrospective', request: { params: TopicPath }, responses: { 200: { content: { 'application/json': { schema: RetrospectiveSubmissionResponseSchema } }, description: 'Generate retrospective' } } }),
    async (c) => c.json(validateResponse(RetrospectiveSubmissionResponseSchema, await deps.profile.retrospective(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic), 'POST /api/profile/topic/{topic}/retrospective', c.get('requestId'))))
}
