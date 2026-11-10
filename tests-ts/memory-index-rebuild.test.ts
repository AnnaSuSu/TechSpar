import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  KnowledgeIndexService, PersonalAgentService, ProfileService, SettingsOperationsService, SettingsService,
  type EmbeddingUseCases, type InterviewSession, type KnowledgeStore, type PlatformProviderConfig,
  type RequestContext, type UserRepository,
} from '@techspar/core'
import { IndexRebuildEventSchema } from '@techspar/contracts/events'
import { BunKnowledgeVectorRepository, BunPersonalAgentRepository } from '@techspar/db'
import { FileCandidateProfileRepository, FilePersonalDocumentStore, FileProviderSettingsRepository } from '@techspar/platform'
import { boundaryApp, jsonHeaders, unavailable } from './contracts/test-app.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })
const context = (userId = 'user-a'): RequestContext => ({ requestId: 'memory-index-test', userId, signal: new AbortController().signal })
const extraction = { session_summary: 'GIL needs practice', weak_points: [{ point: 'GIL', topic: 'python', score: 7 }], strong_points: [], behavior_signals: [], avg_score: 7 }
const platform: PlatformProviderConfig = { llm: { api_base: '', api_key: '', model: '' }, embedding: { api_base: '', api_key: '', api_model: '' }, dailyCallLimit: 0, tokenLimit: 0, tokenWindow: 'day' }
const users = { async findById(id: string) { return { id, email: 'test@example.com', name: 'Test', is_admin: false } } } as UserRepository
function session(sessionId: string, userId = 'user-a'): InterviewSession {
  return { session_id: sessionId, user_id: userId, mode: 'topic_drill', topic: 'python', questions: [], transcript: [], scores: [], overall: { avg_score: 7 }, review: 'Saved review', status: 'reviewed', meta: {}, weak_points: [], reference_answers: {}, review_error: null, created_at: '', updated_at: '' }
}

type MemoryRow = { id: number; chunk_type: string; content: string; topic: string | null; session_id: string | null; metadata: string; embedding: Uint8Array; user_id: string; created_at: string }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'techspar-memory-index-')); const path = join(root, 'test.db')
  const vectors = new BunKnowledgeVectorRepository(path); vectors.initialize()
  const documents = new BunPersonalAgentRepository(path); documents.initialize()
  const sqlite = new Database(path)
  cleanups.push(async () => { sqlite.close(); vectors.close(); documents.close(); await rm(root, { recursive: true, force: true }) })
  const repository = new FileCandidateProfileRepository(root)
  const settingsRepository = new FileProviderSettingsRepository(root)
  let dimensions = 2; let failure = ''; let llmCalls = 0
  let beforeEmbed: (() => Promise<void>) | undefined
  const embeddings: EmbeddingUseCases = {
    async embed(ctx, texts) {
      if (beforeEmbed) { const callback = beforeEmbed; beforeEmbed = undefined; await callback() }
      if (failure === 'outage') throw new Error('synthetic embedding outage')
      const values = texts.map(() => Float32Array.from(Array.from({ length: dimensions }, (_, index) => index === 0 ? 1 : 0)))
      if (failure === 'partial') return values.slice(1)
      if (failure === 'nan') return texts.map(() => Float32Array.from([NaN, 0]))
      if (failure === 'dimension') return values.map((value, index) => index ? Float32Array.from([1]) : value)
      if (failure === 'empty') return texts.map(() => new Float32Array())
      ctx.signal.throwIfAborted()
      return values
    },
    async signature() { return 'synthetic' }, reset() {},
  }
  const knowledge = { async loadTopics() { return {} }, async listCore() { return [] } } as unknown as KnowledgeStore
  const profile = new ProfileService({ repository, vectors, embeddings, knowledgeStore: knowledge, sessions: unavailable as never, tasks: unavailable as never, resume: unavailable as never,
    ai: { async complete() { llmCalls++; return JSON.stringify(extraction) }, async *stream() {} },
  })
  const index = new KnowledgeIndexService(knowledge, vectors, embeddings)
  const settings = new SettingsService(settingsRepository, users, index, platform, { allowRegistration: false })
  let nextId = 0
  const personal = new PersonalAgentService({ repository: documents, files: new FilePersonalDocumentStore(root), extractor: { async extract(_filename, bytes) { return new TextDecoder().decode(bytes) } }, embeddings, profile, ai: unavailable as never, ids: { next() { return `document-${++nextId}` } } })
  const operations = new SettingsOperationsService({ chats: unavailable as never, embeddingDrivers: unavailable as never, embeddings, index, vectors, knowledge, personal, profile, settings: settingsRepository })
  const rows = (userId = 'user-a') => sqlite.query<MemoryRow, [string]>("SELECT * FROM memory_vectors WHERE user_id = ? AND chunk_type IN ('session_summary', 'insight') ORDER BY id").all(userId)
  const app = boundaryApp({ settings, settingsOperations: operations })
  async function rebuild() {
    const response = await app.request('/api/settings/rebuild-index', { method: 'POST', headers: jsonHeaders })
    expect(response.status).toBe(200)
    const events = (await response.text()).trim().split('\n\n').map(frame => IndexRebuildEventSchema.parse(JSON.parse(frame.slice(6))))
    return events
  }
  async function seed(userId = 'user-a', sessionId = 'session-1') {
    await profile.afterReview({ userId, session: session(sessionId, userId) })
  }
  async function changeModel() {
    const value = await settings.get(context())
    value.embedding = { ...value.embedding, backend: 'api', api_base: 'https://embedding.example.test/v1', api_key: 'synthetic', api_model: 'model-b' }
    return settings.update(context(), value)
  }
  return { root, sqlite, vectors, documents, repository, profile, index, personal, operations, settings, app, rows, rebuild, seed, changeModel,
    dimensions(value: number) { dimensions = value }, fail(value: string) { failure = value }, beforeEmbed(callback: () => Promise<void>) { beforeEmbed = callback }, calls: () => llmCalls }
}
function immutable(row: MemoryRow) {
  const { embedding: _, metadata, ...rest } = row
  const { embedding_stale: __, ...details } = JSON.parse(metadata) as Record<string, unknown>
  return { ...rest, metadata: details }
}

for (const dimensions of [2, 3]) test(`model switch retains source text and suppresses stale recall, then HTTP rebuild restores ${dimensions}D embeddings`, async () => {
  const f = await fixture(); await f.seed(); await f.seed('user-a', 'session-2'); await f.seed('user-b')
  const document = await f.personal.upload(context(), 'notes.txt', new TextEncoder().encode('GIL notes'))
  const otherDocument = await f.personal.upload(context('user-b'), 'other.txt', new TextEncoder().encode('Other notes'))
  await f.vectors.replaceChunks({ userId: 'user-a', chunkType: 'topic_chunk', topic: 'python', chunks: [{ content: 'Knowledge source', source: 'notes.md', embedding: Float32Array.from([1, 0]) }] })
  await f.vectors.saveQuestionEmbedding({ userId: 'user-a', key: 'q', topic: 'python', question: 'GIL?', embedding: Float32Array.from([1, 0]) })
  const before = f.rows(); const other = f.rows('user-b')
  const profileBytes = await readFile(join(f.root, 'users/user-a/profile/profile.json'))
  expect(before).toHaveLength(4); expect((await f.profile.semanticHistory('user-a', 'python')).length).toBeGreaterThan(0)
  f.dimensions(dimensions)
  expect(await f.changeModel()).toEqual({ ok: true, embedding_changed: true })
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect(f.rows().every(row => JSON.parse(row.metadata).embedding_stale)).toBeTrue()
  expect(await f.profile.semanticHistory('user-a', 'python')).toEqual([])
  const restarted = new BunKnowledgeVectorRepository(join(f.root, 'test.db')); restarted.initialize()
  try { expect(await restarted.listProfileMemories({ userId: 'user-a', chunkTypes: ['session_summary', 'insight'] })).toEqual([]) } finally { restarted.close() }
  expect(await f.profile.summary('user-a', 'python')).not.toContain('历史语义洞察')
  expect(await f.documents.getDocument(document.document_id, 'user-a')).toMatchObject({ status: 'needs_reindex', chunk_count: 0, error: null })
  expect(await f.documents.searchDocuments('user-a', Float32Array.from([1, 0]), 3)).toEqual([])
  expect(await f.vectors.listChunks('user-a', 'topic_chunk')).toEqual([])
  expect((await f.vectors.questionEmbeddings('user-a', ['q'])).size).toBe(0)
  expect(f.rows('user-b')).toEqual(other)
  expect(await f.documents.getDocument(otherDocument.document_id, 'user-b')).toMatchObject({ status: 'ready', chunk_count: 1 })
  const events = await f.rebuild()
  expect(events).toContainEqual({ completed: 2, total: 4, label: '历史会话记忆', status: 'done' })
  expect(events.at(-1)).toMatchObject({ done: true, rebuilt: { session_memories: true, weak_points: true, personal_documents: true, topics: [] } })
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect(f.rows().every(row => row.embedding.byteLength === dimensions * 4 && !JSON.parse(row.metadata).embedding_stale)).toBeTrue()
  expect((await f.profile.semanticHistory('user-a', 'python')).length).toBeGreaterThan(0)
  expect(await f.profile.summary('user-a', 'python')).toContain('历史语义洞察')
  expect(await f.documents.getDocument(document.document_id, 'user-a')).toMatchObject({ status: 'ready', chunk_count: 1 })
  expect(await f.documents.searchDocuments('user-a', Float32Array.from(dimensions === 2 ? [1, 0] : [1, 0, 0]), 3)).toHaveLength(1)
  await f.rebuild()
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect(f.rows('user-b')).toEqual(other)
  expect(await readFile(join(f.root, 'users/user-a/profile/profile.json'))).toEqual(profileBytes)
  expect(f.calls()).toBe(3)
})

test('manual rebuild without a model change retains memory row identity and handles legacy rows without session IDs', async () => {
  const f = await fixture(); await f.seed()
  f.sqlite.query("UPDATE memory_vectors SET session_id = NULL WHERE chunk_type = 'insight'").run()
  const before = f.rows()
  await f.rebuild()
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect((await f.profile.semanticHistory('user-a', 'python')).length).toBeGreaterThan(0)
})

for (const failure of ['outage', 'partial', 'nan', 'dimension', 'empty']) test(`failed ${failure} rebuild retains memory for retry`, async () => {
  const f = await fixture(); await f.seed(); const before = f.rows()
  await f.changeModel(); f.fail(failure)
  const events = await f.rebuild()
  expect(events.some(event => 'status' in event && event.status === 'error' && event.label === '历史会话记忆')).toBeTrue()
  expect(events.at(-1)).toMatchObject({ done: true, rebuilt: { session_memories: false } })
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect(await f.profile.semanticHistory('user-a', 'python')).toEqual([])
  f.fail(''); await f.rebuild()
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect((await f.profile.semanticHistory('user-a', 'python')).length).toBeGreaterThan(0)
})

test('SQLite failure rolls back both memory embeddings within a session and preserves retryability', async () => {
  const f = await fixture(); await f.seed(); const before = f.rows()
  await f.changeModel(); f.dimensions(3)
  f.sqlite.exec("CREATE TRIGGER reject_insight BEFORE UPDATE OF embedding ON memory_vectors WHEN NEW.chunk_type = 'insight' BEGIN SELECT RAISE(ABORT, 'synthetic SQLite outage'); END")
  const events = await f.rebuild()
  expect(events.at(-1)).toMatchObject({ done: true, rebuilt: { session_memories: false } })
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect(f.rows().every(row => row.embedding.byteLength === 8 && JSON.parse(row.metadata).embedding_stale)).toBeTrue()
  f.sqlite.exec('DROP TRIGGER reject_insight'); await f.rebuild()
  expect(f.rows().every(row => row.embedding.byteLength === 12 && !JSON.parse(row.metadata).embedding_stale)).toBeTrue()
})

test('a model invalidation during embedding prevents an older rebuild from reactivating memory', async () => {
  const f = await fixture(); await f.seed()
  f.beforeEmbed(() => f.index.invalidateUser('user-a'))
  const events = await f.rebuild()
  expect(events.at(-1)).toMatchObject({ done: true, rebuilt: { session_memories: false } })
  expect(await f.profile.semanticHistory('user-a', 'python')).toEqual([])
  expect(f.rows()).toHaveLength(2)
  await f.rebuild()
  expect((await f.profile.semanticHistory('user-a', 'python')).length).toBeGreaterThan(0)
})

test('failed invalidation stops the rebuild before any source is rewritten', async () => {
  const f = await fixture(); await f.seed(); const before = f.rows()
  f.sqlite.exec("CREATE TRIGGER reject_invalidation BEFORE UPDATE OF metadata ON memory_vectors BEGIN SELECT RAISE(ABORT, 'cannot invalidate'); END")
  const events = await f.rebuild()
  expect(events).toEqual([{ completed: 0, total: 3, label: '清理旧向量', status: 'running' }, { completed: 1, total: 3, label: '清理旧向量', status: 'error', error: 'cannot invalidate' }, { fatal: true, error: 'cannot invalidate' }])
  expect(f.rows()).toEqual(before)
})

test('aborting during embedding retains stale text without committing new vectors', async () => {
  const f = await fixture(); await f.seed(); const before = f.rows()
  const controller = new AbortController()
  f.beforeEmbed(async () => { controller.abort(new Error('cancelled')) })
  const events = []
  for await (const event of f.operations.rebuildIndex({ ...context(), signal: controller.signal })) events.push(event)
  expect(events.at(-1)).toEqual({ fatal: true, error: 'cancelled' })
  expect(f.rows().map(immutable)).toEqual(before.map(immutable))
  expect(f.rows().every(row => JSON.parse(row.metadata).embedding_stale)).toBeTrue()
})

test('empty history completes without embeddings and unauthenticated rebuild is rejected', async () => {
  const f = await fixture(); f.fail('outage')
  expect((await f.rebuild()).at(-1)).toMatchObject({ done: true, rebuilt: { session_memories: true } })
  expect((await f.app.request('/api/settings/rebuild-index', { method: 'POST' })).status).toBe(401)
})

test('invalidation tolerates legacy metadata and databases without personal documents', async () => {
  const f = await fixture(); await f.seed()
  f.sqlite.query("UPDATE memory_vectors SET metadata = 'not-json' WHERE chunk_type = 'insight'").run()
  await f.index.invalidateUser('user-a'); await f.rebuild()
  expect((await f.profile.semanticHistory('user-a', 'python')).length).toBeGreaterThan(0)
  const onlyVectors = new BunKnowledgeVectorRepository(join(f.root, 'vectors-only.db')); onlyVectors.initialize()
  try { await onlyVectors.invalidateUserVectors('user-a') } finally { onlyVectors.close() }
})

test('a document status failure rolls back invalidation across memory, knowledge and question vectors', async () => {
  const f = await fixture(); await f.seed()
  const document = await f.personal.upload(context(), 'notes.txt', new TextEncoder().encode('Original document'))
  await f.vectors.replaceChunks({ userId: 'user-a', chunkType: 'topic_chunk', topic: 'python', chunks: [{ content: 'Knowledge', source: 'notes.md', embedding: Float32Array.from([1, 0]) }] })
  await f.vectors.saveQuestionEmbedding({ userId: 'user-a', key: 'q', topic: 'python', question: 'GIL?', embedding: Float32Array.from([1, 0]) })
  const before = f.rows()
  f.sqlite.exec("CREATE TRIGGER reject_document_status BEFORE UPDATE ON personal_documents BEGIN SELECT RAISE(ABORT, 'status unavailable'); END")
  await expect(f.index.invalidateUser('user-a')).rejects.toThrow('status unavailable')
  expect(f.rows()).toEqual(before)
  expect(await f.vectors.listChunks('user-a', 'topic_chunk')).toHaveLength(1)
  expect((await f.vectors.questionEmbeddings('user-a', ['q'])).size).toBe(1)
  expect(await f.documents.getDocument(document.document_id, 'user-a')).toMatchObject({ status: 'ready', chunk_count: 1 })
  expect(await f.documents.searchDocuments('user-a', Float32Array.from([1, 0]), 3)).toHaveLength(1)
})

test('rebuild embedding updates cannot modify another user or reactivate a deleted memory row', async () => {
  const f = await fixture(); await f.seed(); await f.seed('user-b')
  await f.index.invalidateUser('user-a')
  const other = f.rows('user-b')
  const [foreign] = await f.vectors.listSessionMemoryChunks('user-b')
  await expect(f.vectors.updateSessionMemoryEmbeddings('user-a', [{ id: foreign!.id, version: foreign!.version, embedding: Float32Array.from([0, 1]) }])).rejects.toThrow('Session memory changed')
  expect(f.rows('user-b')).toEqual(other)
  const [deleted] = await f.vectors.listSessionMemoryChunks('user-a')
  f.sqlite.query('DELETE FROM memory_vectors WHERE id = ?').run(deleted!.id)
  await expect(f.vectors.updateSessionMemoryEmbeddings('user-a', [{ id: deleted!.id, version: deleted!.version, embedding: Float32Array.from([1, 0]) }])).rejects.toThrow('Session memory changed')
  expect(f.rows()).toHaveLength(1)
})

test('failed invalidation does not save a new model alongside readable old-model vectors', async () => {
  const f = await fixture(); await f.seed(); const before = f.rows()
  const previous = await f.settings.get(context())
  f.sqlite.exec("CREATE TRIGGER reject_model_change BEFORE UPDATE OF metadata ON memory_vectors BEGIN SELECT RAISE(ABORT, 'cannot invalidate'); END")
  await expect(f.changeModel()).rejects.toThrow('cannot invalidate')
  expect((await f.settings.get(context())).embedding).toEqual(previous.embedding)
  expect(f.rows()).toEqual(before)
})
