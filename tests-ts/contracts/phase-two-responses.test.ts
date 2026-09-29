import { describe, expect, spyOn, test } from 'bun:test'
import type { AppDependencies } from '../../apps/api/src/app.ts'
import { ResponseContractError, validateResponse } from '../../apps/api/src/http/response.ts'
import {
  CandidateProfileResponseSchema, InterviewChatResponseSchema, InterviewDraftResponseSchema,
  InterviewHistoryResponseSchema, InterviewSessionResponseSchema, InterviewStartResponseSchema,
  JobPrepStartResponseSchema, KNOWN_TASK_TYPES, TaskStatusResponseSchema,
} from '@techspar/contracts'
import { loadResponseFixture } from './fixture.ts'
import { caseFixture, caseRequest, phaseTwoCases } from './phase-two-cases.ts'
import { responseInventory } from './response-inventory.ts'
import { boundaryApp, jsonHeaders } from './test-app.ts'

// An independent list of required fields, not generated from the schema under test.
const requiredFields: Record<string, string[]> = {
  previewJob: ['preview'],
  startJob: ['session_id', 'mode', 'questions', 'preview', 'company', 'position', 'meta'],
  start: ['session_id', 'mode', 'topic', 'questions'],
  chat: ['session_id', 'message', 'is_finished'],
  end: ['session_id', 'mode', 'status'],
  draft: ['session_id', 'status', 'saved'],
  generateReview: ['session_id', 'mode', 'status'],
  resume: ['session_id', 'mode', 'status', 'transcript', 'questions', 'target_role', 'job_description', 'meta', 'can_continue', 'is_finished', 'has_review'],
  referenceAnswer: ['reference_answer', 'cached'],
  review: ['session_id', 'mode', 'meta', 'questions', 'transcript', 'scores', 'weak_points', 'overall', 'reference_answers', 'status', 'user_id', 'created_at', 'updated_at'],
  task: ['status', 'type'],
  history: ['items', 'total'],
  delete: ['ok'],
  get: ['name', 'target_role', 'updated_at', 'last_consolidation_at', 'topic_mastery', 'weak_points', 'strong_points', 'behavior_signals', 'communication', 'thinking_patterns', 'stats', 'due_reviews'],
  inferTargetRole: ['target_role'],
  viewed: ['at', 'total_sessions', 'topic_scores'],
  feedback: ['point'],
  retrospective: ['task_id', 'status'],
}

describe('phase two response contracts at every HTTP boundary', () => {
  test('covers all 21 scoped JSON operations, excluding the phase-three stream', () => {
    const scoped = responseInventory.filter((entry) => entry.transport === 'json' && ['apps/api/src/routes/interview.ts', 'apps/api/src/routes/profile.ts'].includes(entry.routeFile))
    expect<unknown>(phaseTwoCases).toHaveLength(21)
    expect<unknown>(phaseTwoCases.map((entry) => entry.operation).sort()).toEqual(scoped.map((entry) => entry.operation).sort())
    expect<unknown>(scoped.every((entry) => !entry.dynamic && Boolean(entry.responseSchema))).toBe(true)
  })

  for (const entry of phaseTwoCases) {
    test(entry.operation + ' preserves the full fixture and enforces the output contract', async () => {
      const expected = await caseFixture(entry)
      expect<unknown>(entry.schema.parse(expected)).toEqual(expected)
      let output = expected
      const app = boundaryApp({ [entry.service]: { [entry.useCase]: async () => output } } as unknown as Partial<AppDependencies>)
      const { path, method } = caseRequest(entry)
      const request = () => app.request(path, { method, headers: entry.body === undefined ? { authorization: jsonHeaders.authorization } : jsonHeaders, ...(entry.body === undefined ? {} : { body: JSON.stringify(entry.body) }) })
      const response = await request()
      expect<unknown>(response.status).toBe(200)
      expect<unknown>(response.headers.get('content-type')).toContain('application/json')
      expect<unknown>(await response.json()).toEqual(expected)

      const invalidOutputs: unknown[] = [null]
      if (Array.isArray(expected)) invalidOutputs.push([{}])
      else {
        expect<unknown>(requiredFields[entry.useCase]?.length).toBeGreaterThan(0)
        for (const key of requiredFields[entry.useCase]!) {
          const missing = { ...expected as Record<string, unknown> }
          delete missing[key]
          invalidOutputs.push(missing)
        }
      }
      const log = spyOn(console, 'error').mockImplementation(() => {})
      try {
        for (output of invalidOutputs) {
          expect<unknown>(() => entry.schema.parse(output)).toThrow()
          const invalid = await request()
          expect<unknown>(invalid.status).toBe(500)
          expect<unknown>(await invalid.json()).toEqual({ detail: 'Internal Server Error' })
        }
        expect<unknown>(log).toHaveBeenCalledTimes(invalidOutputs.length)
        const error = log.mock.calls[0]![0]
        expect<unknown>(error).toBeInstanceOf(ResponseContractError)
        expect<unknown>(error.operation).toBe(entry.operation)
        expect<unknown>(error.requestId).toBeString()
      } finally { log.mockRestore() }
    })
  }
})

describe('response variants and compatibility islands', () => {
  test('discriminates starts and drafts instead of making every field optional', () => {
    const resume = { session_id: 's', mode: 'resume', target_role: '工程师', job_description: '', message: '' }
    expect<unknown>(InterviewStartResponseSchema.parse(resume)).toEqual(resume)
    expect<unknown>(InterviewStartResponseSchema.parse({ ...resume, topic: null })).toEqual({ ...resume, topic: null })
    expect<unknown>(InterviewStartResponseSchema.safeParse({ session_id: 's', mode: 'topic_drill', topic: 'ts' }).success).toBe(false)
    expect<unknown>(InterviewStartResponseSchema.safeParse({ session_id: 's', mode: 'resume', questions: [] }).success).toBe(false)
    expect<unknown>(InterviewDraftResponseSchema.safeParse({ session_id: 's', status: 'ongoing', saved: false }).success).toBe(false)
    for (const status of ['ended', 'reviewing', 'reviewed', 'review_failed']) {
      expect<unknown>(InterviewDraftResponseSchema.parse({ session_id: 's', status, saved: false })).toEqual({ session_id: 's', status, saved: false })
    }
    expect<unknown>(InterviewChatResponseSchema.parse({ session_id: 's', message: '', is_finished: true })).toEqual({ session_id: 's', message: '', is_finished: true })
  })

  test('retains complete sessions, mixed IDs, legacy timestamps and raw review content', async () => {
    const fixture = await loadResponseFixture('interview-review.json') as Record<string, unknown>
    expect<unknown>(InterviewSessionResponseSchema.parse(fixture)).toEqual(fixture)
    expect<unknown>(InterviewSessionResponseSchema.safeParse({ ...fixture, transcript: [{ role: 'system', content: 'bad' }] }).success).toBe(false)
    expect<unknown>(InterviewSessionResponseSchema.safeParse({ ...fixture, questions: [{ id: true, question: 'bad' }] }).success).toBe(false)
    const empty = { ...fixture, questions: [], transcript: [], scores: [], weak_points: [], overall: {}, created_at: '', updated_at: '' }
    expect<unknown>(InterviewSessionResponseSchema.parse(empty)).toEqual(empty)
    expect<unknown>(InterviewHistoryResponseSchema.parse({ items: [], total: 0 })).toEqual({ items: [], total: 0 })
    expect<unknown>(InterviewHistoryResponseSchema.safeParse({ items: [], total: -1 }).success).toBe(false)
  })

  test('preserves caller-supplied partial preview_data at job start', async () => {
    const fixture = await loadResponseFixture('interview-start-jd.json') as Record<string, unknown>
    const preview = { legacy: ['kept'], company: '示例公司' }
    const value = { ...fixture, preview, meta: { ...fixture.meta as object, preview } }
    expect<unknown>(JobPrepStartResponseSchema.parse(value)).toEqual(value)
  })

  test('validates rich profiles without dropping legacy/cache fields or zero scores', async () => {
    const fixture = await loadResponseFixture('profile-rich.json')
    const value = CandidateProfileResponseSchema.parse(fixture)
    expect<unknown>(value).toEqual(fixture)
    expect<unknown>(value.topic_mastery.typescript?.score).toBe(0)
    expect<unknown>(value.topic_mastery.python?.level).toBe(3)
    expect<unknown>(value.weak_points[1]!.sr).toBeUndefined()
    expect<unknown>(value.due_reviews[1]).not.toHaveProperty('next_review')
    expect<unknown>(CandidateProfileResponseSchema.safeParse({ ...value, stats: { ...value.stats, total_sessions: '2' } }).success).toBe(false)
    expect<unknown>(CandidateProfileResponseSchema.safeParse({ ...value, topic_mastery: { ts: { score: '7' } } }).success).toBe(false)
    expect<unknown>(CandidateProfileResponseSchema.safeParse({ ...value, weak_points: [{ topic: 'ts' }] }).success).toBe(false)
    expect<unknown>(CandidateProfileResponseSchema.safeParse({ ...value, behavior_signals: { signal: { examples: [{ snippet: 42 }] } } }).success).toBe(false)
  })

  test('accepts complete task variants and preserves the flat wire format', async () => {
    for (const name of ['task-pending.json', 'task-done.json', 'task-error.json', 'task-retrospective.json', 'task-copilot-prep.json']) {
      const value = await loadResponseFixture(name)
      expect<unknown>(TaskStatusResponseSchema.parse(value)).toEqual(value)
    }
    for (const type of ['resume_review', 'drill_review', 'jd_review', 'recording_review', 'review']) {
      expect<unknown>(TaskStatusResponseSchema.parse({ status: 'done', type })).toEqual({ status: 'done', type })
    }
    for (const error of [null, undefined, 'failed']) {
      expect<unknown>(TaskStatusResponseSchema.parse({ status: 'error', type: 'drill_review', error })).toEqual({ status: 'error', type: 'drill_review', error })
    }
    const retry = { status: 'pending', type: 'retrospective', topic: 'ts', legacy_result: { kept: true } }
    expect<unknown>(TaskStatusResponseSchema.parse(retry)).toEqual(retry)
    const extension = { status: 'done', type: 'extension_task', custom_result: { kept: true } }
    expect<unknown>(TaskStatusResponseSchema.parse(extension)).toEqual(extension)
  })

  test('does not let malformed known tasks escape through the extension branch', () => {
    const invalid = [
      { status: 'running', type: 'drill_review' },
      { status: 'done', type: 'copilot_prep' },
      { status: 'done', type: 'retrospective' },
      { status: 'done', type: 'retrospective', topic: 123 },
      ...KNOWN_TASK_TYPES.map((type) => ({ status: 'done', type, unrelated: true })),
      { status: 'done', type: 'drill_review', session_id: 123 },
      { status: 'error', type: 'drill_review', error: {} },
    ]
    for (const value of invalid) expect<unknown>(TaskStatusResponseSchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
  })

  test('sanitizes response errors instead of attaching provider or resume values', () => {
    const secret = 'synthetic-private-resume-text'
    try {
      validateResponse(InterviewChatResponseSchema, { session_id: 's', message: { [secret]: secret }, is_finished: false, [secret]: secret }, 'POST /api/interview/chat', 'request-test')
      throw new Error('Expected validation to fail')
    } catch (error) {
      expect<unknown>(error).toBeInstanceOf(ResponseContractError)
      expect<unknown>(JSON.stringify(error)).not.toContain(secret)
      expect<unknown>((error as Error).message).not.toContain(secret)
    }
  })

  test('redacts arbitrary user-controlled keys in typed profile maps', async () => {
    const secret = 'synthetic_private_topic_key'
    const profile = CandidateProfileResponseSchema.parse(await loadResponseFixture('profile.json'))
    try {
      validateResponse(CandidateProfileResponseSchema, { ...profile, topic_mastery: { [secret]: { score: 'invalid' } } }, 'GET /api/profile', 'request-test')
      throw new Error('Expected validation to fail')
    } catch (error) {
      expect<unknown>(error).toBeInstanceOf(ResponseContractError)
      expect<unknown>(JSON.stringify(error)).not.toContain(secret)
      expect<unknown>((error as ResponseContractError).issues).toEqual([{ code: 'invalid_type', path: ['topic_mastery', '*', 'score'] }])
    }
  })
})
