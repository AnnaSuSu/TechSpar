import { Database } from 'bun:sqlite'
import type { CopilotPrepRecord, CopilotRepository, CopilotSessionState } from '@techspar/core'

type PrepRow = Omit<CopilotPrepRecord, 'result'> & { result: string | null }
type SessionRow = Omit<CopilotSessionState, 'conversation'> & { conversation: string }
function json<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function prep(row: PrepRow): CopilotPrepRecord { return { ...row, result: json<Record<string, unknown> | null>(row.result, null) } }
function session(row: SessionRow): CopilotSessionState { return { ...row, conversation: json(row.conversation, []) } }

export class BunCopilotRepository implements CopilotRepository {
  private readonly sqlite: Database
  constructor(path: string) { this.sqlite = new Database(path, { create: true }); this.sqlite.exec('PRAGMA journal_mode = WAL'); this.sqlite.exec('PRAGMA busy_timeout = 5000') }
  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS copilot_preps (
        prep_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, company TEXT DEFAULT '', position TEXT DEFAULT '', jd_text TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running', progress TEXT DEFAULT '', error TEXT DEFAULT '', result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_copilot_preps_user ON copilot_preps(user_id);
      CREATE TABLE IF NOT EXISTS copilot_realtime_sessions (
        session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, prep_id TEXT NOT NULL, conversation TEXT NOT NULL DEFAULT '[]',
        last_node_id TEXT, review_session_id TEXT, review_claimed_at TEXT, turn_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_copilot_realtime_user ON copilot_realtime_sessions(user_id, updated_at DESC);
    `)
    const columns = this.sqlite.query<{ name: string }, []>('PRAGMA table_info(copilot_realtime_sessions)').all()
    for (const column of ['review_session_id', 'review_claimed_at']) {
      if (!columns.some((item) => item.name === column)) this.sqlite.exec(`ALTER TABLE copilot_realtime_sessions ADD COLUMN ${column} TEXT`)
    }
  }
  async createPrep(input: { prepId: string; userId: string; company: string; position: string; jdText: string }): Promise<void> {
    this.sqlite.query("INSERT INTO copilot_preps (prep_id, user_id, company, position, jd_text, status, progress, error) VALUES ($id, $userId, $company, $position, $jd, 'running', '初始化中...', '')").run({ $id: input.prepId, $userId: input.userId, $company: input.company, $position: input.position, $jd: input.jdText })
  }
  async getPrep(prepId: string, userId: string): Promise<CopilotPrepRecord | undefined> { const row = this.sqlite.query<PrepRow, { $id: string; $userId: string }>('SELECT * FROM copilot_preps WHERE prep_id = $id AND user_id = $userId').get({ $id: prepId, $userId: userId }); return row ? prep(row) : undefined }
  async listPreps(userId: string): Promise<CopilotPrepRecord[]> { return this.sqlite.query<PrepRow, { $userId: string }>('SELECT * FROM copilot_preps WHERE user_id = $userId ORDER BY created_at DESC, rowid DESC').all({ $userId: userId }).map(prep) }
  async updatePrepProgress(prepId: string, userId: string, progress: string): Promise<void> { this.sqlite.query("UPDATE copilot_preps SET status = 'running', progress = $progress, error = '' WHERE prep_id = $id AND user_id = $userId").run({ $progress: progress, $id: prepId, $userId: userId }) }
  async completePrep(prepId: string, userId: string, result: Record<string, unknown>): Promise<void> { this.sqlite.query("UPDATE copilot_preps SET status = 'done', progress = '准备完成', error = '', result = $result WHERE prep_id = $id AND user_id = $userId").run({ $result: JSON.stringify(result), $id: prepId, $userId: userId }) }
  async failPrep(prepId: string, userId: string, error: string): Promise<void> { this.sqlite.query("UPDATE copilot_preps SET status = 'error', error = $error WHERE prep_id = $id AND user_id = $userId").run({ $error: error, $id: prepId, $userId: userId }) }
  async deletePrep(prepId: string, userId: string): Promise<boolean> { return this.sqlite.transaction(() => { this.sqlite.query('DELETE FROM copilot_realtime_sessions WHERE prep_id = $id AND user_id = $userId').run({ $id: prepId, $userId: userId }); return this.sqlite.query('DELETE FROM copilot_preps WHERE prep_id = $id AND user_id = $userId').run({ $id: prepId, $userId: userId }).changes > 0 })() }
  async loadSession(sessionId: string, userId: string): Promise<CopilotSessionState | undefined> { const row = this.sqlite.query<SessionRow, { $id: string; $userId: string }>('SELECT * FROM copilot_realtime_sessions WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId }); return row ? session(row) : undefined }
  async saveSession(state: CopilotSessionState): Promise<void> {
    const owner = this.sqlite.query<{ user_id: string }, { $id: string }>('SELECT user_id FROM copilot_realtime_sessions WHERE session_id = $id').get({ $id: state.session_id })
    if (owner && owner.user_id !== state.user_id) throw new Error('Copilot session belongs to another user')
    this.sqlite.query(`INSERT INTO copilot_realtime_sessions (session_id, user_id, prep_id, conversation, last_node_id, turn_count, status, created_at, updated_at)
      VALUES ($id, $userId, $prepId, $conversation, $lastNodeId, $turnCount, $status, $createdAt, $updatedAt)
      ON CONFLICT(session_id) DO UPDATE SET prep_id = excluded.prep_id, conversation = excluded.conversation, last_node_id = excluded.last_node_id, turn_count = excluded.turn_count, status = excluded.status, updated_at = excluded.updated_at
      WHERE copilot_realtime_sessions.user_id = excluded.user_id`).run({ $id: state.session_id, $userId: state.user_id, $prepId: state.prep_id, $conversation: JSON.stringify(state.conversation), $lastNodeId: state.last_node_id || null, $turnCount: state.turn_count, $status: state.status, $createdAt: state.created_at, $updatedAt: state.updated_at })
  }
  async listSessions(prepId: string, userId: string): Promise<CopilotSessionState[]> {
    return this.sqlite.query<SessionRow, [string, string]>('SELECT * FROM copilot_realtime_sessions WHERE prep_id = ? AND user_id = ? ORDER BY updated_at DESC, rowid DESC').all(prepId, userId).map(session)
  }
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    return this.sqlite.query('DELETE FROM copilot_realtime_sessions WHERE session_id = ? AND user_id = ?').run(sessionId, userId).changes > 0
  }
  async linkReview(sessionId: string, userId: string, reviewId: string, expected: string | null, claimedAt: string): Promise<boolean> {
    return this.sqlite.query('UPDATE copilot_realtime_sessions SET review_session_id = ?, review_claimed_at = ? WHERE session_id = ? AND user_id = ? AND review_session_id IS ?').run(reviewId, claimedAt, sessionId, userId, expected).changes > 0
  }
  async completeReviewLink(sessionId: string, userId: string, reviewId: string): Promise<void> {
    this.sqlite.query('UPDATE copilot_realtime_sessions SET review_claimed_at = NULL WHERE session_id = ? AND user_id = ? AND review_session_id = ?').run(sessionId, userId, reviewId)
  }
  async unlinkReview(sessionId: string, userId: string, reviewId: string): Promise<void> {
    this.sqlite.query('UPDATE copilot_realtime_sessions SET review_session_id = NULL, review_claimed_at = NULL WHERE session_id = ? AND user_id = ? AND review_session_id = ?').run(sessionId, userId, reviewId)
  }
  close(): void { this.sqlite.close() }
}
