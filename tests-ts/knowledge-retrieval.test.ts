import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeIndexService, type EmbeddingUseCases, type RequestContext } from '@techspar/core'
import { BunKnowledgeVectorRepository } from '@techspar/db'
import { FileKnowledgeStore } from '@techspar/platform'

describe('multi-query knowledge retrieval', () => {
  let root: string
  let vectors: BunKnowledgeVectorRepository
  let store: FileKnowledgeStore
  let service: KnowledgeIndexService
  let calls: Array<{ context: RequestContext; texts: string[] }>
  const context: RequestContext = { requestId: 'rag-test', userId: 'user-a', signal: new AbortController().signal }
  const queryVectors = new Map([
    ['transactions', Float32Array.from([1, 0])],
    ['messaging', Float32Array.from([0, 1])],
  ])
  const shared = '事务和消息的一致性证据。'
  const first = '仅关于数据库事务的证据。'
  const second = '仅关于消息投递的证据。'
  type Evidence = { content: string; embedding: Float32Array }
  const evidence: Evidence[] = [
    { content: first, embedding: Float32Array.from([1, 0]) },
    { content: second, embedding: Float32Array.from([0, 1]) },
    { content: shared, embedding: Float32Array.from([1, 1]) },
  ]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-rag-'))
    vectors = new BunKnowledgeVectorRepository(join(root, 'vectors.db'))
    vectors.initialize()
    store = new FileKnowledgeStore(join(root, 'data'))
    calls = []
    const embeddings: EmbeddingUseCases = {
      async embed(request, texts) {
        calls.push({ context: request, texts: [...texts] })
        return texts.map(text => queryVectors.get(text) ?? Float32Array.from([1, 1]))
      },
      async signature() { return 'synthetic-rag-model' },
      reset() {},
    }
    service = new KnowledgeIndexService(store, vectors, embeddings)
  })

  afterEach(async () => {
    vectors.close()
    await rm(root, { recursive: true, force: true })
  })

  async function seed(chunks: readonly Evidence[], userId = 'user-a', topic = 'rag') {
    await store.loadTopics(userId)
    await store.saveTopics(userId, {
      rag: { name: 'RAG', icon: '', dir: 'rag' },
      other: { name: 'Other', icon: '', dir: 'other' },
    })
    await store.deleteCore(userId, topic, 'README.md')
    await store.writeCore(userId, topic, 'evidence.md',
      chunks.map(chunk => chunk.content).join('\n\n') + '\n\n' + '背景资料。'.repeat(2000), 'upsert')
    await vectors.replaceChunks({ userId, chunkType: 'topic_chunk', topic,
      chunks: chunks.map(chunk => ({ ...chunk, source: 'evidence.md' })) })
  }

  test('prioritizes evidence supported by both queries within a small context budget', async () => {
    await seed(evidence)
    const result = await service.context(context, 'rag', ['transactions', 'messaging'], {
      topK: 2, charBudget: shared.length,
    })
    expect(result).toBe(shared)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ context, texts: ['transactions', 'messaging'] })
  })

  test('keeps fused evidence order independent of query order', async () => {
    await seed(evidence)
    const options = { topK: 2, charBudget: 200 }
    const forward = await service.context(context, 'rag', ['transactions', 'messaging'], options)
    const reverse = await service.context(context, 'rag', ['messaging', 'transactions'], options)
    expect(forward).toBe(reverse)
    expect(forward).toStartWith(shared)
    expect(forward).toContain(first)
    expect(forward).toContain(second)
  })

  test('preserves distinct chunks sharing the first 100 characters', async () => {
    const prefix = '相同的文档标题和背景。'.repeat(12)
    const left = prefix + '事务回滚的具体条件'
    const right = prefix + '消息重试的具体条件'
    await seed([
      { content: left, embedding: Float32Array.from([1, 0]) },
      { content: right, embedding: Float32Array.from([0.8, 0.2]) },
    ])
    const result = await service.context(context, 'rag', ['transactions'], { topK: 2, charBudget: 1000 })
    expect(result).toContain(left)
    expect(result).toContain(right)
  })

  test('does not count duplicate document chunks twice or consume distinct candidate slots', async () => {
    await seed([evidence[0]!, evidence[0]!, evidence[1]!, evidence[2]!])
    const result = await service.context(context, 'rag', ['transactions', 'messaging'], { topK: 2, charBudget: 200 })
    expect(result).toStartWith(shared)
    expect(result.split(first)).toHaveLength(2)
    expect(result.split(shared)).toHaveLength(2)
  })

  test('normalizes and deduplicates query intents before embedding and fusion', async () => {
    await seed(evidence)
    const result = await service.context(context, 'rag', [' transactions ', '', 'transactions', 'messaging', '  '], {
      topK: 2, charBudget: 200,
    })
    expect(result).toStartWith(shared)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.texts).toEqual(['transactions', 'messaging'])
  })

  test('retains single-query topK and the hard character budget', async () => {
    await seed(evidence)
    expect(await service.context(context, 'rag', ['transactions'], { topK: 1, charBudget: 200 })).toBe(first)
    expect(await service.context(context, 'rag', ['transactions'], { topK: 2, charBudget: 5 })).toBe(first.slice(0, 5))
  })

  test('never retrieves another user, topic, or chunk type from the real SQLite repository', async () => {
    await seed(evidence)
    await seed([{ content: 'OTHER-USER-PRIVATE', embedding: Float32Array.from([1, 0]) }], 'user-b')
    await seed([{ content: 'OTHER-TOPIC-PRIVATE', embedding: Float32Array.from([1, 0]) }], 'user-a', 'other')
    await vectors.replaceChunks({ userId: 'user-a', topic: 'rag', chunkType: 'weak_point',
      chunks: [{ content: 'OTHER-TYPE-PRIVATE', source: '', embedding: Float32Array.from([1, 0]) }] })
    const result = await service.context(context, 'rag', ['transactions', 'messaging'], { charBudget: 200 })
    expect(result).toContain(shared)
    expect(result).not.toContain('PRIVATE')
    const other = await service.context({ ...context, userId: 'user-b' }, 'rag', ['transactions'], { charBudget: 200 })
    expect(other).toBe('OTHER-USER-PRIVATE')
    expect(calls.at(-1)!.context.userId).toBe('user-b')
  })

  test('keeps short documents intact without requiring embeddings', async () => {
    await seed(evidence)
    await store.writeCore('user-a', 'rag', 'evidence.md', '完整的短文档', 'replace')
    expect(await service.context(context, 'rag', ['transactions'], { charBudget: 200 })).toBe('完整的短文档')
    expect(calls).toHaveLength(0)
  })

  test('avoids embedding calls for empty query intents or disabled retrieval', async () => {
    await seed(evidence)
    expect(await service.context(context, 'rag', ['', '  '], { charBudget: 200 })).toBe('')
    expect(await service.context(context, 'rag', ['transactions'], { topK: 0, charBudget: 200 })).toBe('')
    expect(calls).toHaveLength(0)
  })

  test('lazily indexes documents once and batches subsequent query vectors', async () => {
    await seed(evidence)
    await vectors.deleteChunks('user-a', 'topic_chunk', 'rag')
    await service.context(context, 'rag', ['transactions', 'messaging'], { charBudget: 200 })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.texts.length).toBeGreaterThan(1)
    expect(calls[1]!.texts).toEqual(['transactions', 'messaging'])
    expect((await vectors.listChunks('user-a', 'topic_chunk', 'rag')).length).toBe(calls[0]!.texts.length)
    await service.context(context, 'rag', ['messaging'], { charBudget: 200 })
    expect(calls).toHaveLength(3)
    expect(calls[2]!.texts).toEqual(['messaging'])
  })
})
