import { Database } from 'bun:sqlite'
import type { DrillSessionProjection, KnowledgeVectorRepository, ProfileMemoryEntry, ProfileVectorMemoryPort, VectorChunk } from '@techspar/core'

function toBlob(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4)
  const view = new DataView(bytes.buffer)
  vector.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return bytes
}

function fromBlob(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values = new Float32Array(bytes.byteLength / 4)
  for (let index = 0; index < values.length; index += 1) values[index] = view.getFloat32(index * 4, true)
  return values
}

function metadata(value: string | null): Record<string, unknown> {
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} } catch { return {} }
}

export class BunKnowledgeVectorRepository implements KnowledgeVectorRepository, ProfileVectorMemoryPort {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
  }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_type TEXT NOT NULL,
        content TEXT NOT NULL,
        topic TEXT,
        session_id TEXT,
        metadata TEXT DEFAULT '{}',
        embedding BLOB NOT NULL,
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_mv_type ON memory_vectors(chunk_type);
      CREATE INDEX IF NOT EXISTS idx_mv_topic ON memory_vectors(topic);
      CREATE INDEX IF NOT EXISTS idx_mv_user ON memory_vectors(user_id);
      CREATE TABLE IF NOT EXISTS question_embeddings (
        question_hash TEXT,
        topic TEXT,
        question_text TEXT,
        embedding BLOB NOT NULL,
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (question_hash, user_id)
      );
    `)
    const primaryKeys = this.sqlite.query<{ name: string; pk: number }, []>('PRAGMA table_info(question_embeddings)').all().filter((row) => row.pk).map((row) => row.name)
    if (primaryKeys.length === 1 && primaryKeys[0] === 'question_hash') {
      this.sqlite.exec(`
        DROP TABLE question_embeddings;
        CREATE TABLE question_embeddings (
          question_hash TEXT,
          topic TEXT,
          question_text TEXT,
          embedding BLOB NOT NULL,
          user_id TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (question_hash, user_id)
        );
      `)
    }
  }

  async replaceChunks(input: { userId: string; chunkType: string; topic?: string; chunks: Array<{ content: string; source: string; embedding: Float32Array }> }): Promise<void> {
    const transaction = this.sqlite.transaction(() => {
      if (input.topic === undefined) {
        this.sqlite.query('DELETE FROM memory_vectors WHERE user_id = $userId AND chunk_type = $chunkType').run({ $userId: input.userId, $chunkType: input.chunkType })
      } else {
        this.sqlite.query('DELETE FROM memory_vectors WHERE user_id = $userId AND chunk_type = $chunkType AND topic = $topic').run({ $userId: input.userId, $chunkType: input.chunkType, $topic: input.topic })
      }
      const statement = this.sqlite.query(`
        INSERT INTO memory_vectors (chunk_type, content, topic, session_id, metadata, embedding, user_id, created_at)
        VALUES ($chunkType, $content, $topic, NULL, $metadata, $embedding, $userId, $createdAt)
      `)
      const createdAt = new Date().toISOString()
      for (const chunk of input.chunks) statement.run({
        $chunkType: input.chunkType,
        $content: chunk.content,
        $topic: input.topic ?? null,
        $metadata: JSON.stringify({ source: chunk.source }),
        $embedding: toBlob(chunk.embedding),
        $userId: input.userId,
        $createdAt: createdAt,
      })
    })
    transaction()
  }

  async listChunks(userId: string, chunkType: string, topic?: string): Promise<VectorChunk[]> {
    const rows = topic === undefined
      ? this.sqlite.query<{ content: string; embedding: Uint8Array }, { $userId: string; $chunkType: string }>('SELECT content, embedding FROM memory_vectors WHERE user_id = $userId AND chunk_type = $chunkType').all({ $userId: userId, $chunkType: chunkType })
      : this.sqlite.query<{ content: string; embedding: Uint8Array }, { $userId: string; $chunkType: string; $topic: string }>('SELECT content, embedding FROM memory_vectors WHERE user_id = $userId AND chunk_type = $chunkType AND topic = $topic').all({ $userId: userId, $chunkType: chunkType, $topic: topic })
    return rows.map((row) => ({ content: row.content, embedding: fromBlob(row.embedding) }))
  }

  private insertProfileMemories(input: { userId: string; entries: readonly ProfileMemoryEntry[] }): void {
    const statement = this.sqlite.query(`
      INSERT INTO memory_vectors (chunk_type, content, topic, session_id, metadata, embedding, user_id, created_at)
      VALUES ($chunkType, $content, $topic, $sessionId, $metadata, $embedding, $userId, $createdAt)
    `)
    for (const entry of input.entries) statement.run({
      $chunkType: entry.chunkType,
      $content: entry.content,
      $topic: entry.topic ?? null,
      $sessionId: entry.sessionId ?? null,
      $metadata: JSON.stringify(entry.metadata || {}),
      $embedding: toBlob(entry.embedding),
      $userId: input.userId,
      $createdAt: entry.createdAt,
    })
  }

  async appendProfileMemories(input: { userId: string; entries: readonly ProfileMemoryEntry[] }): Promise<void> {
    this.sqlite.transaction(() => this.insertProfileMemories(input))()
  }

  async replaceSessionMemories(input: { userId: string; sessionId: string; entries: readonly ProfileMemoryEntry[] }): Promise<void> {
    if (!input.sessionId || input.entries.some(entry => entry.sessionId !== input.sessionId)) throw new Error('Invalid memory session')
    this.sqlite.transaction(() => {
      this.sqlite.query("DELETE FROM memory_vectors WHERE user_id = $userId AND session_id = $sessionId AND chunk_type IN ('session_summary', 'insight', 'weak_point')")
        .run({ $userId: input.userId, $sessionId: input.sessionId })
      this.insertProfileMemories(input)
    })()
  }

  async listProfileMemories(input: { userId: string; chunkTypes?: readonly ProfileMemoryEntry['chunkType'][]; topic?: string }): Promise<ProfileMemoryEntry[]> {
    type Row = { chunk_type: ProfileMemoryEntry['chunkType']; content: string; topic: string | null; session_id: string | null; metadata: string | null; embedding: Uint8Array; created_at: string | null }
    const rows = input.topic === undefined
      ? this.sqlite.query<Row, { $userId: string }>("SELECT chunk_type, content, topic, session_id, metadata, embedding, created_at FROM memory_vectors WHERE user_id = $userId AND chunk_type IN ('session_summary', 'insight', 'weak_point')").all({ $userId: input.userId })
      : this.sqlite.query<Row, { $userId: string; $topic: string }>("SELECT chunk_type, content, topic, session_id, metadata, embedding, created_at FROM memory_vectors WHERE user_id = $userId AND topic = $topic AND chunk_type IN ('session_summary', 'insight', 'weak_point')").all({ $userId: input.userId, $topic: input.topic })
    const allowed = input.chunkTypes?.length ? new Set(input.chunkTypes) : undefined
    return rows.flatMap((row) => {
      if (allowed && !allowed.has(row.chunk_type)) return []
      return [{
        chunkType: row.chunk_type,
        content: row.content,
        ...(row.topic ? { topic: row.topic } : {}),
        ...(row.session_id ? { sessionId: row.session_id } : {}),
        metadata: metadata(row.metadata),
        embedding: fromBlob(row.embedding),
        createdAt: row.created_at || new Date(0).toISOString(),
      }]
    })
  }

  async deleteChunks(userId: string, chunkType?: string, topic?: string): Promise<void> {
    if (!chunkType) {
      this.sqlite.query('DELETE FROM memory_vectors WHERE user_id = $userId').run({ $userId: userId })
    } else if (topic === undefined) {
      this.sqlite.query('DELETE FROM memory_vectors WHERE user_id = $userId AND chunk_type = $chunkType').run({ $userId: userId, $chunkType: chunkType })
    } else {
      this.sqlite.query('DELETE FROM memory_vectors WHERE user_id = $userId AND chunk_type = $chunkType AND topic = $topic').run({ $userId: userId, $chunkType: chunkType, $topic: topic })
    }
  }

  async drillSessions(userId: string, topic: string): Promise<DrillSessionProjection[]> {
    const rows = this.sqlite.query<{ session_id: string; questions: string; scores: string; created_at: string }, { $userId: string; $topic: string }>(`
      SELECT session_id, questions, scores, created_at FROM sessions
      WHERE topic = $topic AND user_id = $userId AND mode = 'topic_drill' AND review IS NOT NULL
      ORDER BY created_at ASC
    `).all({ $userId: userId, $topic: topic })
    return rows.map((row) => ({
      sessionId: row.session_id,
      questions: JSON.parse(row.questions || '[]') as Array<Record<string, unknown>>,
      scores: JSON.parse(row.scores || '[]') as Array<Record<string, unknown>>,
      createdAt: row.created_at || '',
    }))
  }

  async questionEmbeddings(userId: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const output = new Map<string, Float32Array>()
    const statement = this.sqlite.query<{ embedding: Uint8Array }, { $userId: string; $key: string }>('SELECT embedding FROM question_embeddings WHERE user_id = $userId AND question_hash = $key')
    for (const key of keys) {
      const row = statement.get({ $userId: userId, $key: key })
      if (row) output.set(key, fromBlob(row.embedding))
    }
    return output
  }

  async saveQuestionEmbedding(input: { userId: string; key: string; topic: string; question: string; embedding: Float32Array }): Promise<void> {
    this.sqlite.query(`
      INSERT OR REPLACE INTO question_embeddings (question_hash, topic, question_text, embedding, user_id, created_at)
      VALUES ($key, $topic, $question, $embedding, $userId, $createdAt)
    `).run({ $key: input.key, $topic: input.topic, $question: input.question, $embedding: toBlob(input.embedding), $userId: input.userId, $createdAt: new Date().toISOString() })
  }

  async clearQuestionEmbeddings(userId: string): Promise<void> {
    this.sqlite.query('DELETE FROM question_embeddings WHERE user_id = $userId').run({ $userId: userId })
  }

  close(): void {
    this.sqlite.close()
  }
}
