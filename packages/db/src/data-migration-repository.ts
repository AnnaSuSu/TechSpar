import { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MigrationDatabase } from '@techspar/core'

const TABLES = {
  sessions: { primary: 'session_id', ddl: `CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, mode TEXT NOT NULL, topic TEXT, meta TEXT DEFAULT '{}', questions TEXT DEFAULT '[]', transcript TEXT DEFAULT '[]', scores TEXT DEFAULT '[]', weak_points TEXT DEFAULT '[]', overall TEXT DEFAULT '{}', reference_answers TEXT DEFAULT '{}', review TEXT, status TEXT DEFAULT 'ongoing', review_error TEXT, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)` },
  personal_documents: { primary: 'document_id', ddl: `CREATE TABLE IF NOT EXISTS personal_documents (document_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, filename TEXT NOT NULL, stored_name TEXT NOT NULL, extension TEXT NOT NULL, size_bytes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'indexing', chunk_count INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)` },
  personal_conversations: { primary: 'conversation_id', ddl: `CREATE TABLE IF NOT EXISTS personal_conversations (conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话', messages TEXT NOT NULL DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)` },
  copilot_preps: { primary: 'prep_id', ddl: `CREATE TABLE IF NOT EXISTS copilot_preps (prep_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, company TEXT DEFAULT '', position TEXT DEFAULT '', jd_text TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'running', progress TEXT DEFAULT '', error TEXT DEFAULT '', result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)` },
  copilot_realtime_sessions: { primary: 'session_id', ddl: `CREATE TABLE IF NOT EXISTS copilot_realtime_sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, prep_id TEXT NOT NULL, conversation TEXT NOT NULL DEFAULT '[]', last_node_id TEXT, review_session_id TEXT, review_claimed_at TEXT, turn_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` },
} as const

function exists(database: Database, table: string): boolean { return Boolean(database.query<{ present: number }, { $table: string }>("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $table").get({ $table: table })) }
function columns(database: Database, table: string): string[] { return database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((row) => row.name) }
function json<T>(value: unknown, fallback: T): T { try { return typeof value === 'string' ? JSON.parse(value) as T : fallback } catch { return fallback } }
function numeric(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function average(values: number[]): number | undefined { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : undefined }

const MODE_AVERAGES: Record<string, { key: string; window: number }> = {
  resume: { key: 'resume_avg_score', window: 10 },
  topic_drill: { key: 'drill_avg_score', window: 20 },
  jd_prep: { key: 'job_prep_avg_score', window: 10 },
  recording: { key: 'recording_avg_score', window: 20 },
  copilot: { key: 'copilot_avg_score', window: 10 },
}

export class BunDataMigrationRepository implements MigrationDatabase {
  constructor(private readonly path: string) {}

  async exportPersonal(userId: string): Promise<Uint8Array | undefined> {
    try { await readFile(this.path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    const directory = await mkdtemp(join(tmpdir(), 'techspar-export-db-')); const destination = join(directory, 'interviews.db')
    const source = new Database(this.path, { readonly: true }); const target = new Database(destination, { create: true })
    try {
      for (const [table, spec] of Object.entries(TABLES)) {
        target.exec(spec.ddl)
        if (!exists(source, table)) continue
        const common = columns(source, table).filter((column) => columns(target, table).includes(column))
        if (!common.includes(spec.primary) || !common.includes('user_id')) throw new Error(`${table} 表缺少主键或 user_id，无法安全导出`)
        const rows = source.query<Record<string, unknown>, { $userId: string }>(`SELECT ${common.join(', ')} FROM ${table} WHERE user_id = $userId`).all({ $userId: userId })
        const insert = target.query(`INSERT INTO ${table} (${common.join(', ')}) VALUES (${common.map(() => '?').join(', ')})`)
        for (const row of rows) insert.run(...common.map((column) => row[column] as never))
      }
      target.exec('VACUUM')
      target.close(); source.close()
      return await readFile(destination)
    } finally { try { target.close() } catch {} try { source.close() } catch {} await rm(directory, { recursive: true, force: true }) }
  }

  async exportSystem(): Promise<Uint8Array | undefined> {
    try { await readFile(this.path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    const directory = await mkdtemp(join(tmpdir(), 'techspar-system-db-')); const destination = join(directory, 'interviews.db')
    const source = new Database(this.path, { readonly: true })
    try { source.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); source.close(); return await readFile(destination) }
    finally { try { source.close() } catch {} await rm(directory, { recursive: true, force: true }) }
  }

  async importPersonal(bytes: Uint8Array, userId: string, strategy: 'skip' | 'overwrite') {
    const directory = await mkdtemp(join(tmpdir(), 'techspar-import-db-')); const sourcePath = join(directory, 'interviews.db'); await Bun.write(sourcePath, bytes)
    const source = new Database(sourcePath, { readonly: true }); const target = new Database(this.path, { create: true }); target.exec('PRAGMA journal_mode = WAL'); target.exec('PRAGMA busy_timeout = 5000')
    let inserted = 0; let skipped = 0
    try {
      target.transaction(() => {
        for (const [table, spec] of Object.entries(TABLES)) {
          target.exec(spec.ddl)
          if (!exists(source, table)) continue
          if (table === 'copilot_realtime_sessions') {
            for (const column of ['review_session_id', 'review_claimed_at']) {
              if (!columns(target, table).includes(column)) target.exec(`ALTER TABLE copilot_realtime_sessions ADD COLUMN ${column} TEXT`)
            }
          }
          const targetColumns = columns(target, table)
          const common = columns(source, table).filter((column) => targetColumns.includes(column))
          if (!common.includes(spec.primary) || !common.includes('user_id')) throw new Error(`${table} 表缺少主键或 user_id，无法合并`)
          const rows = source.query<Record<string, unknown>, []>(`SELECT ${common.join(', ')} FROM ${table}`).all()
          const insert = target.query(`INSERT INTO ${table} (${common.join(', ')}) VALUES (${common.map(() => '?').join(', ')})`)
          for (const sourceRow of rows) {
            const row: Record<string, unknown> = { ...sourceRow, user_id: userId }; const primaryValue = row[spec.primary]
            const current = target.query<{ user_id: string }, { $primary: string }>(`SELECT user_id FROM ${table} WHERE ${spec.primary} = $primary`).get({ $primary: String(primaryValue) })
            if (current) {
              if (current.user_id !== userId || strategy !== 'overwrite') { skipped += 1; continue }
              const setters = common.filter((column) => column !== spec.primary)
              target.query(`UPDATE ${table} SET ${setters.map((column) => `${column} = ?`).join(', ')} WHERE ${spec.primary} = ? AND user_id = ?`).run(...setters.map((column) => row[column] as never), primaryValue as never, userId)
              inserted += 1; continue
            }
            insert.run(...common.map((column) => row[column] as never)); inserted += 1
          }
        }
      })()
      return { inserted, skipped }
    } finally { source.close(); target.close(); await rm(directory, { recursive: true, force: true }) }
  }

  async rebuiltStats(userId: string): Promise<Record<string, unknown>> {
    const database = new Database(this.path, { create: true })
    try {
      if (!exists(database, 'sessions')) return { stats: {}, topic_counts: {} }
      const rows = database.query<{ session_id: string; mode: string; topic: string | null; scores: string; overall: string; created_at: string }, { $userId: string }>("SELECT session_id, mode, topic, scores, overall, created_at FROM sessions WHERE user_id = $userId AND (status = 'reviewed' OR (review IS NOT NULL AND review != '')) ORDER BY created_at, session_id").all({ $userId: userId })
      const counts: Record<string, number> = {}; const topics: Record<string, number> = {}; const history: Array<Record<string, unknown>> = []; let totalAnswers = 0
      for (const row of rows) {
        counts[row.mode] = (counts[row.mode] || 0) + 1; if (row.topic) topics[row.topic] = (topics[row.topic] || 0) + 1
        const scores = json<Array<Record<string, unknown>>>(row.scores, []); const values = scores.map((item) => numeric(item.score)).filter((value): value is number => value !== undefined); totalAnswers += values.length
        const overall = json<Record<string, unknown>>(row.overall, {}); const average = numeric(overall.avg_score) ?? (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : undefined)
        if (average !== undefined) history.push({ date: row.created_at.slice(0, 10), mode: row.mode, topic: row.topic, avg_score: average, session_id: row.session_id, ...(overall.dimension_scores && typeof overall.dimension_scores === 'object' ? { dimension_scores: overall.dimension_scores } : {}) })
      }
      const recent = history.slice(-30).map((item) => item.avg_score as number)
      const copilotSessions = counts.copilot || 0
      const modeAverages = Object.fromEntries(Object.entries(MODE_AVERAGES).flatMap(([mode, config]) => {
        const value = average(history.filter((item) => item.mode === mode).slice(-config.window).map((item) => item.avg_score as number))
        return value === undefined ? [] : [[config.key, value]]
      }))
      const dimensions = history.filter((item) => item.dimension_scores && typeof item.dimension_scores === 'object').slice(-5)
      const dimensionKeys = new Set(dimensions.flatMap((item) => Object.keys(item.dimension_scores as Record<string, unknown>)))
      const dimensionScores = Object.fromEntries([...dimensionKeys].flatMap((key) => {
        const value = average(dimensions.map((item) => numeric((item.dimension_scores as Record<string, unknown>)[key])).filter((item): item is number => item !== undefined))
        return value === undefined ? [] : [[key, value]]
      }))
      return { stats: {
        total_sessions: rows.length, total_answers: totalAnswers,
        resume_sessions: counts.resume || 0, drill_sessions: counts.topic_drill || 0, job_prep_sessions: counts.jd_prep || 0,
        recording_sessions: counts.recording || 0, copilot_sessions: copilotSessions, score_history: history,
        ...modeAverages, ...(recent.length ? { avg_score: average(recent) } : {}), ...(Object.keys(dimensionScores).length ? { dimension_scores: dimensionScores } : {}),
      }, topic_counts: topics }
    } finally { database.close() }
  }

  async invalidateDerivedData(userId: string): Promise<void> {
    const database = new Database(this.path, { create: true })
    try {
      if (exists(database, 'memory_vectors')) database.query('DELETE FROM memory_vectors WHERE user_id = $userId').run({ $userId: userId })
      if (exists(database, 'question_embeddings')) database.query('DELETE FROM question_embeddings WHERE user_id = $userId').run({ $userId: userId })
      if (exists(database, 'personal_documents')) database.query("UPDATE personal_documents SET status = 'needs_reindex', chunk_count = 0, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $userId").run({ $userId: userId })
    } finally { database.close() }
  }
}
