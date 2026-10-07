import type { RequestContext } from '../kernel/context.ts'
import type { VectorIndexControl } from '../provider/ports.ts'
import type { EmbeddingUseCases } from '../provider/ports.ts'
import type { KnowledgeIndex, KnowledgeQuery, KnowledgeStore, KnowledgeVectorRepository } from './ports.ts'
import type { QuestionGraph } from './model.ts'

const TOPIC_CHUNK = 'topic_chunk'
const CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 150
const RRF_RANK_CONSTANT = 60

export function chunkText(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const paragraphs = text.split('\n\n').map((part) => part.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_SIZE) {
      chunks.push(current)
      const tail = CHUNK_OVERLAP ? current.slice(-CHUNK_OVERLAP) : ''
      current = tail ? `${tail}\n\n${paragraph}` : paragraph
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
  }
  if (current) chunks.push(current)
  const output: string[] = []
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP)
  for (const chunk of chunks) {
    if (chunk.length <= CHUNK_SIZE * 2) output.push(chunk)
    else for (let index = 0; index < chunk.length; index += step) output.push(chunk.slice(index, index + CHUNK_SIZE))
  }
  return output
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || !left.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!
    const b = right[index]!
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm) + 1e-12)
}

async function questionKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  // Version the key so legacy 32-bit entries are rebuilt instead of trusted.
  return `sha256:${hash}`
}

export class KnowledgeIndexService implements KnowledgeIndex, KnowledgeQuery, VectorIndexControl {
  constructor(
    private readonly store: KnowledgeStore,
    private readonly vectors: KnowledgeVectorRepository,
    private readonly embeddings: EmbeddingUseCases,
  ) {}

  resetEmbeddingClient(userId: string): void {
    this.embeddings.reset(userId)
  }

  async invalidateUser(userId: string): Promise<void> {
    await Promise.all([this.vectors.deleteChunks(userId), this.vectors.clearQuestionEmbeddings(userId)])
  }

  invalidateTopic(userId: string, topic: string): Promise<void> {
    return this.vectors.deleteChunks(userId, TOPIC_CHUNK, topic)
  }

  private async documents(userId: string, topic: string): Promise<Array<{ content: string; source: string }>> {
    const topics = await this.store.loadTopics(userId)
    const meta = topics[topic]
    if (!meta) return []
    return (await this.store.listCore(userId, meta.dir))
      .map((file) => ({ content: file.content.trim(), source: file.filename }))
      .filter((file) => file.content)
  }

  private async ingest(context: RequestContext, topic: string): Promise<void> {
    const userId = context.userId!
    const chunks = (await this.documents(userId, topic)).flatMap((file) => chunkText(file.content).map((content) => ({ content, source: file.source })))
    const embedded = await this.embeddings.embed(context, chunks.map((chunk) => chunk.content))
    await this.vectors.replaceChunks({
      userId,
      chunkType: TOPIC_CHUNK,
      topic,
      chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: embedded[index]! })),
    })
  }

  private async retrieve(context: RequestContext, topic: string, queries: readonly string[], topK: number): Promise<string[]> {
    const intents = [...new Set(queries.map(query => query.trim()).filter(Boolean))]
    if (!intents.length || topK <= 0) return []
    let chunks = await this.vectors.listChunks(context.userId!, TOPIC_CHUNK, topic)
    if (!chunks.length && (await this.documents(context.userId!, topic)).length) {
      await this.ingest(context, topic)
      chunks = await this.vectors.listChunks(context.userId!, TOPIC_CHUNK, topic)
    }
    if (!chunks.length) return []
    const queryVectors = await this.embeddings.embed(context, intents)
    const fused = new Map<string, number>()
    for (const queryVector of queryVectors) {
      const ranked = chunks
        .map(chunk => ({ content: chunk.content, similarity: cosine(queryVector, chunk.embedding) }))
        .sort((a, b) => b.similarity - a.similarity)
      const seen = new Set<string>()
      let rank = 0
      for (const chunk of ranked) {
        // The same evidence gets at most one vote per query, even across files.
        if (seen.has(chunk.content)) continue
        seen.add(chunk.content)
        rank += 1
        fused.set(chunk.content, (fused.get(chunk.content) ?? 0) + 1 / (RRF_RANK_CONSTANT + rank))
        if (rank >= topK) break
      }
    }
    return [...fused.entries()]
      .sort(([left, leftScore], [right, rightScore]) => rightScore - leftScore || (left < right ? -1 : left > right ? 1 : 0))
      .map(([content]) => content)
  }

  async context(context: RequestContext, topic: string, queries: readonly string[], options?: { topK?: number; charBudget?: number }): Promise<string> {
    const charBudget = options?.charBudget ?? 8000
    const full = (await this.documents(context.userId!, topic)).map((item) => item.content).join('\n\n---\n\n')
    if (full.length <= charBudget) return full
    const chunks = await this.retrieve(context, topic, queries, options?.topK ?? 5)
    return chunks.join('\n\n---\n\n').slice(0, charBudget)
  }

  async rebuildTopic(context: RequestContext, topic: string): Promise<void> {
    await this.invalidateTopic(context.userId!, topic)
    await this.ingest(context, topic)
  }

  async graph(userId: string, topic: string): Promise<QuestionGraph> {
    const sessions = await this.vectors.drillSessions(userId, topic)
    type AggregatedQuestion = {
      question: string
      score: number
      score_sum: number
      best_score: number
      attempts: number
      focus_area: unknown
      difficulty: unknown
      date: string
      session_id: string
    }
    const seen = new Map<string, AggregatedQuestion>()
    for (const session of sessions) {
      const scoreMap = new Map(session.scores.filter((score) => 'question_id' in score).map((score) => [score.question_id, score]))
      for (const question of session.questions) {
        const text = typeof question.question === 'string' ? question.question.trim() : ''
        if (!text) continue
        const score = scoreMap.get(question.id)?.score
        if (typeof score !== 'number') continue
        const current = seen.get(text)
        if (current) {
          current.attempts += 1
          current.score_sum += score
          current.best_score = Math.max(current.best_score, score)
          Object.assign(current, { score, focus_area: question.focus_area || current.focus_area, difficulty: question.difficulty || 3, date: session.createdAt.slice(0, 10), session_id: session.sessionId })
        } else {
          seen.set(text, { question: text, score, score_sum: score, best_score: score, attempts: 1, focus_area: question.focus_area || '', difficulty: question.difficulty || 3, date: session.createdAt.slice(0, 10), session_id: session.sessionId })
        }
      }
    }
    const questions = [...seen.values()].map((item) => ({ ...item, avg_score: Math.round((item.score_sum / item.attempts) * 10) / 10 }))
    const nodes = questions.map(({ score_sum: _, ...question }, id) => ({ id, ...question }))
    if (questions.length < 2) return { nodes, links: [] }
    const context: RequestContext = { requestId: 'question-graph', userId, signal: new AbortController().signal }
    const keys = await Promise.all(questions.map((question) => questionKey(String(question.question))))
    const cached = await this.vectors.questionEmbeddings(userId, keys)
    const missing = questions.map((question, index) => ({ question: String(question.question), key: keys[index]! })).filter((item) => !cached.has(item.key))
    if (missing.length) {
      const values = await this.embeddings.embed(context, missing.map((item) => item.question))
      for (let index = 0; index < missing.length; index += 1) {
        const item = missing[index]!
        const embedding = values[index]!
        cached.set(item.key, embedding)
        await this.vectors.saveQuestionEmbedding({ userId, key: item.key, topic, question: item.question, embedding })
      }
    }
    const links: Array<Record<string, unknown>> = []
    for (let left = 0; left < questions.length; left += 1) {
      for (let right = left + 1; right < questions.length; right += 1) {
        const similarity = cosine(cached.get(keys[left]!)!, cached.get(keys[right]!)!)
        if (similarity >= 0.65) links.push({ source: left, target: right, similarity: Math.round(similarity * 1000) / 1000 })
      }
    }
    return { nodes, links }
  }
}
