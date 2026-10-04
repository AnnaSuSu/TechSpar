import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultProfile, ProfileService, type CandidateProfile, type InterviewSession, type ProfileDependencies } from '@techspar/core'
import { BunKnowledgeVectorRepository } from '@techspar/db'
import { FileCandidateProfileRepository } from '@techspar/platform'
import { boundaryApp, jsonHeaders, unavailable } from './test-app.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })
const extraction = { session_summary: '合成训练摘要', weak_points: [{ point: 'GIL 机制', topic: 'python' }], strong_points: [{ point: 'SQL 索引', topic: 'database' }], behavior_signals: [], avg_score: 7 }
const session: InterviewSession = {
  session_id: 'review-1', user_id: 'user-a', mode: 'topic_drill', topic: 'python', questions: [],
  transcript: [{ role: 'user', content: '合成回答' }], scores: [], overall: { avg_score: 7 }, review: '合成复盘',
  status: 'reviewed', meta: {}, weak_points: [], reference_answers: {}, created_at: '', updated_at: '',
}

async function fixture(output: unknown, initial = defaultProfile()) {
  const root = await mkdtemp(join(tmpdir(), 'techspar-profile-output-'))
  const repository = new FileCandidateProfileRepository(root)
  const vectors = new BunKnowledgeVectorRepository(join(root, 'profile.db')); vectors.initialize()
  await repository.save('user-a', initial)
  const saved = spyOn(repository, 'save'); const updated = spyOn(repository, 'update')
  const replaced = spyOn(vectors, 'replaceSessionMemories'); const appended = spyOn(vectors, 'appendProfileMemories')
  cleanups.push(async () => {
    saved.mockRestore(); updated.mockRestore(); replaced.mockRestore(); appended.mockRestore()
    vectors.close(); await rm(root, { recursive: true, force: true })
  })
  let llmCalls = 0; let embeddingCalls = 0
  const service = new ProfileService({
    repository, vectors,
    ai: { async complete() { llmCalls++; return JSON.stringify(output) }, async *stream() {} },
    embeddings: {
      async embed(_context, texts) { embeddingCalls++; return texts.map(text => Float32Array.from(text.startsWith('SQL') ? [0, 1] : [1, 0])) },
      async signature() { return 'synthetic' }, reset() {},
    },
    sessions: unavailable as ProfileDependencies['sessions'], tasks: unavailable as ProfileDependencies['tasks'],
    resume: unavailable as ProfileDependencies['resume'], knowledgeStore: unavailable as ProfileDependencies['knowledgeStore'],
  })
  const app = boundaryApp({ profile: service })
  return {
    service, repository, vectors, saved, updated, replaced, appended,
    calls: () => ({ llmCalls, embeddingCalls }),
    readBytes: () => readFile(join(root, 'users/user-a/profile/profile.json')),
    request: () => app.request('/api/profile', { headers: jsonHeaders }),
  }
}

async function rejectsBeforeWrites(output: unknown) {
  const f = await fixture(output)
  const before = await f.readBytes()
  await expect(f.service.afterReview({ userId: 'user-a', session })).rejects.toThrow('画像提取失败')
  expect(f.calls()).toEqual({ llmCalls: 2, embeddingCalls: 0 })
  for (const write of [f.saved, f.updated, f.replaced, f.appended]) expect(write).not.toHaveBeenCalled()
  expect(await f.readBytes()).toEqual(before)
  expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toEqual([])
  // Repeated real HTTP reads must remain healthy after rejecting the model output.
  for (let i = 0; i < 2; i++) {
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ stats: { total_sessions: 0 }, weak_points: [], strong_points: [] })
  }
}

describe('profile review regressions at file, vector and HTTP boundaries', () => {
  const validActions = [
    { action: 'ADD', description: '先给结论', snippet: '先说核心再给例子', evidence_snippet: '' },
    { action: 'NOOP', description: '', snippet: '', evidence_snippet: '' },
    { action: 'UPDATE', description: '', snippet: '新的回答证据', evidence_snippet: '' },
    { action: 'IMPROVE', description: '', snippet: '', evidence_snippet: '回答已能先给结论' },
    { action: 'NOOP' },
  ]
  for (const operation of validActions) test(`accepts ${operation.action} with inapplicable empty or omitted fields ${JSON.stringify(operation)}`, async () => {
    const initial = defaultProfile()
    const signalId = 'communication.answer_structure'
    if (operation.action !== 'ADD') initial.behavior_signals[signalId] = { namespace: 'communication', description: '表达结构', polarity: 'negative', times_seen: 1, improved: false, examples: [] }
    const beforeSignal = structuredClone(initial.behavior_signals[signalId])
    const behavior = { id: signalId, namespace: 'communication', polarity: 'negative', ...operation }
    const output = { ...extraction, behavior_signals: [behavior] }
    const f = await fixture(output, initial)
    expect(await f.service.afterReview({ userId: 'user-a', session })).toEqual(output)
    expect(f.calls().llmCalls).toBe(1)
    const stored = await f.repository.load('user-a')
    expect(stored).toMatchObject({ stats: { total_sessions: 1 }, weak_points: [{ point: 'GIL 机制' }], strong_points: [{ point: 'SQL 索引' }] })
    expect(stored._pending_memory?.[session.session_id]).toBeUndefined()
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(3)
    const response = await f.request()
    expect(response.status).toBe(200)
    const body = await response.json() as CandidateProfile
    if (operation.action === 'ADD') expect(body.behavior_signals[signalId]).toMatchObject({ description: operation.description, examples: [{ snippet: operation.snippet }] })
    if (operation.action === 'NOOP') expect(body.behavior_signals[signalId]).toEqual(beforeSignal)
    if (operation.action === 'UPDATE') expect(body.behavior_signals[signalId]).toMatchObject({ times_seen: 2, examples: [{ snippet: operation.snippet }] })
    if (operation.action === 'IMPROVE') expect(body.behavior_signals[signalId]).toMatchObject({ improved: true, history: [{ event: 'improved', evidence: operation.evidence_snippet }] })
    await f.service.afterReview({ userId: 'user-a', session })
    expect(f.calls().llmCalls).toBe(1)
    expect((await f.repository.load('user-a')).stats.total_sessions).toBe(1)
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(3)
  })

  const invalidActions = [
    { action: 'ADD', description: '描述', snippet: '证据', evidence_snippet: {} },
    { action: 'ADD', description: '', snippet: '证据' },
    { action: 'ADD', description: '描述', snippet: ' ' },
    { action: 'ADD', snippet: '证据' },
    { action: 'UPDATE', snippet: '', description: '' },
    { action: 'IMPROVE', evidence_snippet: '' },
    { action: 'IMPROVE', snippet: '不能替代改善证据' },
    { action: 'NOOP', description: [] }, { action: 'NOOP', snippet: 3 }, { action: 'NOOP', evidence_snippet: null },
  ]
  for (const operation of invalidActions) test(`rejects invalid action content ${JSON.stringify(operation)}`, async () => {
    await rejectsBeforeWrites({ ...extraction, behavior_signals: [{ id: 'communication.answer_structure', namespace: 'communication', ...operation }] })
  })

  // These cases are independent of the core validator and mirror the known
  // persisted observation fields, including fields previously hidden by spreads.
  const invalidObservations = [
    { first_seen: 42 }, { last_seen: [] }, { times_seen: 'two' }, { times_seen: null },
    { improved: 'false' }, { improved_at: {} }, { archived: 'false' }, { archived_at: 42 },
    { archived_reason: [] }, { source: 42 }, { axis: {} },
    { history: {} }, { history: [null] }, { history: [{ date: 42 }] },
    { history: [{ event: false }] }, { history: [{ evidence: [] }] }, { history: [{ score: '7' }] },
  ]
  for (const field of ['weak_points', 'strong_points'] as const) for (const patch of invalidObservations) {
    test(`rejects known ${field} fields before writes: ${JSON.stringify(patch)}`, async () => {
      await rejectsBeforeWrites({ ...extraction, [field]: [{ point: 'GIL 机制', topic: 'python', ...patch }] })
    })
  }
  for (const patch of [
    { sr: [] }, { sr: { interval_days: '1' } }, { sr: { ease_factor: null } }, { sr: { repetitions: {} } },
    { sr: { next_review: 42 } }, { sr: { last_score: '7' } },
    { consolidates: {} }, { consolidates: [42] }, { user_acknowledged: 'false' },
  ]) test(`rejects known weak point details before writes: ${JSON.stringify(patch)}`, async () => {
    await rejectsBeforeWrites({ ...extraction, weak_points: [{ point: 'GIL 机制', topic: 'python', ...patch }] })
  })

  test('preserves valid optional fields, false/zero/empty values and unknown extensions through HTTP', async () => {
    const observation = {
      first_seen: '', last_seen: '', times_seen: 0, improved: false, improved_at: '', archived: false,
      archived_at: '', archived_reason: '', source: '', axis: '', confidence: 0,
      history: [{ date: '', event: '', evidence: '', score: 0, provider_event: { kept: true } }],
      provider_observation: { kept: true },
    }
    const output = { ...extraction,
      weak_points: [{ ...extraction.weak_points[0], ...observation, sr: { interval_days: 0, ease_factor: 1.3, repetitions: 0, next_review: '', last_score: 0 }, consolidates: [''], user_acknowledged: false }],
      strong_points: [{ ...extraction.strong_points[0], ...observation }],
    }
    const f = await fixture(output)
    await f.service.afterReview({ userId: 'user-a', session })
    const response = await f.request()
    expect(response.status).toBe(200)
    const body = await response.json() as CandidateProfile
    expect(body.strong_points[0]).toMatchObject({ ...observation, first_seen: expect.any(String) })
    expect(body.weak_points[0]).toMatchObject({ archived: false, archived_at: '', confidence: 0, consolidates: [''], user_acknowledged: false, provider_observation: { kept: true } })
    expect(body.session_extractions).toMatchObject({ [session.session_id]: output })
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(3)
  })
})
