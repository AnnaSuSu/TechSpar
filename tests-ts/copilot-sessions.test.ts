import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CopilotSessionService, copilotTranscript, COPILOT_TRANSCRIPT_LIMIT, type CopilotSessionState, type CopilotReviewInput, type RequestContext } from '@techspar/core'
import { BunCopilotRepository } from '@techspar/db'
import { boundaryApp, jsonHeaders } from './contracts/test-app.ts'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean() })
const context: RequestContext = { requestId: 'copilot-session-test', userId: 'user-a', signal: new AbortController().signal }
const at = '2026-10-19T02:00:00.000Z'
const turn = (role: 'hr' | 'candidate', text: string) => ({ role, text, at })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'copilot-session-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'test.db')
  const repository = new BunCopilotRepository(path); repository.initialize(); cleanups.push(() => repository.close())
  await repository.createPrep({ prepId: 'prep', userId: 'user-a', company: '合成公司', position: '后端开发', jdText: '合成JD' })
  const state: CopilotSessionState = { session_id: 'live', user_id: 'user-a', prep_id: 'prep', conversation: [turn('hr', '解释事件循环'), turn('candidate', '调用栈和任务队列')], turn_count: 1, status: 'stopped', created_at: at, updated_at: at }
  await repository.saveSession(state)
  let next = 0
  const reviews = new Map<string, CopilotReviewInput>()
  const statuses = new Map<string, 'pending' | 'done' | 'error'>()
  const port = {
    async ensureSubmitted(_context: RequestContext, id: string) { return reviews.has(id) },
    async status(_context: RequestContext, id: string) { return reviews.has(id) ? statuses.get(id) ?? 'pending' : undefined },
    async analyzeConversation(_context: RequestContext, input: CopilotReviewInput) { reviews.set(input.sessionId, input); return { session_id: input.sessionId, status: 'pending' as const } },
  }
  const deps = { repository, reviews: port, ids: { next: () => `review-${++next}` }, now: () => Date.parse(at) }
  const service = new CopilotSessionService(deps)
  return { repository, state, reviews, statuses, port, deps, service, path }
}

describe('Copilot session review', () => {
  test('merges adjacent speakers and ignores whitespace without losing roles', () => {
    expect(copilotTranscript([turn('hr', ' 介绍项目 '), turn('candidate', ' '), turn('hr', '讲一个难点'), turn('candidate', '队列'), turn('candidate', '背压')]))
      .toEqual({ text: '面试官: 介绍项目 讲一个难点\n\n候选人: 队列 背压', hrBlocks: 1, candidateBlocks: 1 })
  })
  test.each([
    { name: 'no speakers', turns: [], status: 400 },
    { name: 'HR only', turns: [turn('hr', '问题')], status: 400 },
    { name: 'candidate only', turns: [turn('candidate', '回答')], status: 400 },
    { name: 'blank answer', turns: [turn('hr', '问题'), turn('candidate', '  ')], status: 400 },
    { name: 'oversized', turns: [turn('hr', '问'.repeat(COPILOT_TRANSCRIPT_LIMIT)), turn('candidate', '回答')], status: 400 },
  ])('rejects $name without creating a link', async ({ turns, status }) => {
    const f = await fixture(); await f.repository.saveSession({ ...f.state, conversation: [...turns] })
    await expect(f.service.review(context, 'live')).rejects.toMatchObject({ status })
    expect(f.reviews.size).toBe(0)
    expect((await f.repository.loadSession('live', 'user-a'))?.review_session_id).toBeNull()
  })
  test('rejects an active session and allows a stale session left by a crash', async () => {
    const f = await fixture(); await f.repository.saveSession({ ...f.state, status: 'active' })
    await expect(f.service.review(context, 'live')).rejects.toMatchObject({ status: 409 })
    await expect(f.service.delete(context, 'live')).rejects.toMatchObject({ status: 409 })
    f.deps.now = () => Date.parse(at) + 120_001
    expect(await f.service.review(context, 'live')).toMatchObject({ created: true })
  })
  test('concurrent clicks create one snapshot and preserve the link on stale realtime writes', async () => {
    const f = await fixture()
    const results = await Promise.all([f.service.review(context, 'live'), f.service.review(context, 'live')])
    expect(results.map((r) => r.created)).toEqual([true, false])
    expect(new Set(results.map((r) => r.review_session_id)).size).toBe(1)
    expect(f.reviews.size).toBe(1)
    expect(f.reviews.get('review-1')).toMatchObject({ company: '合成公司', position: '后端开发', transcript: '面试官: 解释事件循环\n\n候选人: 调用栈和任务队列', meta: { copilot_session_id: 'live', prep_id: 'prep' } })
    await f.repository.saveSession({ ...f.state, conversation: [] })
    expect(await f.service.review(context, 'live')).toMatchObject({ review_session_id: 'review-1', created: false })
  })
  test('another service cannot steal a reservation before review creation finishes', async () => {
    const f = await fixture(); const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>()
    const create = f.port.analyzeConversation
    f.port.analyzeConversation = async (ctx, input) => { entered.resolve(); await release.promise; return create(ctx, input) }
    const first = f.service.review(context, 'live'); await entered.promise
    try { await expect(new CopilotSessionService(f.deps).review(context, 'live')).rejects.toMatchObject({ status: 409 }) }
    finally { release.resolve() }
    await first
    expect(f.reviews.size).toBe(1)
  })
  test('rolls back submission failures and regenerates deleted reviews', async () => {
    const f = await fixture(); const create = f.port.analyzeConversation
    f.port.analyzeConversation = async () => { throw new Error('queue unavailable') }
    await expect(f.service.review(context, 'live')).rejects.toThrow('queue unavailable')
    expect((await f.repository.loadSession('live', 'user-a'))?.review_session_id).toBeNull()
    f.port.analyzeConversation = create
    const retry = await f.service.review(context, 'live'); f.reviews.delete(retry.review_session_id)
    expect(await f.service.review(context, 'live')).toMatchObject({ created: true, review_session_id: 'review-3' })
  })
  test('recovers an abandoned reservation and fences unrelated rollback', async () => {
    const f = await fixture()
    expect(await f.repository.linkReview('live', 'user-a', 'abandoned', null, '2020-01-01T00:00:00Z')).toBeTrue()
    expect(await f.repository.linkReview('live', 'user-b', 'foreign', 'abandoned', at)).toBeFalse()
    expect(await f.service.review(context, 'live')).toMatchObject({ created: true, review_session_id: 'review-1' })
    await f.repository.unlinkReview('live', 'user-a', 'abandoned')
    expect((await f.repository.loadSession('live', 'user-a'))?.review_session_id).toBe('review-1')
  })
  test('reports progress, the real review status and deleted reviews without querying reservations', async () => {
    const f = await fixture()
    expect(await f.service.list(context, 'prep')).toMatchObject([{ in_progress: false, review_session_id: null, review_status: null }])
    expect(await f.repository.linkReview('live', 'user-a', 'reserved', null, at)).toBeTrue()
    expect((await f.service.get(context, 'live')).review_status).toBe('pending')
    await f.repository.unlinkReview('live', 'user-a', 'reserved')
    const created = await f.service.review(context, 'live')
    expect(created).toMatchObject({ status: 'pending', created: true })
    f.statuses.set(created.review_session_id, 'done')
    expect(await f.service.review(context, 'live')).toMatchObject({ review_session_id: created.review_session_id, status: 'done', created: false })
    f.statuses.set(created.review_session_id, 'error')
    expect((await f.service.list(context, 'prep'))[0]).toMatchObject({ review_status: 'error' })
    f.reviews.delete(created.review_session_id)
    expect((await f.service.list(context, 'prep'))[0]).toMatchObject({ review_session_id: created.review_session_id, review_status: 'missing' })
    await f.repository.saveSession({ ...f.state, status: 'active' })
    expect((await f.service.list(context, 'prep'))[0]).toMatchObject({ in_progress: true, review_status: 'missing' })
  })
  test('lists by recency, isolates users and deletes only the realtime record', async () => {
    const f = await fixture()
    await f.repository.saveSession({ ...f.state, session_id: 'newer', updated_at: '2026-10-19T03:00:00Z' })
    await f.repository.saveSession({ ...f.state, session_id: 'foreign', user_id: 'user-b' })
    expect((await f.service.list(context, 'prep')).map((s) => s.session_id)).toEqual(['newer', 'live'])
    expect(await f.service.get(context, 'live')).toMatchObject({ company: '合成公司', hr_turns: 1, candidate_turns: 1 })
    for (const operation of [() => f.service.get(context, 'foreign'), () => f.service.review(context, 'foreign'), () => f.service.delete(context, 'foreign'), () => f.service.list({ ...context, userId: 'user-b' }, 'prep')]) await expect(operation()).rejects.toMatchObject({ status: 404 })
    await f.service.review(context, 'live'); await f.service.delete(context, 'live')
    expect(f.reviews.size).toBe(1)
    expect(await f.repository.getPrep('prep', 'user-a')).toBeDefined()
    expect(await f.repository.loadSession('live', 'user-a')).toBeUndefined()
  })
  test('adds missing columns on legacy SQLite tables and initializes repeatedly', async () => {
    const f = await fixture(); const sqlite = new Database(f.path)
    sqlite.exec('ALTER TABLE copilot_realtime_sessions DROP COLUMN review_session_id; ALTER TABLE copilot_realtime_sessions DROP COLUMN review_claimed_at')
    sqlite.close(); f.repository.initialize(); f.repository.initialize()
    expect(await f.service.review(context, 'live')).toMatchObject({ created: true })
  })
  test('exercises authenticated HTTP list, detail, review and delete boundaries', async () => {
    const f = await fixture(); const app = boundaryApp({ copilotSessions: f.service })
    for (const [method, path] of [['GET', '/api/copilot/prep/prep/sessions'], ['GET', '/api/copilot/sessions/live'], ['POST', '/api/copilot/sessions/live/review'], ['DELETE', '/api/copilot/sessions/live']]) {
      expect((await app.request(path!, { method })).status).toBe(401)
      const response = await app.request(path!, { method, headers: jsonHeaders })
      expect(response.status).toBe(200)
      const body = await response.json()
      if (path!.endsWith('/sessions')) expect(body).toMatchObject([{ session_id: 'live', candidate_turns: 1 }])
      else if (method === 'POST') expect(body).toMatchObject({ mode: 'copilot', created: true })
      else if (method === 'DELETE') expect(body).toEqual({ ok: true })
      else { expect(body).toMatchObject({ conversation: f.state.conversation }); expect(body.user_id).toBeUndefined(); expect(body.review_claimed_at).toBeUndefined() }
    }
    expect((await app.request('/api/copilot/sessions/live', { headers: jsonHeaders })).status).toBe(404)
  })
  test('HTTP exposes useful 400, 404 and 409 errors without leaking another user', async () => {
    const f = await fixture(); const app = boundaryApp({ copilotSessions: f.service })
    await f.repository.saveSession({ ...f.state, conversation: [] })
    expect((await app.request('/api/copilot/sessions/live/review', { method: 'POST', headers: jsonHeaders })).status).toBe(400)
    await f.repository.saveSession({ ...f.state, status: 'active' })
    expect((await app.request('/api/copilot/sessions/live/review', { method: 'POST', headers: jsonHeaders })).status).toBe(409)
    await f.repository.saveSession({ ...f.state, session_id: 'private', user_id: 'user-b' })
    for (const method of ['GET', 'DELETE', 'POST']) expect((await app.request('/api/copilot/sessions/private' + (method === 'POST' ? '/review' : ''), { method, headers: jsonHeaders })).status).toBe(404)
  })
})
