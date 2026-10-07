import { Database } from 'bun:sqlite'
import type {
  AgentMessage,
  PersonalAgentRepository,
  PersonalConversation,
  PersonalDocument,
  PersonalDocumentHit,
} from '@techspar/core'

function toBlob(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4); const view = new DataView(bytes.buffer)
  vector.forEach((value, index) => view.setFloat32(index * 4, value, true)); return bytes
}
function fromBlob(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const values = new Float32Array(bytes.byteLength / 4)
  for (let index = 0; index < values.length; index += 1) values[index] = view.getFloat32(index * 4, true)
  return values
}
function cosine(left: Float32Array, right: Float32Array): number {
  if (!left.length || left.length !== right.length) return 0
  let dot = 0; let aNorm = 0; let bNorm = 0
  for (let index = 0; index < left.length; index += 1) { const a = left[index]!; const b = right[index]!; dot += a * b; aNorm += a * a; bNorm += b * b }
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm) + 1e-12)
}
function parse<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback } catch { return fallback } }

type DocumentRow = { document_id: string; user_id: string; filename: string; stored_name: string; extension: string; size_bytes: number; status: PersonalDocument['status']; chunk_count: number; error: string | null; created_at: string; updated_at: string }
type ConversationRow = { conversation_id: string; user_id: string; title: string; messages: string; created_at: string; updated_at: string }

export class BunPersonalAgentRepository implements PersonalAgentRepository {
  private readonly sqlite: Database
  constructor(path: string) { this.sqlite = new Database(path, { create: true }); this.sqlite.exec('PRAGMA journal_mode = WAL'); this.sqlite.exec('PRAGMA busy_timeout = 5000') }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS personal_documents (
        document_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, filename TEXT NOT NULL, stored_name TEXT NOT NULL,
        extension TEXT NOT NULL, size_bytes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'indexing',
        chunk_count INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_personal_documents_user ON personal_documents(user_id, created_at);
      CREATE TABLE IF NOT EXISTS personal_conversations (
        conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话', messages TEXT NOT NULL DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_personal_conversations_user ON personal_conversations(user_id, updated_at);
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_type TEXT NOT NULL, content TEXT NOT NULL, topic TEXT, session_id TEXT,
        metadata TEXT DEFAULT '{}', embedding BLOB NOT NULL, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_mv_user ON memory_vectors(user_id);
    `)
  }

  async listDocuments(userId: string): Promise<PersonalDocument[]> {
    return this.sqlite.query<DocumentRow, { $userId: string }>('SELECT * FROM personal_documents WHERE user_id = $userId ORDER BY created_at DESC, rowid DESC').all({ $userId: userId })
  }
  async getDocument(documentId: string, userId: string): Promise<PersonalDocument | undefined> {
    return this.sqlite.query<DocumentRow, { $id: string; $userId: string }>('SELECT * FROM personal_documents WHERE document_id = $id AND user_id = $userId').get({ $id: documentId, $userId: userId }) || undefined
  }
  async createDocument(input: { documentId: string; userId: string; filename: string; storedName: string; extension: string; sizeBytes: number }): Promise<void> {
    this.sqlite.query("INSERT INTO personal_documents (document_id, user_id, filename, stored_name, extension, size_bytes, status) VALUES ($id, $userId, $filename, $storedName, $extension, $size, 'indexing')").run({ $id: input.documentId, $userId: input.userId, $filename: input.filename, $storedName: input.storedName, $extension: input.extension, $size: input.sizeBytes })
  }
  async setDocumentStatus(input: { documentId: string; userId: string; status: PersonalDocument['status']; chunkCount?: number; error?: string }): Promise<void> {
    this.sqlite.query('UPDATE personal_documents SET status = $status, chunk_count = $count, error = $error, updated_at = CURRENT_TIMESTAMP WHERE document_id = $id AND user_id = $userId').run({ $status: input.status, $count: input.chunkCount || 0, $error: input.error ?? null, $id: input.documentId, $userId: input.userId })
  }
  async deleteDocument(documentId: string, userId: string): Promise<boolean> { return this.sqlite.query('DELETE FROM personal_documents WHERE document_id = $id AND user_id = $userId').run({ $id: documentId, $userId: userId }).changes > 0 }
  async replaceDocumentChunks(input: { documentId: string; userId: string; filename: string; chunks: Array<{ content: string; embedding: Float32Array }> }): Promise<void> {
    this.sqlite.transaction(() => {
      this.sqlite.query("DELETE FROM memory_vectors WHERE chunk_type = 'personal_document_chunk' AND session_id = $id AND user_id = $userId").run({ $id: input.documentId, $userId: input.userId })
      const statement = this.sqlite.query("INSERT INTO memory_vectors (chunk_type, content, topic, session_id, metadata, embedding, user_id, created_at) VALUES ('personal_document_chunk', $content, NULL, $id, $metadata, $embedding, $userId, $createdAt)")
      const createdAt = new Date().toISOString(); const metadata = JSON.stringify({ document_id: input.documentId, source: input.filename })
      for (const chunk of input.chunks) statement.run({ $content: chunk.content, $id: input.documentId, $metadata: metadata, $embedding: toBlob(chunk.embedding), $userId: input.userId, $createdAt: createdAt })
    })()
  }
  async deleteDocumentChunks(documentId: string, userId: string): Promise<void> { this.sqlite.query("DELETE FROM memory_vectors WHERE chunk_type = 'personal_document_chunk' AND session_id = $id AND user_id = $userId").run({ $id: documentId, $userId: userId }) }
  async searchDocuments(userId: string, embedding: Float32Array, topK: number): Promise<PersonalDocumentHit[]> {
    const rows = this.sqlite.query<{ document_id: string; source: string; content: string; embedding: Uint8Array }, { $userId: string }>(`SELECT mv.session_id AS document_id, COALESCE(pd.filename, json_extract(mv.metadata, '$.source'), '') AS source, mv.content, mv.embedding FROM memory_vectors mv LEFT JOIN personal_documents pd ON pd.document_id = mv.session_id AND pd.user_id = mv.user_id WHERE mv.chunk_type = 'personal_document_chunk' AND mv.user_id = $userId`).all({ $userId: userId })
    return rows
      .map((row) => ({ document_id: row.document_id, source: row.source, content: row.content, score: Math.round(cosine(embedding, fromBlob(row.embedding)) * 10_000) / 10_000 }))
      .filter((row) => row.score >= 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  async listConversations(userId: string) {
    return this.sqlite.query<ConversationRow, { $userId: string }>('SELECT * FROM personal_conversations WHERE user_id = $userId ORDER BY updated_at DESC, rowid DESC').all({ $userId: userId }).map((row) => ({ conversation_id: row.conversation_id, title: row.title, message_count: parse<AgentMessage[]>(row.messages, []).length, created_at: row.created_at, updated_at: row.updated_at }))
  }
  async getConversation(conversationId: string, userId: string): Promise<PersonalConversation | undefined> {
    const row = this.sqlite.query<ConversationRow, { $id: string; $userId: string }>('SELECT * FROM personal_conversations WHERE conversation_id = $id AND user_id = $userId').get({ $id: conversationId, $userId: userId })
    return row ? { ...row, messages: parse(row.messages, []) } : undefined
  }
  async createConversation(input: { conversationId: string; userId: string; title: string }): Promise<PersonalConversation> {
    this.sqlite.query('INSERT INTO personal_conversations (conversation_id, user_id, title) VALUES ($id, $userId, $title)').run({ $id: input.conversationId, $userId: input.userId, $title: input.title })
    return (await this.getConversation(input.conversationId, input.userId))!
  }
  async saveConversation(conversationId: string, userId: string, messages: AgentMessage[]): Promise<void> { this.sqlite.query('UPDATE personal_conversations SET messages = $messages, updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $id AND user_id = $userId').run({ $messages: JSON.stringify(messages), $id: conversationId, $userId: userId }) }
  async appendConversationMessages(conversationId: string, userId: string, messages: readonly AgentMessage[]): Promise<boolean> {
    const append = this.sqlite.transaction(() => {
      const row = this.sqlite.query<{ messages: string }, { $id: string; $userId: string }>(
        'SELECT messages FROM personal_conversations WHERE conversation_id = $id AND user_id = $userId',
      ).get({ $id: conversationId, $userId: userId })
      if (!row) return false
      const current = parse<AgentMessage[]>(row.messages, [])
      return this.sqlite.query('UPDATE personal_conversations SET messages = $messages, updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $id AND user_id = $userId')
        .run({ $messages: JSON.stringify([...current, ...messages]), $id: conversationId, $userId: userId }).changes > 0
    })
    // Acquire the write lock before reading history, including across connections.
    return append.immediate()
  }
  async deleteConversation(conversationId: string, userId: string): Promise<boolean> { return this.sqlite.query('DELETE FROM personal_conversations WHERE conversation_id = $id AND user_id = $userId').run({ $id: conversationId, $userId: userId }).changes > 0 }
  async recentConversationMemory(userId: string, excludeConversationId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const rows = this.sqlite.query<ConversationRow, { $userId: string }>('SELECT * FROM personal_conversations WHERE user_id = $userId ORDER BY updated_at DESC, rowid DESC LIMIT 8').all({ $userId: userId })
    const output: Array<Record<string, unknown>> = []
    for (const row of rows) {
      if (row.conversation_id === excludeConversationId) continue
      for (const item of parse<AgentMessage[]>(row.messages, []).slice(-6).reverse()) {
        output.push({ conversation: row.title, role: item.role, content: item.content.slice(0, 1200), date: row.updated_at.slice(0, 10) })
        if (output.length >= limit) return output.reverse()
      }
    }
    return output.reverse()
  }
  async recentMistakes(userId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const hasSessions = this.sqlite.query<{ present: number }, []>("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()
    if (!hasSessions) return []
    const rows = this.sqlite.query<{ topic: string | null; questions: string; scores: string; created_at: string }, { $userId: string }>("SELECT topic, questions, scores, created_at FROM sessions WHERE user_id = $userId AND scores != '[]' ORDER BY created_at DESC, rowid DESC LIMIT 30").all({ $userId: userId })
    const output: Array<Record<string, unknown>> = []
    for (const row of rows) {
      const questions = parse<Array<Record<string, unknown>>>(row.questions, []); const byId = new Map(questions.map((question) => [String(question.id), question]))
      for (const score of parse<Array<Record<string, unknown>>>(row.scores, [])) {
        if (typeof score.score === 'number' && score.score <= 6) {
          const question = byId.get(String(score.question_id))
          output.push({ topic: row.topic, question: question?.question || score.question || '', score: score.score, assessment: score.assessment || '', improvement: score.improvement || '', key_missing: Array.isArray(score.key_missing) ? score.key_missing : [], date: row.created_at.slice(0, 10) })
          if (output.length >= limit) return output
        }
      }
    }
    return output
  }
  close(): void { this.sqlite.close() }
}
