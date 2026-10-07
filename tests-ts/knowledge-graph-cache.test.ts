import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeIndexService, KnowledgeService, type EmbeddingUseCases } from '@techspar/core'
import { BunInterviewSessionRepository, BunKnowledgeVectorRepository } from '@techspar/db'
import { boundaryApp, jsonHeaders, unavailable } from './contracts/test-app.ts'

describe('question graph embedding cache identity', () => {
  // These distinct UTF-16 strings both produce the legacy FNV-1a key 7e133839.
  const left = '合成知识图谱问题：w9ahg-ktp9cz 的事务边界如何设计？'
  const right = '合成知识图谱问题：1poh1rs-1b9hkxj 的事务边界如何设计？'
  const related = '解释缓存击穿与缓存雪崩的区别'
  const questions = [left, right, related]
  let root: string
  let path: string
  let sessions: BunInterviewSessionRepository
  let vectors: BunKnowledgeVectorRepository
  let sqlite: Database
  let embeddings: EmbeddingUseCases
  let service: KnowledgeIndexService
  let calls: Array<{ userId?: string; texts: string[] }>
  let failEmbedding: boolean

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-graph-cache-'))
    path = join(root, 'graph.db')
    sessions = new BunInterviewSessionRepository(path)
    vectors = new BunKnowledgeVectorRepository(path)
    sessions.initialize(); vectors.initialize()
    sqlite = new Database(path)
    calls = []
    failEmbedding = false
    embeddings = {
      async embed(context, texts) {
        calls.push({ userId: context.userId, texts: [...texts] })
        if (failEmbedding) throw new Error('embedding unavailable')
        return texts.map(text => {
          const alternate = context.userId === 'user-b'
          return Float32Array.from((text === right) !== alternate ? [0, 1] : [1, 0])
        })
      },
      async signature() { return 'synthetic-graph-model' },
      reset() {},
    }
    service = new KnowledgeIndexService(unavailable as never, vectors, embeddings)
  })

  afterEach(async () => {
    sqlite.close(); sessions.close(); vectors.close()
    await rm(root, { recursive: true, force: true })
  })

  async function reviewed(texts = questions, userId = 'user-a', topic = 'rag', sessionId = 'reviewed') {
    await sessions.create({ sessionId, userId, mode: 'topic_drill', topic,
      questions: texts.map((question, index) => ({ id: index + 1, question, difficulty: 3 })) })
    await sessions.saveReview({ sessionId, userId, review: '合成复盘',
      scores: texts.map((_, index) => ({ question_id: index + 1, score: 7 })) })
  }

  function rows(userId = 'user-a') {
    return sqlite.query<{ question_hash: string; question_text: string }, [string]>(
      'SELECT question_hash, question_text FROM question_embeddings WHERE user_id = ? ORDER BY question_text',
    ).all(userId)
  }

  test('does not manufacture a similarity edge between colliding questions over HTTP', async () => {
    await reviewed()
    const knowledge = new KnowledgeService({ index: service, store: unavailable as never,
      extractor: unavailable as never, ai: unavailable as never, ids: { next: () => 'unused' } })
    const app = boundaryApp({ knowledge })
    const response = await app.request('/api/graph/rag', { headers: jsonHeaders })
    expect(response.status).toBe(200)
    const graph = await response.json() as { nodes: Array<{ question: string }>; links: unknown[] }
    expect(graph.nodes.map(node => node.question)).toEqual(questions)
    expect(graph.links).toEqual([{ source: 0, target: 2, similarity: 1 }])
    expect((await app.request('/api/graph/rag')).status).toBe(401)
  })

  test('persists separate versioned cache keys for every distinct question', async () => {
    await reviewed()
    await service.graph('user-a', 'rag')
    const cached = rows()
    expect(cached).toHaveLength(3)
    expect(new Set(cached.map(row => row.question_hash)).size).toBe(3)
    expect(cached.map(row => row.question_text).sort()).toEqual([...questions].sort())
    for (const row of cached) expect(row.question_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test('reuses durable cache entries after repositories and the graph service restart', async () => {
    await reviewed()
    const before = await service.graph('user-a', 'rag')
    const keys = rows().map(row => row.question_hash)
    vectors.close()
    vectors = new BunKnowledgeVectorRepository(path)
    vectors.initialize()
    service = new KnowledgeIndexService(unavailable as never, vectors, embeddings)
    expect(await service.graph('user-a', 'rag')).toEqual(before)
    expect(rows().map(row => row.question_hash)).toEqual(keys)
    expect(calls).toEqual([{ userId: 'user-a', texts: questions }])
  })

  test('rebuilds legacy colliding entries lazily without trusting or deleting the old row', async () => {
    await reviewed()
    await vectors.saveQuestionEmbedding({ userId: 'user-a', topic: 'rag', key: '7e133839',
      question: right, embedding: Float32Array.from([1, 1]) })
    const graph = await service.graph('user-a', 'rag')
    expect(graph.links).toEqual([{ source: 0, target: 2, similarity: 1 }])
    expect(calls[0]!.texts).toEqual(questions)
    expect(rows()).toHaveLength(4)
    expect(rows().filter(row => row.question_hash === '7e133839')).toHaveLength(1)
    await service.graph('user-a', 'rag')
    expect(calls).toHaveLength(1)
  })

  test('embeds only newly observed questions when most of the cache is warm', async () => {
    await reviewed()
    await service.graph('user-a', 'rag')
    const added = '解释事务隔离级别'
    await reviewed([added], 'user-a', 'rag', 'additional')
    const graph = await service.graph('user-a', 'rag')
    expect(graph.nodes).toHaveLength(4)
    expect(rows()).toHaveLength(4)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.texts).toEqual([added])
  })

  test('isolates identical cache keys by user in the real SQLite repository', async () => {
    await reviewed()
    await reviewed(questions, 'user-b', 'rag', 'other-user')
    await service.graph('user-a', 'rag')
    await service.graph('user-b', 'rag')
    expect(rows('user-a')).toEqual(rows('user-b'))
    const key = rows().find(row => row.question_text === left)!.question_hash
    expect([...(await vectors.questionEmbeddings('user-a', [key])).get(key)!]).toEqual([1, 0])
    expect([...(await vectors.questionEmbeddings('user-b', [key])).get(key)!]).toEqual([0, 1])
    expect(calls.map(call => call.userId)).toEqual(['user-a', 'user-b'])
  })

  test('shares the same question vector across topics without including unrelated nodes', async () => {
    await reviewed()
    await service.graph('user-a', 'rag')
    const other = '解释另一个主题的问题'
    await reviewed([left, other], 'user-a', 'other', 'other-topic')
    const graph = await service.graph('user-a', 'other')
    expect(graph.nodes.map(node => node.question)).toEqual([left, other])
    expect(calls[1]!.texts).toEqual([other])
    expect(rows()).toHaveLength(4)
  })

  test('preserves duplicate-question score aggregation and the single-node fast path', async () => {
    await reviewed([left])
    expect((await service.graph('user-a', 'rag')).links).toEqual([])
    expect(calls).toHaveLength(0)
    await reviewed([` ${left} `, right], 'user-a', 'rag', 'repeat')
    await sessions.saveReview({ sessionId: 'repeat', userId: 'user-a', review: '合成复盘',
      scores: [{ question_id: 1, score: 9 }, { question_id: 2, score: 7 }] })
    const graph = await service.graph('user-a', 'rag')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0]).toMatchObject({ question: left, attempts: 2, avg_score: 8, best_score: 9 })
    expect(rows()).toHaveLength(2)
    expect(calls[0]!.texts).toEqual([left, right])
  })

  test('does not poison the cache when the embedding provider fails', async () => {
    await reviewed()
    failEmbedding = true
    await expect(service.graph('user-a', 'rag')).rejects.toThrow('embedding unavailable')
    expect(rows()).toHaveLength(0)
    failEmbedding = false
    expect((await service.graph('user-a', 'rag')).links).toEqual([{ source: 0, target: 2, similarity: 1 }])
    expect(rows()).toHaveLength(3)
  })
})
