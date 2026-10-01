import { InterviewChatResponseSchema, InterviewDraftResponseSchema, InterviewHistoryResponseSchema, InterviewResumeResponseSchema, InterviewReviewSubmissionResponseSchema, InterviewSessionResponseSchema, InterviewStartResponseSchema, JobPrepPreviewResponseSchema, JobPrepStartResponseSchema, TaskStatusResponseSchema } from '@techspar/contracts'
import { validateResponse } from '../http/response.ts'
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { validatedSse } from '../http/events.ts'
import { InterviewStreamEventSchema } from '@techspar/contracts/events'
import { z } from 'zod'
import {
  EndInterviewSchema,
  InterviewChatSchema,
  InterviewModeSchema,
  InterviewTopicsSchema,
  JobPrepPreviewSchema,
  JobPrepStartSchema,
  OkSchema,
  ReferenceAnswerRequestSchema,
  ReferenceAnswerResponseSchema,
  StartInterviewSchema,
} from '@techspar/contracts'
import type { InterviewUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

const SessionPath = z.object({ session_id: z.string() })
const TaskPath = z.object({ task_id: z.string() })
const ReferenceAnswerResultSchema = ReferenceAnswerResponseSchema.strict()
const DeleteSessionResponseSchema = OkSchema.strict()

export function registerInterviewRoutes(app: OpenAPIHono, deps: { interview: InterviewUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'post', path: '/api/job-prep/preview', request: { body: { content: { 'application/json': { schema: JobPrepPreviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: JobPrepPreviewResponseSchema.meta({ id: 'JobPrepPreviewResponse' }) } }, description: 'JD preview' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(validateResponse(JobPrepPreviewResponseSchema, await deps.interview.previewJob(await authenticatedContext(c, deps.tokens), { ...body, company: body.company ?? undefined, position: body.position ?? undefined }), 'POST /api/job-prep/preview', c.get('requestId'))) })

  app.openapi(createRoute({ method: 'post', path: '/api/job-prep/start', request: { body: { content: { 'application/json': { schema: JobPrepStartSchema } } } }, responses: { 200: { content: { 'application/json': { schema: JobPrepStartResponseSchema.meta({ id: 'JobPrepStartResponse' }) } }, description: 'Start JD interview' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(validateResponse(JobPrepStartResponseSchema, await deps.interview.startJob(await authenticatedContext(c, deps.tokens), { ...body, company: body.company ?? undefined, position: body.position ?? undefined }), 'POST /api/job-prep/start', c.get('requestId'))) })

  app.openapi(createRoute({ method: 'post', path: '/api/interview/start', request: { body: { content: { 'application/json': { schema: StartInterviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewStartResponseSchema.meta({ id: 'InterviewStartResponse' }) } }, description: 'Start interview' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(validateResponse(InterviewStartResponseSchema, await deps.interview.start(await authenticatedContext(c, deps.tokens), { ...body, topic: body.topic ?? undefined }), 'POST /api/interview/start', c.get('requestId'))) })

  app.openapi(createRoute({ method: 'post', path: '/api/interview/chat', request: { body: { content: { 'application/json': { schema: InterviewChatSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewChatResponseSchema.meta({ id: 'InterviewChatResponse' }) } }, description: 'Interview turn' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(validateResponse(InterviewChatResponseSchema, await deps.interview.chat(await authenticatedContext(c, deps.tokens), body.session_id, body.message), 'POST /api/interview/chat', c.get('requestId'))) })

  app.openapi(createRoute({
    method: 'post', path: '/api/interview/chat/stream',
    request: { body: { content: { 'application/json': { schema: InterviewChatSchema } } } },
    responses: { 200: { content: { 'text/event-stream': { schema: z.string(), 'x-event-schema': { $ref: '#/components/schemas/InterviewStreamEvent' } } }, description: 'JSON data frames: token, done/is_finished, or error. See InterviewStreamEvent.' } },
  }), async (c) => {
    const parsed = InterviewChatSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ detail: parsed.error.message }, 422)
    const context = await authenticatedContext(c, deps.tokens)
    return validatedSse(c, {
      context, operation: 'POST /api/interview/chat/stream', schema: InterviewStreamEventSchema,
      events: (streamContext) => deps.interview.chatStream(streamContext, parsed.data.session_id, parsed.data.message),
      terminal: (event) => 'done' in event || 'error' in event,
      failure: (message) => ({ error: message }),
    })
  })

  app.openapi(createRoute({ method: 'post', path: '/api/interview/end/{session_id}', request: { params: SessionPath, body: { required: false, content: { 'application/json': { schema: EndInterviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewReviewSubmissionResponseSchema.meta({ id: 'InterviewReviewSubmissionResponse' }) } }, description: 'End interview' } } }),
    async (c) => c.json(validateResponse(InterviewReviewSubmissionResponseSchema, await deps.interview.end(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json')?.answers || []), 'POST /api/interview/end/{session_id}', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/interview/draft/{session_id}', request: { params: SessionPath, body: { content: { 'application/json': { schema: EndInterviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewDraftResponseSchema.meta({ id: 'InterviewDraftResponse' }) } }, description: 'Save draft' } } }),
    async (c) => c.json(validateResponse(InterviewDraftResponseSchema, await deps.interview.draft(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json').answers), 'POST /api/interview/draft/{session_id}', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/interview/review/{session_id}/generate', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: InterviewReviewSubmissionResponseSchema.meta({ id: 'InterviewReviewSubmissionResponse' }) } }, description: 'Generate review' } } }),
    async (c) => c.json(validateResponse(InterviewReviewSubmissionResponseSchema, await deps.interview.generateReview(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'POST /api/interview/review/{session_id}/generate', c.get('requestId'))))

  app.openapi(createRoute({ method: 'get', path: '/api/interview/session/{session_id}/resume', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: InterviewResumeResponseSchema.meta({ id: 'InterviewResumeResponse' }) } }, description: 'Resume session' } } }),
    async (c) => c.json(validateResponse(InterviewResumeResponseSchema, await deps.interview.resume(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'GET /api/interview/session/{session_id}/resume', c.get('requestId'))))

  app.openapi(createRoute({ method: 'post', path: '/api/interview/reference-answer', request: { body: { content: { 'application/json': { schema: ReferenceAnswerRequestSchema } } } }, responses: { 200: { content: { 'application/json': { schema: ReferenceAnswerResultSchema } }, description: 'Reference answer' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(validateResponse(ReferenceAnswerResultSchema, await deps.interview.referenceAnswer(await authenticatedContext(c, deps.tokens), body.session_id, body.question_id), 'POST /api/interview/reference-answer', c.get('requestId'))) })

  app.openapi(createRoute({ method: 'get', path: '/api/interview/review/{session_id}', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: InterviewSessionResponseSchema.meta({ id: 'InterviewSessionResponse' }) } }, description: 'Review' } } }),
    async (c) => c.json(validateResponse(InterviewSessionResponseSchema, await deps.interview.review(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'GET /api/interview/review/{session_id}', c.get('requestId'))))

  app.openapi(createRoute({ method: 'get', path: '/api/tasks/{task_id}', request: { params: TaskPath }, responses: { 200: { content: { 'application/json': { schema: TaskStatusResponseSchema.meta({ id: 'TaskStatusResponse' }) } }, description: 'Task status' } } }),
    async (c) => c.json(validateResponse(TaskStatusResponseSchema, await deps.interview.task(await authenticatedContext(c, deps.tokens), c.req.valid('param').task_id), 'GET /api/tasks/{task_id}', c.get('requestId'))))

  app.openapi(createRoute({ method: 'get', path: '/api/interview/history', request: { query: z.object({ limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional(), mode: InterviewModeSchema.optional(), topic: z.string().optional() }) }, responses: { 200: { content: { 'application/json': { schema: InterviewHistoryResponseSchema.meta({ id: 'InterviewHistoryResponse' }) } }, description: 'History' } } }),
    async (c) => c.json(validateResponse(InterviewHistoryResponseSchema, await deps.interview.history(await authenticatedContext(c, deps.tokens), c.req.valid('query')), 'GET /api/interview/history', c.get('requestId'))))

  app.openapi(createRoute({ method: 'delete', path: '/api/interview/session/{session_id}', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: DeleteSessionResponseSchema } }, description: 'Delete session' } } }),
    async (c) => c.json(validateResponse(DeleteSessionResponseSchema, await deps.interview.delete(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'DELETE /api/interview/session/{session_id}', c.get('requestId'))))

  app.openapi(createRoute({ method: 'get', path: '/api/interview/topics', responses: { 200: { content: { 'application/json': { schema: InterviewTopicsSchema } }, description: 'Interview topics' } } }),
    async (c) => c.json(validateResponse(InterviewTopicsSchema, await deps.interview.topics(await authenticatedContext(c, deps.tokens)), 'GET /api/interview/topics', c.get('requestId'))))
}
