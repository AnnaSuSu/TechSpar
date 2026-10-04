import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProfileService, InterviewService, RecordingService, defaultProfile, mergeProfiles, type CandidateProfileRepository, type InterviewSession, type InterviewDependencies, type ProfileDependencies, type ProfileMemoryEntry, type TaskRecord } from '@techspar/core'
import { BunKnowledgeVectorRepository, BunInterviewSessionRepository } from '@techspar/db'
import { FileCandidateProfileRepository } from '@techspar/platform'
import { boundaryApp, jsonHeaders, unavailable } from './contracts/test-app.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

const extraction = { session_summary: 'GIL needs practice', weak_points: [{ point: 'GIL', topic: 'python', score: 7 }], strong_points: [], behavior_signals: [], avg_score: 7 }
function session(sessionId = 'session-1'): InterviewSession {
  return { session_id: sessionId, user_id: 'user-a', mode: 'topic_drill', topic: 'python', questions: [{ id: 1, question: 'GIL?', focus_area: 'GIL', difficulty: 3 }], transcript: [{ role: 'user', content: 'Partial answer' }], scores: [{ question_id: 1, score: 7 }], overall: { avg_score: 7 }, review: 'Saved review', status: 'reviewed', meta: {}, weak_points: [], reference_answers: {}, review_error: null, created_at: '', updated_at: '' }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'techspar-memory-retry-'))
  const path = join(root, 'test.db')
  const repository = new FileCandidateProfileRepository(root)
  const vectors = new BunKnowledgeVectorRepository(path); vectors.initialize()
  cleanups.push(async () => { vectors.close(); await rm(root, { recursive: true, force: true }) })
  let llmCalls = 0
  let failure: 'none' | 'embedding' | 'storage' | 'partial' | 'nan' | 'dimension' = 'none'
  const deps: ProfileDependencies = {
    repository, vectors: {
      appendProfileMemories: vectors.appendProfileMemories.bind(vectors),
      listProfileMemories: vectors.listProfileMemories.bind(vectors),
      async replaceSessionMemories(input) {
        if (failure === 'storage') throw new Error('synthetic storage outage')
        await vectors.replaceSessionMemories(input)
      },
    },
    ai: { async complete() { llmCalls++; return JSON.stringify(extraction) }, async *stream() {} },
    embeddings: {
      async embed(context, texts) {
        if (context.requestId.includes('memory-write')) {
          if (failure === 'embedding') throw new Error('synthetic embedding outage')
          if (failure === 'partial') return [Float32Array.from([1, 0])]
          if (failure === 'nan') return texts.map(() => Float32Array.from([NaN, 0]))
          if (failure === 'dimension') return texts.map((_, index) => Float32Array.from(index ? [1] : [1, 0]))
        }
        return texts.map(() => Float32Array.from([1, 0]))
      }, async signature() { return 'synthetic' }, reset() {},
    },
    // These ports are deliberately unavailable: projection retries must not use them.
    sessions: {} as ProfileDependencies['sessions'], tasks: {} as ProfileDependencies['tasks'],
    resume: {} as ProfileDependencies['resume'], knowledgeStore: {} as ProfileDependencies['knowledgeStore'],
  }
  return { root, path, repository, vectors, deps, service: new ProfileService(deps), calls: () => llmCalls, fail: (value: typeof failure) => { failure = value } }
}

describe('retryable profile memory projection', () => {
  for (const patch of [
    { avg_score: 11 }, { dimension_scores: { technical_depth: '8' } },
    { weak_points: [{ point: '知识点', confidence: 2 }] },
    { topic_mastery: { python: { score: 101 } } },
    { behavior_signals: [{ action: 'DELETE', id: 'reasoning.example' }] },
    { behavior_signals: [{ action: 'ADD', id: 'invalid.example' }] },
    { behavior_signals: [{ action: 'ADD', id: 'reasoning.example', namespace: 'narrative' }] },
    { behavior_signals: [{ action: 'NOOP', id: 'reasoning.example', polarity: 'neutral' }] },
    { behavior_signals: [{ action: 'NOOP', id: 'reasoning.example' }, { action: 'NOOP', id: 'reasoning.example' }] },
  ]) test(`rejects malformed extraction without profile or memory effects: ${JSON.stringify(patch)}`, async () => {
    const f = await fixture()
    const before = await f.repository.load('user-a')
    let calls = 0; let embeddings = 0
    f.deps.ai.complete = async () => { calls++; return JSON.stringify({ ...extraction, ...patch }) }
    f.deps.embeddings.embed = async () => { embeddings++; throw new Error('must not embed malformed extraction') }
    await expect(f.service.afterReview({ userId: 'user-a', session: session() })).rejects.toThrow('画像提取失败')
    expect(await f.repository.load('user-a')).toEqual(before)
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toEqual([])
    expect(calls).toBe(2)
    expect(embeddings).toBe(0)
  })

  test('retries a malformed extraction then writes valid profile and memory exactly once', async () => {
    const f = await fixture()
    let calls = 0
    f.deps.ai.complete = async () => JSON.stringify(++calls === 1 ? { ...extraction, avg_score: '7' } : extraction)
    await f.service.afterReview({ userId: 'user-a', session: session() })
    expect(calls).toBe(2)
    expect((await f.repository.load('user-a')).stats.total_sessions).toBe(1)
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(3)
  })

  for (const failure of ['embedding', 'storage', 'partial', 'nan', 'dimension'] as const) {
    test(`recovers from ${failure} failure without applying the profile twice`, async () => {
      const f = await fixture(); f.fail(failure)
      const input = { userId: 'user-a', session: session() }
      await expect(f.service.afterReview(input)).rejects.toThrow()
      const before = await f.repository.load('user-a')
      expect(before.stats.total_sessions).toBe(1)
      expect(before._pending_memory?.['session-1']).toBeDefined()
      expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(0)
      f.fail('none')
      // Reload the saved file through a fresh repository and service.
      const restarted = new ProfileService({ ...f.deps, repository: new FileCandidateProfileRepository(f.root) })
      expect(await restarted.afterReview(input)).toEqual(extraction)
      const after = await f.repository.load('user-a')
      expect(after.stats).toEqual(before.stats)
      expect(after.topic_mastery).toEqual(before.topic_mastery)
      expect(after.weak_points).toEqual(before.weak_points)
      expect(after._pending_memory?.['session-1']).toBeUndefined()
      const rows = await f.vectors.listProfileMemories({ userId: 'user-a' })
      expect(rows).toHaveLength(3)
      expect(rows.every(row => row.createdAt === before._pending_memory!['session-1']!.createdAt)).toBeTrue()
      await restarted.afterReview(input)
      expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(3)
      expect(f.calls()).toBe(1)
    })
  }

  test('replays safely if vectors commit but clearing the pending marker fails', async () => {
    const f = await fixture()
    const repository: CandidateProfileRepository = {
      load: f.repository.load.bind(f.repository), save: f.repository.save.bind(f.repository),
      async update(userId, mutate) {
        return f.repository.update(userId, async profile => {
          const wasPending = Boolean(profile._pending_memory?.['session-1'])
          const result = await mutate(profile)
          if (wasPending && !profile._pending_memory?.['session-1']) throw new Error('synthetic acknowledgement failure')
          return result
        })
      },
    }
    await expect(new ProfileService({ ...f.deps, repository }).afterReview({ userId: 'user-a', session: session() })).rejects.toThrow('acknowledgement')
    const first = await f.vectors.listProfileMemories({ userId: 'user-a' })
    expect(first).toHaveLength(3)
    await f.service.afterReview({ userId: 'user-a', session: session() })
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toEqual(first)
    expect((await f.repository.load('user-a')).stats.total_sessions).toBe(1)
    expect(f.calls()).toBe(1)
  })

  test('pins failed extractions beyond the normal cache limit and hides pending data from the profile response', async () => {
    const f = await fixture(); f.fail('storage')
    await expect(f.service.afterReview({ userId: 'user-a', session: session() })).rejects.toThrow()
    await f.repository.update('user-a', profile => {
      const cache = profile.session_extractions as Record<string, unknown>
      for (let index = 0; index < 110; index++) cache[`old-${index}`] = { session_summary: 'old' }
    })
    f.fail('none')
    await f.service.afterReview({ userId: 'user-a', session: session('new-session') })
    const before = await f.repository.load('user-a')
    expect((before.session_extractions as Record<string, unknown>)['session-1']).toEqual(extraction)
    expect(Object.keys(before.session_extractions as object).length).toBeLessThanOrEqual(101)
    const publicProfile = await f.service.get({ userId: 'user-a', requestId: 'get', signal: new AbortController().signal })
    expect(publicProfile).not.toHaveProperty('_pending_memory')
    await f.service.afterReview({ userId: 'user-a', session: session() })
    expect((await f.repository.load('user-a')).stats).toEqual(before.stats)
    await f.service.afterReview({ userId: 'user-a', session: session() })
    expect((await f.repository.load('user-a')).stats).toEqual(before.stats)
    expect(f.calls()).toBe(2)
  })

  test('keeps pending snapshots intact when merging portable profiles', async () => {
    const f = await fixture(); f.fail('storage')
    await expect(f.service.afterReview({ userId: 'user-a', session: session() })).rejects.toThrow()
    const pending = await f.repository.load('user-a')
    const imported = mergeProfiles(defaultProfile(), pending)
    expect(imported._pending_memory).toEqual(pending._pending_memory)
    const conflicting = structuredClone(pending)
    conflicting._pending_memory!['session-1']!.entries[0]!.content = 'conflicting archive'
    ;(conflicting.session_extractions as Record<string, unknown>)['session-1'] = { session_summary: 'conflicting' }
    const merged = mergeProfiles(pending, conflicting)
    expect(merged._pending_memory).toEqual(pending._pending_memory)
    expect((merged.session_extractions as Record<string, unknown>)['session-1']).toEqual(extraction)
    const completed = structuredClone(pending); delete completed._pending_memory
    expect(mergeProfiles(completed, conflicting)._pending_memory).toBeUndefined()
  })

  test('rejects an extraction missing required arrays without changing the profile', async () => {
    const f = await fixture()
    f.deps.ai.complete = async () => JSON.stringify({ avg_score: 7 })
    f.deps.embeddings.embed = async () => { throw new Error('unconfigured') }
    await expect(f.service.afterReview({ userId: 'user-a', session: session() })).rejects.toThrow('画像提取失败')
    expect((await f.repository.load('user-a')).stats.total_sessions).toBe(0)
    expect((await f.repository.load('user-a'))._pending_memory).toBeUndefined()
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(0)
  })

  test('does not apply an invalid extraction after either retry', async () => {
    const f = await fixture(); f.fail('storage')
    let calls = 0
    f.deps.ai.complete = async () => { calls++; return '{}' }
    const input = { userId: 'user-a', session: session() }
    await expect(f.service.afterReview(input)).rejects.toThrow()
    expect((await f.repository.load('user-a')).stats.total_sessions).toBe(0)
    expect((await f.repository.load('user-a'))._pending_memory).toBeUndefined()
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(0)
    expect(calls).toBe(2)
  })

  for (const mode of ['topic_drill', 'jd_prep', 'resume', 'recording'] as const) {
    test(`${mode}: HTTP retry preserves the saved review and completes only the failed profile work`, async () => {
      const f = await fixture()
      const sessions = new BunInterviewSessionRepository(f.path); sessions.initialize()
      cleanups.push(async () => sessions.close())
      const saved = { ...session(), mode }
      await sessions.create({ sessionId: saved.session_id, userId: saved.user_id, mode, topic: saved.topic!, questions: saved.questions })
      await sessions.saveReview({ sessionId: saved.session_id, userId: saved.user_id, review: saved.review!, scores: saved.scores, overall: saved.overall })
      const queued: TaskRecord[] = []
      const tasks: InterviewDependencies['tasks'] = {
        async enqueue(input) { const task: TaskRecord = { task_id: input.taskId, user_id: input.userId, type: input.type, payload: input.payload, status: 'pending', result: null, error: null, attempts: 0, created_at: '', updated_at: '' }; queued.push(task); return task },
        async get() { return undefined },
      }
      let reviewCalls = 0
      const ai: InterviewDependencies['ai'] = { async complete() { reviewCalls++; throw new Error('Must not regenerate saved review') }, async *stream() {} }
      const interview = new InterviewService({
        sessions, tasks, ai, profile: f.service,
        states: unavailable as InterviewDependencies['states'], ids: { next: () => 'unused' },
        resume: unavailable as InterviewDependencies['resume'], knowledge: unavailable as InterviewDependencies['knowledge'],
        knowledgeStore: unavailable as InterviewDependencies['knowledgeStore'], settings: unavailable as InterviewDependencies['settings'],
      })
      const recording = new RecordingService({ sessions, tasks, ai, profile: f.service, ids: { next: () => 'unused' }, transcription: { async transcribe() { throw new Error('Must not transcribe') } } })
      const run = (task: TaskRecord) => mode === 'recording' ? recording.runAnalysisTask(task) : interview.runReviewTask(task)
      // First post-review attempt fails. The actual handler must expose the existing retry flag.
      f.fail('storage')
      await run({ task_id: saved.session_id, user_id: saved.user_id, type: `${mode}_review`, payload: { profile_only: true }, status: 'running', result: null, error: null, attempts: 1, created_at: '', updated_at: '' })
      expect((await sessions.get(saved.session_id, saved.user_id))?.meta.profile_extract_failed).toBeTrue()
      const before = await f.repository.load(saved.user_id)
      const app = boundaryApp({ interview, profile: f.service })
      const url = `/api/interview/review/${saved.session_id}/generate`
      expect((await app.request(url, { method: 'POST' })).status).toBe(401)
      f.fail('none')
      const response = await app.request(url, { method: 'POST', headers: jsonHeaders })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'pending' })
      expect(queued).toHaveLength(1)
      expect(queued[0]!.payload.profile_only).toBeTrue()
      await run(queued[0]!)
      const after = await sessions.get(saved.session_id, saved.user_id)
      expect(after).toMatchObject({ status: 'reviewed', review: saved.review, scores: saved.scores, meta: { profile_extract_failed: false } })
      expect((await f.repository.load(saved.user_id)).stats).toEqual(before.stats)
      expect(await f.vectors.listProfileMemories({ userId: saved.user_id })).toHaveLength(3)
      expect(f.calls()).toBe(1)
      expect(reviewCalls).toBe(0)
      const duplicate = await app.request(url, { method: 'POST', headers: jsonHeaders })
      expect(await duplicate.json()).toMatchObject({ status: 'done' })
      expect(queued).toHaveLength(1)
    })
  }

  test('concurrent processing applies a session only once', async () => {
    const f = await fixture()
    await Promise.all([f.service.afterReview({ userId: 'user-a', session: session() }), f.service.afterReview({ userId: 'user-a', session: session() })])
    expect((await f.repository.load('user-a')).stats.total_sessions).toBe(1)
    expect((await f.repository.load('user-a')).weak_points[0]?.sr?.repetitions).toBe(1)
    expect(await f.vectors.listProfileMemories({ userId: 'user-a' })).toHaveLength(3)
  })

  test('replaces only the intended session and rolls back the whole replacement on an insert failure', async () => {
    const f = await fixture()
    const entry: ProfileMemoryEntry = { chunkType: 'insight', content: 'old', sessionId: 'session-1', embedding: Float32Array.from([1, 0]), createdAt: '2026-01-01T00:00:00Z' }
    await f.vectors.appendProfileMemories({ userId: 'user-a', entries: [entry, { ...entry, sessionId: 'other' }] })
    await f.vectors.appendProfileMemories({ userId: 'user-b', entries: [entry] })
    await f.vectors.replaceChunks({ userId: 'user-a', chunkType: 'personal_document_chunk', chunks: [{ content: 'document', source: 'doc', embedding: entry.embedding }] })
    const db = new Database(f.path)
    try {
      db.exec("CREATE TRIGGER fail_memory_insert BEFORE INSERT ON memory_vectors WHEN NEW.content = 'fail' BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END")
      await expect(f.vectors.replaceSessionMemories({ userId: 'user-a', sessionId: 'session-1', entries: [{ ...entry, content: 'new' }, { ...entry, content: 'fail' }] })).rejects.toThrow()
      expect((await f.vectors.listProfileMemories({ userId: 'user-a' })).map(row => row.content)).toEqual(['old', 'old'])
      await f.vectors.replaceSessionMemories({ userId: 'user-a', sessionId: 'session-1', entries: [{ ...entry, content: 'new' }] })
      expect((await f.vectors.listProfileMemories({ userId: 'user-a' })).map(row => row.content).sort()).toEqual(['new', 'old'])
      expect((await f.vectors.listProfileMemories({ userId: 'user-b' }))[0]?.content).toBe('old')
      expect(await f.vectors.listChunks('user-a', 'personal_document_chunk')).toHaveLength(1)
    } finally { db.close() }
  })
})
