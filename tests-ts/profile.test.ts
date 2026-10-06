import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ProfileService,
  defaultProfile,
  sm2Update,
  type CandidateProfile,
  type ChatMessage,
  type InterviewSession,
  type ProfileDependencies,
  type RequestContext,
  type TextGenerationUseCases,
} from '@techspar/core'
import { BunInterviewSessionRepository, BunKnowledgeVectorRepository } from '@techspar/db'
import { FileCandidateProfileRepository } from '@techspar/platform'

const directories: string[] = []
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'techspar-profile-')); directories.push(path); return path }
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })

const context: RequestContext = { requestId: 'test', userId: 'user-a', signal: new AbortController().signal }

class ReplyAi implements TextGenerationUseCases {
  constructor(private readonly replies: string[]) {}
  async complete(_context: RequestContext, _messages: readonly ChatMessage[]): Promise<string> {
    const reply = this.replies.shift(); if (reply === undefined) throw new Error('Unexpected LLM call'); return reply
  }
  async *stream(): AsyncIterable<string> {}
}

function embedding(text: string): Float32Array {
  if (/GIL|全局解释器锁|记忆检索|python 面试/.test(text)) return Float32Array.from([1, 0, 0, 0, 0, 0])
  if (/事务/.test(text)) return Float32Array.from([0, 1, 0, 0, 0, 0])
  if (/索引/.test(text)) return Float32Array.from([0, 0, 1, 0, 0, 0])
  if (/缓存/.test(text)) return Float32Array.from([0, 0, 0, 1, 0, 0])
  if (/网络/.test(text)) return Float32Array.from([0, 0, 0, 0, 1, 0])
  return Float32Array.from([0, 0, 0, 0, 0, 1])
}

async function fixture(replies: string[]) {
  const root = await directory()
  const path = join(root, 'techspar.db')
  const repository = new FileCandidateProfileRepository(root)
  const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
  const vectors = new BunKnowledgeVectorRepository(path); vectors.initialize()
  const ai = new ReplyAi(replies)
  const embeddingInputs: string[][] = []
  const embeddings = { async embed(_context: RequestContext, texts: readonly string[]) { embeddingInputs.push([...texts]); return texts.map(embedding) }, async signature() { return 'test' }, reset() {} }
  const tasks: ProfileDependencies['tasks'] = {
    async enqueue(input) { return { task_id: input.taskId, user_id: input.userId, type: input.type, status: 'pending', payload: input.payload, result: null, error: null, attempts: 0, created_at: '', updated_at: '' } },
    async get() { return undefined },
  }
  const resume: ProfileDependencies['resume'] = { async status() { return { has_resume: false } }, async file() { throw new Error() }, async upload() { throw new Error() }, async delete() { throw new Error() }, async text() { return '' }, async parse() { throw new Error() }, async transcribe() { throw new Error() } }
  const knowledgeStore: ProfileDependencies['knowledgeStore'] = { async loadTopics() { return {} }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {} }
  const service = new ProfileService({ repository, sessions, tasks, ai, embeddings, vectors, resume, knowledgeStore })
  return { service, repository, sessions, vectors, embeddings, embeddingInputs }
}

function reviewedSession(input: Partial<InterviewSession> = {}): InterviewSession {
  return {
    session_id: 'session-1', mode: 'topic_drill', topic: 'python', meta: {}, questions: [{ id: 1, question: '解释 GIL', focus_area: 'GIL 核心机制', difficulty: 4 }],
    transcript: [{ role: 'assistant', content: '解释 GIL' }, { role: 'user', content: '暂时说不清' }], scores: [{ question_id: 1, score: 3, difficulty: 4, weak_point: '全局解释器锁原理不清' }],
    weak_points: [], overall: { avg_score: 3 }, reference_answers: {}, review: '需要理解原理', status: 'reviewed', review_error: null, user_id: 'user-a', created_at: '', updated_at: '',
    ...input,
  }
}

describe('profile persistence', () => {
  test('atomically replaces profile.json with compatible defaults', async () => {
    const root = await directory()
    const repository = new FileCandidateProfileRepository(root)
    const profile = defaultProfile(); profile.name = 'A'; profile.topic_mastery.python = { score: 72 }
    await repository.save('user-a', profile)
    expect(await repository.load('user-a')).toMatchObject({ name: 'A', topic_mastery: { python: { score: 72 } } })
    expect(JSON.parse(await readFile(join(root, 'users/user-a/profile/profile.json'), 'utf8'))).toMatchObject({ name: 'A' })
  })

  test('keeps the existing file and cleans temporary files on serialization failure', async () => {
    const root = await directory()
    const repository = new FileCandidateProfileRepository(root)
    const profile = defaultProfile(); profile.name = 'before'; await repository.save('user-a', profile)
    const invalid = { ...profile, invalid: 1n } as unknown as CandidateProfile
    await expect(repository.save('user-a', invalid)).rejects.toThrow()
    expect((await repository.load('user-a')).name).toBe('before')
    expect((await readdir(join(root, 'users/user-a/profile'))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('serializes concurrent read-modify-write updates per user', async () => {
    const root = await directory()
    const repository = new FileCandidateProfileRepository(root)
    await Promise.all(Array.from({ length: 20 }, () => repository.update('user-a', async (profile) => {
      const value = profile.stats.total_sessions
      await new Promise((resolve) => setTimeout(resolve, 1))
      profile.stats.total_sessions = value + 1
    })))
    expect((await repository.load('user-a')).stats.total_sessions).toBe(20)
  })
})

describe('spaced repetition', () => {
  test('keeps the Python SM-2 thresholds and intervals', () => {
    const today = new Date('2026-08-19T00:00:00Z')
    const first = sm2Update({}, 7, today)
    const second = sm2Update(first, 8, today)
    const failed = sm2Update(second, 4, today)
    expect(first).toMatchObject({ interval_days: 1, repetitions: 1, next_review: '2026-08-20' })
    expect(second).toMatchObject({ interval_days: 3, repetitions: 2, next_review: '2026-08-22' })
    expect(failed).toMatchObject({ interval_days: 1, repetitions: 0 })
  })
})

describe('long-term profile loop', () => {
  for (const pattern of [
    { supporting_wp_indices: [0, 9] }, { supporting_wp_indices: [0, 0] },
    { supporting_wp_indices: [0, 1] }, { supporting_wp_indices: [0, 2.5] },
    { supporting_wp_indices: [0, 2], confidence: 2 },
  ]) test(`invalid consolidation does not archive observations: ${JSON.stringify(pattern)}`, async () => {
    const extraction = { session_summary: '本次复盘', weak_points: [], strong_points: [], behavior_signals: [], avg_score: 7 }
    const { service, repository, sessions, vectors } = await fixture([JSON.stringify(extraction), JSON.stringify({ patterns: [
      { statement: '这一批的有效规律也不能部分提交', supporting_wp_indices: [0, 2], confidence: 0.8 },
      { statement: '非法规律', ...pattern },
    ] })])
    const initial = defaultProfile()
    initial.weak_points = ['事务机制', '索引机制', '缓存机制', '网络机制', 'GIL 机制'].map((point, index) => ({ point, topic: index < 2 ? 'database' : 'distributed', source: 'observed', improved: false }))
    await repository.save('user-a', initial)
    try {
      await service.afterReview({ userId: 'user-a', session: reviewedSession() })
      const stored = await repository.load('user-a')
      expect(stored.weak_points.some(point => point.source === 'consolidated' || point.archived_reason === 'superseded_by_consolidation')).toBeFalse()
      expect(stored.last_consolidation_at).toBe(initial.last_consolidation_at)
      expect((await vectors.listProfileMemories({ userId: 'user-a' })).some(row => row.content === '非法规律')).toBeFalse()
      expect(stored.stats.total_sessions).toBe(1)
    } finally { sessions.close(); vectors.close() }
  })

  test('uses actual scores for semantic weak-point review and preserves improve/regress evidence', async () => {
    const improvedExtraction = JSON.stringify({
      session_summary: 'GIL 回答已经较清晰', weak_points: [], strong_points: [{ point: 'GIL 机制讲解清晰', topic: 'python' }],
      behavior_signals: [
        { action: 'IMPROVE', id: 'reasoning.jump_to_conclusion', evidence_snippet: '会先说推导再下结论' },
        { action: 'ADD', id: 'communication.overlong_answer', namespace: 'communication', polarity: 'negative', description: '回答偏长', snippet: '结论后又重复了两次' },
      ], topic_mastery: { notes: '掌握较好' }, avg_score: 9,
    })
    const regressedExtraction = JSON.stringify({
      session_summary: 'GIL 底层原理仍有空白', weak_points: [{ point: '全局解释器锁原理不清', topic: 'python' }], strong_points: [],
      behavior_signals: [{ action: 'UPDATE', id: 'reasoning.jump_to_conclusion', snippet: '直接说会阻塞，没有解释原因' }], topic_mastery: { notes: '需要补底层机制' }, avg_score: 3,
    })
    const { service, repository, sessions, vectors } = await fixture([improvedExtraction, regressedExtraction])
    const initial = defaultProfile()
    initial.weak_points.push({ point: 'GIL 机制理解不清', topic: 'python', source: 'observed', first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-01-01T00:00:00Z', times_seen: 1, improved: false, sr: {} })
    initial.behavior_signals['reasoning.jump_to_conclusion'] = { namespace: 'reasoning', polarity: 'negative', description: '容易跳过推导', first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-01-01T00:00:00Z', times_seen: 1, improved: false, examples: [] }
    await repository.save('user-a', initial)

    await service.afterReview({ userId: 'user-a', session: reviewedSession({ session_id: 'high-score', scores: [{ question_id: 1, score: 9, difficulty: 4 }], overall: { avg_score: 9 }, transcript: [{ role: 'assistant', content: '解释 GIL' }, { role: 'user', content: '它保护解释器内部状态，也会影响 CPU 密集线程' }] }) })
    let profile = await repository.load('user-a')
    expect(profile.weak_points[0]).toMatchObject({ improved: true, sr: { last_score: 9, repetitions: 1 } })
    expect((profile.weak_points[0]!.history as Array<Record<string, unknown>>).map((item) => item.event)).toContain('improved')
    expect(profile.behavior_signals['reasoning.jump_to_conclusion']).toMatchObject({ improved: true })
    expect(profile.behavior_signals['communication.overlong_answer']).toMatchObject({ namespace: 'communication', description: '回答偏长', times_seen: 1, examples: [{ session_id: 'high-score', snippet: '结论后又重复了两次' }] })

    const duplicate = await service.afterReview({ userId: 'user-a', session: reviewedSession({ session_id: 'high-score', scores: [{ question_id: 1, score: 9, difficulty: 4 }], overall: { avg_score: 9 } }) })
    expect(duplicate).toMatchObject({ avg_score: 9 })
    expect((await repository.load('user-a')).stats.total_sessions).toBe(1)

    await service.afterReview({ userId: 'user-a', session: reviewedSession({ session_id: 'low-score' }) })
    profile = await repository.load('user-a')
    expect(profile.weak_points.filter((point) => point.source !== 'consolidated')).toHaveLength(1)
    expect(profile.weak_points[0]).toMatchObject({ point: 'GIL 机制理解不清', improved: false, times_seen: 2, sr: { last_score: 3, repetitions: 0, interval_days: 1 } })
    expect((profile.weak_points[0]!.history as Array<Record<string, unknown>>).map((item) => item.event)).toEqual(expect.arrayContaining(['reviewed', 'improved', 'regressed']))
    expect(profile.behavior_signals['reasoning.jump_to_conclusion']).toMatchObject({ improved: false, times_seen: 2, examples: [{ snippet: '直接说会阻塞，没有解释原因' }] })
    expect((profile.behavior_signals['reasoning.jump_to_conclusion']!.history as Array<Record<string, unknown>>).map((item) => item.event)).toEqual(['improved', 'regressed'])
    expect(profile.topic_mastery.python).toMatchObject({ score: 60, session_count: 2, notes: '需要补底层机制' })
    expect(profile.stats).toMatchObject({ total_sessions: 2, total_answers: 2, drill_sessions: 2, drill_avg_score: 6, avg_score: 6 })
    const memories = await vectors.listProfileMemories({ userId: 'user-a' })
    expect(memories.map((item) => item.chunkType)).toEqual(expect.arrayContaining(['session_summary', 'insight', 'weak_point']))
    sessions.close(); vectors.close()
  })

  test('creates a validated cross-topic consolidated pattern that accepts feedback', async () => {
    const extraction = JSON.stringify({ session_summary: '本次暴露 GIL 底层机制薄弱', weak_points: [{ point: 'GIL 底层机制说不清', topic: 'python' }], strong_points: [], behavior_signals: [], topic_mastery: { notes: '需要补强' }, avg_score: 3 })
    const consolidation = JSON.stringify({ patterns: [{ statement: '跨领域机制解释停留在表面', supporting_wp_indices: [0, 2, 4], topic: 'cross_cutting', confidence: 0.8 }] })
    const { service, repository, sessions, vectors } = await fixture([extraction, consolidation])
    const initial = defaultProfile()
    initial.weak_points.push(
      { point: '事务边界解释不清', topic: 'database', source: 'observed', times_seen: 2, improved: false },
      { point: '索引选择依据不清', topic: 'database', source: 'observed', times_seen: 1, improved: false },
      { point: '缓存一致性机制不清', topic: 'distributed', source: 'observed', times_seen: 2, improved: false },
      { point: '网络重试边界不清', topic: 'distributed', source: 'observed', times_seen: 1, improved: false },
    )
    await repository.save('user-a', initial)
    await service.afterReview({ userId: 'user-a', session: reviewedSession({ session_id: 'consolidate' }) })

    let profile = await repository.load('user-a')
    expect(profile.weak_points.find((point) => point.source === 'consolidated')).toMatchObject({ point: '跨领域机制解释停留在表面', confidence: 0.8, user_acknowledged: false, consolidates: ['事务边界解释不清', '缓存一致性机制不清', 'GIL 底层机制说不清'] })
    expect(profile.weak_points.filter((point) => point.archived_reason === 'superseded_by_consolidation')).toHaveLength(3)
    await service.feedback(context, '跨领域机制解释停留在表面', 'accurate')
    profile = await repository.load('user-a')
    expect(profile.weak_points.find((point) => point.source === 'consolidated')).toMatchObject({ confidence: 0.9, user_acknowledged: true })
    expect((await vectors.listProfileMemories({ userId: 'user-a', chunkTypes: ['weak_point'] })).some((item) => item.content === '跨领域机制解释停留在表面')).toBeTrue()
    sessions.close(); vectors.close()
  })

  test('ranks semantic session memory with time decay and includes due review context', async () => {
    const { service, repository, sessions, vectors } = await fixture([])
    const profile = defaultProfile()
    profile.weak_points.push({ point: 'GIL 机制需要复习', topic: 'python', source: 'observed', improved: false, sr: { next_review: '2020-01-01', ease_factor: 1.8 } })
    await repository.save('user-a', profile)
    const recent = new Date().toISOString()
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString()
    await vectors.appendProfileMemories({ userId: 'user-a', entries: [
      { chunkType: 'session_summary', content: '近期洞察', topic: 'python', sessionId: 'recent', metadata: {}, embedding: embedding('记忆检索'), createdAt: recent },
      { chunkType: 'session_summary', content: '较早洞察', topic: 'python', sessionId: 'old', metadata: {}, embedding: embedding('记忆检索'), createdAt: old },
    ] })
    const results = await service.semanticHistory('user-a', 'python', '记忆检索', 5)
    expect(results.map((item) => item.content)).toEqual(['近期洞察', '较早洞察'])
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
    expect(results[1]!.score).toBeCloseTo(0.7 + 0.3 * 0.5 ** (60 / 14), 5)
    const summary = await service.summary('user-a', 'python')
    expect(summary).toContain('本轮到期复习：GIL 机制需要复习')
    expect(summary.indexOf('近期洞察')).toBeLessThan(summary.indexOf('较早洞察'))
    sessions.close(); vectors.close()
  })

  test('retrieves across topics within one user and deduplicates before filling three slots', async () => {
    const { service, sessions, vectors } = await fixture([])
    const createdAt = new Date().toISOString()
    const memory = (content: string, sessionId?: string, chunkType: 'session_summary' | 'insight' = 'session_summary') => ({
      content, sessionId, chunkType, topic: 'distributed', createdAt, embedding: embedding('记忆检索'),
    })
    await vectors.appendProfileMemories({ userId: 'user-a', entries: [
      memory('共享状态解释不足', 'one'),
      memory('共享状态解释不足\n薄弱点：锁的边界', 'one', 'insight'),
      memory('共享状态解释不足\n薄弱点：锁的边界', 'duplicate'),
      memory('事务隔离讲解不完整', 'two'),
      memory('无会话编号的有效历史'),
    ] })
    await vectors.appendProfileMemories({ userId: 'user-b', entries: [memory('其他用户的私密历史', 'foreign')] })
    try {
      const result = await service.semanticHistory('user-a', 'python', '记忆检索')
      expect(result.map(row => row.content)).toEqual(['共享状态解释不足\n薄弱点：锁的边界', '事务隔离讲解不完整', '无会话编号的有效历史'])
      expect(result.map(row => row.topic)).toEqual(['distributed', 'distributed', 'distributed'])
      expect(result[0]!.chunkType).toBe('insight')
    } finally { sessions.close(); vectors.close() }
  })

  test('uses only active training needs in the query and bounds historical context', async () => {
    const { service, repository, sessions, vectors, embeddingInputs, embeddings } = await fixture([])
    const profile = defaultProfile()
    profile.weak_points.push(
      { point: 'GIL 调度机制', topic: 'python', improved: false, sr: { next_review: '2020-01-01' } },
      { point: '已经改善的知识点', topic: 'python', improved: true },
      { point: '已归档知识点', topic: 'python', archived: true },
    )
    await repository.save('user-a', profile)
    await vectors.appendProfileMemories({ userId: 'user-a', entries: Array.from({ length: 3 }, (_, index) => ({
      chunkType: 'session_summary' as const, content: `历史${index}：${'有效证据'.repeat(300)}`, topic: 'concurrency', sessionId: `session-${index}`,
      // Positive but below the old 0.3 cutoff: ranked candidates must still be exposed.
      embedding: Float32Array.from([0.2, Math.sqrt(0.96), 0, 0, 0, 0]), createdAt: new Date().toISOString(),
    })) })
    try {
      const summary = await service.summary('user-a', 'python', '训练 Python 多线程与共享状态')
      const query = embeddingInputs.at(-1)![0]!
      expect(query).toContain('训练 Python 多线程与共享状态')
      expect(query).toContain('优先复习：GIL 调度机制')
      expect(query).not.toContain('已经改善')
      expect(query).not.toContain('已归档')
      const history = summary.split('历史语义洞察')[1]!
      expect(history).toContain('历史0：')
      expect(history).toContain('历史1：')
      expect(history).toContain('历史2：')
      expect(history.length).toBeLessThanOrEqual(2040)
      expect(history).toContain('concurrency')
      embeddings.embed = async () => { throw new Error('Embedding unavailable') }
      const fallback = await service.summary('user-a', 'python')
      expect(fallback).toContain('已知知识薄弱点：GIL 调度机制')
      expect(fallback).not.toContain('历史语义洞察')
    } finally { sessions.close(); vectors.close() }
  })
})
