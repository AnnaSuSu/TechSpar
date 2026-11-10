import type { IdGenerator } from '../account/ports.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { TextGenerationUseCases } from '../provider/ports.ts'
import type { KnowledgeFile, QuestionGraph, TopicMap } from './model.ts'

export interface KnowledgeStore {
  loadTopics(userId: string): Promise<TopicMap>
  saveTopics(userId: string, topics: TopicMap): Promise<void>
  ensureTopic(userId: string, directory: string, title: string): Promise<void>
  listCore(userId: string, directory: string): Promise<KnowledgeFile[]>
  writeCore(userId: string, directory: string, filename: string, content: string, mode: 'create' | 'replace' | 'upsert'): Promise<void>
  deleteCore(userId: string, directory: string, filename: string): Promise<boolean>
  readHighFrequency(userId: string, topic: string): Promise<string>
  writeHighFrequency(userId: string, topic: string, content: string): Promise<void>
}

export interface DocumentTextExtractor {
  extract(filename: string, bytes: Uint8Array): Promise<string>
}

export interface KnowledgeIndex {
  invalidateTopic(userId: string, topic: string): Promise<void>
  graph(userId: string, topic: string): Promise<QuestionGraph>
}

export type VectorChunk = { content: string; embedding: Float32Array }
/** The opaque version prevents a rebuild from overwriting a later invalidation. */
export type SessionMemoryChunk = { id: number; sessionId: string | null; content: string; version: string | null }
export type DrillSessionProjection = {
  sessionId: string
  questions: Array<Record<string, unknown>>
  scores: Array<Record<string, unknown>>
  createdAt: string
}

export interface KnowledgeVectorRepository {
  initialize(): void
  /** Invalidate embeddings while retaining session memory source text. */
  invalidateUserVectors(userId: string): Promise<void>
  listSessionMemoryChunks(userId: string): Promise<SessionMemoryChunk[]>
  updateSessionMemoryEmbeddings(userId: string, chunks: readonly { id: number; version: string | null; embedding: Float32Array }[]): Promise<void>
  replaceChunks(input: { userId: string; chunkType: string; topic?: string; chunks: Array<{ content: string; source: string; embedding: Float32Array }> }): Promise<void>
  listChunks(userId: string, chunkType: string, topic?: string): Promise<VectorChunk[]>
  deleteChunks(userId: string, chunkType?: string, topic?: string): Promise<void>
  drillSessions(userId: string, topic: string): Promise<DrillSessionProjection[]>
  questionEmbeddings(userId: string, keys: readonly string[]): Promise<Map<string, Float32Array>>
  saveQuestionEmbedding(input: { userId: string; key: string; topic: string; question: string; embedding: Float32Array }): Promise<void>
  clearQuestionEmbeddings(userId: string): Promise<void>
}

export interface KnowledgeQuery {
  context(context: RequestContext, topic: string, queries: readonly string[], options?: { topK?: number; charBudget?: number }): Promise<string>
}

export interface KnowledgeUseCases {
  topics(context: RequestContext): Promise<TopicMap>
  createTopic(context: RequestContext, input: { name: string; icon?: string; key?: string }): Promise<{ ok: true; key: string }>
  deleteTopic(context: RequestContext, key: string): Promise<{ ok: true }>
  listCore(context: RequestContext, topic: string): Promise<KnowledgeFile[]>
  createCore(context: RequestContext, topic: string, input: { filename: string; content?: string }): Promise<{ ok: true; filename: string }>
  updateCore(context: RequestContext, topic: string, filename: string, content: string): Promise<{ ok: true }>
  deleteCore(context: RequestContext, topic: string, filename: string): Promise<{ ok: true }>
  importCore(context: RequestContext, topic: string, filename: string, bytes: Uint8Array): Promise<{ ok: true; filename: string }>
  generateCore(context: RequestContext, topic: string): Promise<{ ok: true; content: string }>
  getHighFrequency(context: RequestContext, topic: string): Promise<{ content: string }>
  updateHighFrequency(context: RequestContext, topic: string, content: string): Promise<{ ok: true }>
  graph(context: RequestContext, topic: string): Promise<QuestionGraph>
}

export type KnowledgeDependencies = {
  store: KnowledgeStore
  extractor: DocumentTextExtractor
  index: KnowledgeIndex
  ai: TextGenerationUseCases
  ids: IdGenerator
}
