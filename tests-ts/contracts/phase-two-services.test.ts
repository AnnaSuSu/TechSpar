import { afterEach, describe, expect, test } from 'bun:test'
import { type CandidateProfile, type InterviewSession, type TaskRecord } from '@techspar/core'
import { CandidateProfileResponseSchema, InterviewResumeResponseSchema, JobPrepPreviewResponseSchema, JobPrepStartResponseSchema, TaskStatusResponseSchema } from '@techspar/contracts'
import { loadResponseFixture } from './fixture.ts'
import { caseFixture, phaseTwoCases } from './phase-two-cases.ts'
import { realServiceHarness } from './real-service-harness.ts'

const harnesses: Awaited<ReturnType<typeof realServiceHarness>>[] = []
async function setup(replies: string[] = []) { const value = await realServiceHarness(replies); harnesses.push(value); return value }
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.dispose() })
const sessionFixture = async () => await loadResponseFixture('interview-review.json') as InterviewSession
const jdText = '合成测试岗位描述，要求设计后端服务、掌握 TypeScript、异步执行、缓存和数据库，并具有清晰的技术表达能力。'

async function json(response: Response, status = 200) {
  expect<unknown>(response.status).toBe(status)
  expect<unknown>(response.headers.get('content-type')).toContain('application/json')
  return response.json()
}

describe('real services through HTTP and SQLite', () => {
  test('preserves complete sessions and the distinct history projection, scoped to the user', async () => {
    const h = await setup()
    const session = await sessionFixture()
    await h.seedSession(session)
    await h.seedSession({ ...session, session_id: 'another-users-session', user_id: 'user-b' })
    expect<unknown>(await json(await h.request('/api/interview/review/topic-session-1'))).toEqual(session)
    expect<unknown>(await json(await h.request('/api/profile/topic/typescript/history'))).toEqual([session])
    expect<unknown>(await json(await h.request('/api/interview/history'))).toEqual(await loadResponseFixture('interview-history.json'))
    expect<unknown>(await json(await h.request('/api/interview/history?offset=1'))).toEqual({ items: [], total: 1 })
    expect<unknown>(await json(await h.request('/api/interview/topics'))).toEqual(['typescript'])
    await json(await h.request('/api/interview/review/another-users-session'), 404)
    await json(await h.request('/api/interview/session/another-users-session', 'DELETE'), 404)
    expect<unknown>(await h.sessions.get('another-users-session', 'user-b')).toBeDefined()
    const resumed = await json(await h.request('/api/interview/session/topic-session-1/resume'))
    expect<unknown>(InterviewResumeResponseSchema.parse(resumed)).toEqual(resumed)
    expect<unknown>(resumed).toMatchObject({ can_continue: false, is_finished: false, has_review: true, meta: session.meta })
    expect<unknown>(await json(await h.request('/api/interview/session/topic-session-1', 'DELETE'))).toEqual({ ok: true })
    await json(await h.request('/api/interview/review/topic-session-1'), 404)
  })

  test('starts a real topic drill and generates/caches reference answers', async () => {
    const questions = Array.from({ length: 5 }, (_, index) => ({ id: index === 1 ? 'q2' : index + 1, question: '合成问题 ' + (index + 1), difficulty: 3 }))
    const h = await setup([JSON.stringify({ questions }), '合成参考回答'])
    const started = await json(await h.request('/api/interview/start', 'POST', { mode: 'topic_drill', topic: 'typescript', num_questions: 5 }))
    expect<unknown>(started).toEqual({ session_id: 'generated-session-1', mode: 'topic_drill', topic: 'typescript', questions })
    expect<unknown>((await h.sessions.get(started.session_id, 'user-a'))?.questions).toEqual(questions)
    for (const cached of [false, true]) {
      expect<unknown>(await json(await h.request('/api/interview/reference-answer', 'POST', { session_id: started.session_id, question_id: 'q2' }))).toEqual({ reference_answer: '合成参考回答', cached })
    }
    expect<unknown>(h.remaining).toEqual([])
  })

  test('validates generated JD preview and keeps supplied partial preview_data intact when starting', async () => {
    const previewEntry = phaseTwoCases.find((entry) => entry.useCase === 'previewJob')!
    const expected = JobPrepPreviewResponseSchema.parse(await caseFixture(previewEntry))
    // Imported previews still accept legacy blueprints; new model output has a defined shape.
    expected.preview.question_blueprint = [{ category: '技术', focus_area: '异步执行', intent: '验证理解', difficulty: 3 }]
    const fixture = JobPrepStartResponseSchema.parse(await loadResponseFixture('interview-start-jd.json'))
    const h = await setup([JSON.stringify(expected.preview), JSON.stringify({ questions: fixture.questions }), JSON.stringify(expected.preview), JSON.stringify({ questions: fixture.questions })])
    const preview = await json(await h.request('/api/job-prep/preview', 'POST', { jd_text: jdText, company: '示例公司', position: '后端工程师' }))
    expect<unknown>(preview).toEqual(expected)
    const supplied = { legacy_preview: true, company: '客户端公司' }
    const suppliedStart = await json(await h.request('/api/job-prep/start', 'POST', { jd_text: jdText, preview_data: supplied }))
    expect<unknown>(suppliedStart).toMatchObject({ mode: 'jd_prep', company: '客户端公司', position: 'JD 备面', preview: supplied, meta: { preview: supplied } })
    expect<unknown>(suppliedStart.preview).toEqual(supplied)
    expect<unknown>(suppliedStart.questions).toHaveLength(4)
    const generatedStart = await json(await h.request('/api/job-prep/start', 'POST', { jd_text: jdText, company: '示例公司', position: '后端工程师' }))
    expect<unknown>(generatedStart.preview).toEqual(expected.preview)
    expect<unknown>(h.remaining).toEqual([])
  })

  test('starts, chats and resumes a persisted resume interview, including its finished branch', async () => {
    const h = await setup(['请做自我介绍。', '请介绍一个项目。'])
    const started = await json(await h.request('/api/interview/start', 'POST', { mode: 'resume', target_role: '后端工程师' }))
    expect<unknown>(started).toEqual({ session_id: 'generated-session-1', mode: 'resume', target_role: '后端工程师', job_description: '', message: '请做自我介绍。' })
    expect<unknown>(started).not.toHaveProperty('topic')
    const chat = await json(await h.request('/api/interview/chat', 'POST', { session_id: started.session_id, message: '合成自我介绍' }))
    expect<unknown>(chat).toEqual({ session_id: started.session_id, message: '请介绍一个项目。', is_finished: false })
    const resumed = await json(await h.request('/api/interview/session/' + started.session_id + '/resume'))
    expect<unknown>(resumed).toMatchObject({ topic: null, can_continue: true, is_finished: false, has_review: false, target_role: '后端工程师' })
    expect<unknown>(resumed.transcript).toHaveLength(3)
    const state = await h.states.load(started.session_id, 'user-a')
    if (!state) throw new Error('Missing persisted resume state')
    state.is_finished = true
    await h.states.save(started.session_id, 'user-a', state)
    expect<unknown>(await json(await h.request('/api/interview/chat', 'POST', { session_id: started.session_id, message: '结束后再次发言' }))).toEqual({ session_id: started.session_id, message: '', is_finished: true })
    expect<unknown>(await json(await h.request('/api/interview/session/' + started.session_id + '/resume'))).toMatchObject({ can_continue: false, is_finished: true })
    await json(await h.request('/api/interview/draft/' + started.session_id, 'POST', { answers: [] }), 400)
    expect<unknown>(await json(await h.request('/api/interview/end/' + started.session_id, 'POST'))).toEqual({ session_id: started.session_id, mode: 'resume', status: 'pending' })
    expect<unknown>(h.remaining).toEqual([])
  })

  test('handles draft, end and review-generation idempotency across all stored statuses', async () => {
    const h = await setup()
    const base = await sessionFixture()
    for (const status of ['ongoing', 'ended', 'reviewing', 'reviewed', 'review_failed'] as const) {
      const id = 'session-' + status
      await h.seedSession({ ...base, session_id: id, status })
      const draft = await json(await h.request('/api/interview/draft/' + id, 'POST', { answers: [{ question_id: 1, answer: '合成草稿' }] }))
      expect<unknown>(draft).toEqual({ session_id: id, status, saved: status === 'ongoing' })
      const generated = await h.request('/api/interview/review/' + id + '/generate', 'POST')
      if (status === 'ongoing') await json(generated, 400)
      else expect<unknown>(await json(generated)).toEqual({ session_id: id, mode: 'topic_drill', status: status === 'reviewed' ? 'done' : 'pending' })
      const ended = await json(await h.request('/api/interview/end/' + id, 'POST'))
      expect<unknown>(ended).toEqual({ session_id: id, mode: 'topic_drill', status: status === 'reviewed' ? 'done' : 'pending' })
      expect<unknown>(await json(await h.request('/api/interview/end/' + id, 'POST'))).toEqual(ended)
    }
    await h.seedSession({ ...base, session_id: 'retry-profile', meta: { profile_extract_failed: true } })
    expect<unknown>(await json(await h.request('/api/interview/review/retry-profile/generate', 'POST'))).toEqual({ session_id: 'retry-profile', mode: 'topic_drill', status: 'pending' })
  })

  test('maps persisted task states and validates all completed handler payloads', async () => {
    const h = await setup()
    for (const status of ['pending', 'running', 'error'] as const) {
      const id = 'task-' + status
      await h.seedTask('drill_review', status, {}, '合成任务错误', id)
      expect<unknown>(await json(await h.request('/api/tasks/' + id))).toEqual({ status: status === 'running' ? 'pending' : status, type: 'drill_review', ...(status === 'error' ? { error: '合成任务错误' } : {}) })
    }
    const cases = [
      ...['resume_review', 'drill_review', 'jd_review', 'recording_review', 'review'].map((type) => ({ type, result: { session_id: 'session-result', status: 'done' } })),
      { type: 'copilot_prep', result: { prep_id: 'prep-1', status: 'done' } },
      { type: 'extension_task', result: { preserved_extension: true } },
    ]
    for (const { type, result } of cases) {
      await h.seedTask(type, 'done', result, '', type)
      const response = await json(await h.request('/api/tasks/' + type))
      expect<unknown>(response).toEqual({ status: 'done', type, ...result })
      expect<unknown>(TaskStatusResponseSchema.parse(response)).toEqual(response)
    }
    const base = await sessionFixture()
    for (const mode of ['resume', 'topic_drill', 'jd_prep', 'recording'] as const) {
      const id = 'reviewed-' + mode
      await h.seedSession({ ...base, session_id: id, mode })
      const response = await json(await h.request('/api/tasks/' + id))
      expect<unknown>(response).toEqual({ status: 'done', type: { resume: 'resume_review', topic_drill: 'drill_review', jd_prep: 'jd_review', recording: 'recording_review' }[mode] })
    }
    await h.seedSession({ ...base, session_id: 'failed', status: 'review_failed', review_error: null })
    expect<unknown>(await json(await h.request('/api/tasks/failed'))).toEqual({ status: 'error', type: 'drill_review', error: null })
    await h.seedSession({ ...base, session_id: 'waiting', status: 'ended' })
    expect<unknown>(await json(await h.request('/api/tasks/waiting'))).toEqual({ status: 'pending', type: 'drill_review' })
    await json(await h.request('/api/tasks/missing'), 404)
  })

  test('returns initial and rich profiles, full due items, and a distinct viewed marker', async () => {
    const h = await setup()
    expect<unknown>(await json(await h.request('/api/profile'))).toEqual(await loadResponseFixture('profile.json'))
    const fixture = await loadResponseFixture('profile-rich.json') as CandidateProfile
    await h.repository.save('user-a', fixture)
    await h.repository.save('user-b', { ...fixture, name: '其他用户' })
    const response = await json(await h.request('/api/profile'))
    expect<unknown>(CandidateProfileResponseSchema.parse(response)).toEqual(fixture)
    expect<unknown>(response).toEqual(fixture)
    expect<unknown>(await json(await h.request('/api/profile/due-reviews?topic=typescript'))).toEqual(await loadResponseFixture('due-reviews.json'))
    expect<unknown>(await json(await h.request('/api/profile/due-reviews?topic=missing'))).toEqual([])
    const marker = await json(await h.request('/api/profile/viewed', 'POST'))
    expect<unknown>(marker.at).toBe(new Date(marker.at).toISOString())
    expect<unknown>(marker).toEqual({ at: marker.at, total_sessions: 2, topic_scores: { typescript: 0, python: 60 } })
    expect<unknown>((await h.repository.load('user-a')).view_marker).toEqual(marker)
    expect<unknown>((await h.repository.load('user-b')).view_marker).toEqual(fixture.view_marker)
  })

  test('returns the whole updated pattern for all feedback verdicts', async () => {
    const h = await setup()
    const fixture = await loadResponseFixture('profile-rich.json') as CandidateProfile
    for (const verdict of ['accurate', 'inaccurate', 'acknowledged']) {
      const before = structuredClone(fixture)
      const pattern = before.weak_points.find((point) => point.source === 'consolidated')!
      pattern.confidence = 0.7; pattern.history = []; pattern.user_acknowledged = false
      await h.repository.save('user-a', before)
      const response = await json(await h.request('/api/profile/pattern/feedback', 'POST', { point: pattern.point, verdict }))
      const stored = (await h.repository.load('user-a')).weak_points.find((point) => point.point === pattern.point)
      expect<unknown>(response).toEqual(stored)
      expect<unknown>(response).toMatchObject({ point: pattern.point, user_acknowledged: true, legacy_pattern: true, consolidates: pattern.consolidates })
      expect<unknown>(response.confidence).toBe(verdict === 'accurate' ? 0.8 : verdict === 'inaccurate' ? 0.4 : 0.7)
      if (verdict === 'inaccurate') expect<unknown>(response).toMatchObject({ archived: true, archived_reason: 'user_refuted' })
    }
    await json(await h.request('/api/profile/pattern/feedback', 'POST', { point: 'missing', verdict: 'accurate' }), 404)
  })

  test('runs a retrospective producer through persistence and exposes its flat polling result', async () => {
    const h = await setup(['后端工程师', '# 合成领域回顾'])
    await h.seedSession(await sessionFixture())
    expect<unknown>(await json(await h.request('/api/profile/infer-target-role', 'POST'))).toEqual({ target_role: '后端工程师' })
    const queued = await json(await h.request('/api/profile/topic/typescript/retrospective', 'POST'))
    expect<unknown>(queued).toEqual({ task_id: 'retro_typescript_user-a', status: 'pending' })
    expect<unknown>(await json(await h.request('/api/profile/topic/typescript/retrospective', 'POST'))).toEqual(queued)
    const task = await h.tasks.claim(queued.task_id, 'user-a', { owner: 'retro-worker', durationMs: 60_000 })
    expect<unknown>(task).toBeDefined()
    const result = await h.profile.runRetrospectiveTask(task as TaskRecord)
    await h.tasks.complete(queued.task_id, 'user-a', 'retro-worker', result)
    const polled = await json(await h.request('/api/tasks/' + queued.task_id))
    expect<unknown>(polled).toEqual({ status: 'done', type: 'retrospective', ...result })
    expect<unknown>(polled).not.toHaveProperty('result')
    expect<unknown>(polled).toMatchObject({ topic: 'typescript', topic_name: 'TypeScript', retrospective: '# 合成领域回顾', session_count: 1 })
    expect<unknown>((await h.repository.load('user-a')).topic_mastery.typescript?.retrospective).toBe(result.retrospective)
    expect<unknown>(h.remaining).toEqual([])
    await json(await h.request('/api/profile/topic/missing/retrospective', 'POST'), 400)
  })
})
