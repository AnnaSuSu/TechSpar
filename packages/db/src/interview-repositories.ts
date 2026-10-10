import { Database } from 'bun:sqlite'
import type {
  InterviewAnswer,
  InterviewMode,
  InterviewQuestion,
  InterviewSession,
  InterviewSessionRepository,
  ResumeInterviewState,
  ResumeInterviewStateRepository,
  SessionStatus,
  SessionSummary,
  TaskRecord,
  TaskRepository,
  TaskLease,
  TaskStatus,
} from '@techspar/core'

type SessionRow = {
  session_id: string
  mode: InterviewMode
  topic: string | null
  meta: string | null
  questions: string | null
  transcript: string | null
  scores: string | null
  weak_points: string | null
  overall: string | null
  reference_answers: string | null
  review: string | null
  status: SessionStatus | null
  review_error: string | null
  user_id: string | null
  created_at: string | null
  updated_at: string | null
}

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function asSession(row: SessionRow): InterviewSession {
  return {
    session_id: row.session_id,
    mode: row.mode,
    topic: row.topic,
    meta: json(row.meta, {}),
    questions: json(row.questions, []),
    transcript: json(row.transcript, []),
    scores: json(row.scores, []),
    weak_points: json(row.weak_points, []),
    overall: json(row.overall, {}),
    reference_answers: json(row.reference_answers, {}),
    review: row.review,
    status: row.status || 'ended',
    review_error: row.review_error,
    user_id: row.user_id || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  }
}

export class BunInterviewSessionRepository implements InterviewSessionRepository {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
    this.sqlite.exec('PRAGMA busy_timeout = 5000')
  }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS job_prep_operations (
        user_id TEXT NOT NULL, operation_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        owner TEXT NOT NULL, session_id TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_key)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        topic TEXT,
        meta TEXT DEFAULT '{}',
        questions TEXT DEFAULT '[]',
        transcript TEXT DEFAULT '[]',
        scores TEXT DEFAULT '[]',
        weak_points TEXT DEFAULT '[]',
        overall TEXT DEFAULT '{}',
        reference_answers TEXT DEFAULT '{}',
        review TEXT,
        status TEXT DEFAULT 'ongoing',
        review_error TEXT,
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_topic ON sessions(user_id, topic);
      CREATE TABLE IF NOT EXISTS resume_interview_state (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_resume_state_user ON resume_interview_state(user_id);
    `)
    const columns = new Set(this.sqlite.query<{ name: string }, []>('PRAGMA table_info(sessions)').all().map((row) => row.name))
    const additions: Array<[string, string]> = [
      ['questions', "TEXT DEFAULT '[]'"], ['overall', "TEXT DEFAULT '{}'"], ['user_id', 'TEXT'],
      ['meta', "TEXT DEFAULT '{}'"], ['reference_answers', "TEXT DEFAULT '{}'"],
      ['status', "TEXT DEFAULT 'ongoing'"], ['review_error', 'TEXT'],
    ]
    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        this.sqlite.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`)
        if (name === 'status') this.sqlite.exec("UPDATE sessions SET status = CASE WHEN review IS NOT NULL AND review != '' THEN 'reviewed' ELSE 'ended' END")
      }
    }
  }

  async claimJobPrep(input: { userId: string; key: string; fingerprint: string; owner: string }) {
    return this.sqlite.transaction(() => {
      const row = this.sqlite.query<{ fingerprint: string; session_id: string | null; updated_at: number }, [string, string]>(
        'SELECT fingerprint, session_id, updated_at FROM job_prep_operations WHERE user_id = ? AND operation_key = ?',
      ).get(input.userId, input.key)
      if (row?.fingerprint !== undefined && row.fingerprint !== input.fingerprint) return { state: 'conflict' as const }
      if (row?.session_id) return { state: 'done' as const, sessionId: row.session_id }
      if (row && row.updated_at > Date.now() - 120_000) return { state: 'busy' as const }
      this.sqlite.query(`INSERT INTO job_prep_operations (user_id, operation_key, fingerprint, owner, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, operation_key) DO UPDATE SET owner = excluded.owner, updated_at = excluded.updated_at`)
        .run(input.userId, input.key, input.fingerprint, input.owner, Date.now())
      return { state: 'claimed' as const }
    }).immediate()
  }

  async renewJobPrep(userId: string, key: string, owner: string): Promise<void> {
    this.sqlite.query('UPDATE job_prep_operations SET updated_at = ? WHERE user_id = ? AND operation_key = ? AND owner = ? AND session_id IS NULL').run(Date.now(), userId, key, owner)
  }

  async releaseJobPrep(userId: string, key: string, owner: string): Promise<void> {
    this.sqlite.query('DELETE FROM job_prep_operations WHERE user_id = ? AND operation_key = ? AND owner = ? AND session_id IS NULL').run(userId, key, owner)
  }

  async completeJobPrep(input: { userId: string; key: string; owner: string; sessionId: string; meta: Record<string, unknown>; questions: InterviewQuestion[]; existing: boolean }): Promise<boolean> {
    return this.sqlite.transaction(() => {
      const owned = this.sqlite.query('SELECT 1 FROM job_prep_operations WHERE user_id = ? AND operation_key = ? AND owner = ? AND session_id IS NULL').get(input.userId, input.key, input.owner)
      if (!owned) return false
      const status = input.questions.length ? 'ongoing' : 'prepared'
      if (input.existing) {
        const changed = this.sqlite.query(`UPDATE sessions SET questions = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE session_id = ? AND user_id = ? AND mode = 'jd_prep' AND status = 'prepared'`)
          .run(JSON.stringify(input.questions), status, input.sessionId, input.userId).changes
        if (!changed) return false
      } else {
        this.sqlite.query(`INSERT INTO sessions (session_id, user_id, mode, meta, questions, status) VALUES (?, ?, 'jd_prep', ?, ?, ?)`)
          .run(input.sessionId, input.userId, JSON.stringify(input.meta), JSON.stringify(input.questions), status)
      }
      this.sqlite.query('UPDATE job_prep_operations SET session_id = ?, updated_at = ? WHERE user_id = ? AND operation_key = ? AND owner = ?')
        .run(input.sessionId, Date.now(), input.userId, input.key, input.owner)
      return true
    }).immediate()
  }

  async create(input: { sessionId: string; userId: string; mode: InterviewMode; topic?: string; questions?: InterviewQuestion[]; meta?: Record<string, unknown> }): Promise<void> {
    this.sqlite.query(`INSERT INTO sessions (session_id, mode, topic, meta, questions, status, user_id) VALUES ($id, $mode, $topic, $meta, $questions, 'ongoing', $userId)`).run({
      $id: input.sessionId, $mode: input.mode, $topic: input.topic ?? null, $meta: JSON.stringify(input.meta || {}), $questions: JSON.stringify(input.questions || []), $userId: input.userId,
    })
  }

  async get(sessionId: string, userId: string): Promise<InterviewSession | undefined> {
    const row = this.sqlite.query<SessionRow, { $id: string; $userId: string }>('SELECT * FROM sessions WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId })
    return row ? asSession(row) : undefined
  }

  async appendMessage(sessionId: string, userId: string, role: 'user' | 'assistant', content: string): Promise<boolean> {
    const transaction = this.sqlite.transaction(() => {
      const row = this.sqlite.query<{ transcript: string | null }, { $id: string; $userId: string }>('SELECT transcript FROM sessions WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId })
      if (!row) return false
      const transcript = json<Array<Record<string, unknown>>>(row.transcript, [])
      transcript.push({ role, content, time: new Date().toISOString() })
      this.sqlite.query('UPDATE sessions SET transcript = $transcript, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $transcript: JSON.stringify(transcript), $id: sessionId, $userId: userId })
      return true
    })
    return transaction()
  }

  async saveQuestions(sessionId: string, userId: string, questions: InterviewQuestion[]): Promise<boolean> {
    return this.sqlite.query('UPDATE sessions SET questions = $questions, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $questions: JSON.stringify(questions), $id: sessionId, $userId: userId }).changes > 0
  }

  async saveAnswers(sessionId: string, userId: string, answers: InterviewAnswer[]): Promise<boolean> {
    const transaction = this.sqlite.transaction(() => {
      const row = this.sqlite.query<{ questions: string | null }, { $id: string; $userId: string }>('SELECT questions FROM sessions WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId })
      if (!row) return false
      const questions = json<InterviewQuestion[]>(row.questions, [])
      const answerMap = new Map(answers.map((answer) => [String(answer.question_id), answer.answer]))
      const now = new Date().toISOString()
      const transcript = questions.flatMap((question) => {
        const answer = answerMap.get(String(question.id)) || ''
        return [{ role: 'assistant', content: question.question, time: now }, ...(answer ? [{ role: 'user', content: answer, time: now }] : [])]
      })
      this.sqlite.query('UPDATE sessions SET transcript = $transcript, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $transcript: JSON.stringify(transcript), $id: sessionId, $userId: userId })
      return true
    })
    return transaction()
  }

  async updateStatus(sessionId: string, userId: string, status: SessionStatus, options?: { reviewError?: string; clearError?: boolean }): Promise<boolean> {
    const reviewError = options?.clearError ? null : options?.reviewError
    const result = reviewError !== undefined || options?.clearError
      ? this.sqlite.query('UPDATE sessions SET status = $status, review_error = $error, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $status: status, $error: reviewError ?? null, $id: sessionId, $userId: userId })
      : this.sqlite.query('UPDATE sessions SET status = $status, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $status: status, $id: sessionId, $userId: userId })
    return result.changes > 0
  }

  async saveReview(input: { sessionId: string; userId: string; review: string; scores?: Array<Record<string, unknown>>; weakPoints?: unknown[]; overall?: Record<string, unknown> }): Promise<boolean> {
    return this.sqlite.query(`UPDATE sessions SET review = $review, scores = $scores, weak_points = $weakPoints, overall = $overall, status = 'reviewed', review_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId`).run({
      $review: input.review, $scores: JSON.stringify(input.scores || []), $weakPoints: JSON.stringify(input.weakPoints || []), $overall: JSON.stringify(input.overall || {}), $id: input.sessionId, $userId: input.userId,
    }).changes > 0
  }

  async updateMeta(sessionId: string, userId: string, patch: Record<string, unknown>): Promise<boolean> {
    const transaction = this.sqlite.transaction(() => {
      const row = this.sqlite.query<{ meta: string | null }, { $id: string; $userId: string }>('SELECT meta FROM sessions WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId })
      if (!row) return false
      const before = json<Record<string, unknown>>(row.meta, {})
      const after = { ...before, ...patch }
      if (JSON.stringify(before) === JSON.stringify(after)) return false
      this.sqlite.query('UPDATE sessions SET meta = $meta, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $meta: JSON.stringify(after), $id: sessionId, $userId: userId })
      return true
    })
    return transaction()
  }

  async saveReferenceAnswer(sessionId: string, userId: string, questionId: string, answer: string): Promise<boolean> {
    const transaction = this.sqlite.transaction(() => {
      const row = this.sqlite.query<{ reference_answers: string | null }, { $id: string; $userId: string }>('SELECT reference_answers FROM sessions WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId })
      if (!row) return false
      const references = json<Record<string, string>>(row.reference_answers, {})
      references[questionId] = answer
      this.sqlite.query('UPDATE sessions SET reference_answers = $references, updated_at = CURRENT_TIMESTAMP WHERE session_id = $id AND user_id = $userId').run({ $references: JSON.stringify(references), $id: sessionId, $userId: userId })
      return true
    })
    return transaction()
  }

  async list(input: { userId: string; limit: number; offset: number; mode?: InterviewMode; topic?: string }): Promise<{ items: SessionSummary[]; total: number }> {
    const conditions = ["user_id = $userId", "(status != 'ongoing' OR transcript != '[]' OR (mode = 'jd_prep' AND questions != '[]'))"]
    if (input.mode) conditions.push('mode = $mode')
    if (input.topic) conditions.push('topic = $topic')
    const where = conditions.join(' AND ')
    const params = { $userId: input.userId, $mode: input.mode ?? null, $topic: input.topic ?? null, $limit: input.limit, $offset: input.offset }
    const total = this.sqlite.query<{ total: number }, typeof params>(`SELECT COUNT(*) AS total FROM sessions WHERE ${where}`).get(params)?.total || 0
    const rows = this.sqlite.query<Pick<SessionRow, 'session_id' | 'mode' | 'topic' | 'meta' | 'created_at' | 'overall' | 'status' | 'review_error'>, typeof params>(`SELECT session_id, mode, topic, meta, created_at, overall, status, review_error FROM sessions WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT $limit OFFSET $offset`).all(params)
    return { items: rows.map((row) => {
      const meta = json<Record<string, unknown>>(row.meta, {})
      delete meta.source_transcript
      const overall = json<Record<string, unknown>>(row.overall, {})
      return { session_id: row.session_id, mode: row.mode, topic: row.topic, meta, created_at: row.created_at || '', avg_score: typeof overall.avg_score === 'number' ? overall.avg_score : null, status: row.status || 'ended', review_error: row.review_error }
    }), total }
  }

  async delete(sessionId: string, userId: string): Promise<boolean> {
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.query('DELETE FROM resume_interview_state WHERE session_id = $id AND user_id = $userId').run({ $id: sessionId, $userId: userId })
      const hasTasks = this.sqlite.query<{ present: number }, []>("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()
      if (hasTasks) this.sqlite.query('DELETE FROM tasks WHERE task_id = $id AND user_id = $userId').run({ $id: sessionId, $userId: userId })
      return this.sqlite.query('DELETE FROM sessions WHERE session_id = $id AND user_id = $userId').run({ $id: sessionId, $userId: userId }).changes > 0
    })
    return transaction()
  }

  async topics(userId: string): Promise<string[]> {
    return this.sqlite.query<{ topic: string }, { $userId: string }>("SELECT DISTINCT topic FROM sessions WHERE topic IS NOT NULL AND status = 'reviewed' AND user_id = $userId ORDER BY topic").all({ $userId: userId }).map((row) => row.topic)
  }

  async recentQuestions(userId: string, topic: string, options?: { sessionLimit?: number; maxQuestions?: number }): Promise<string[]> {
    const rows = this.sqlite.query<{ questions: string | null }, { $userId: string; $topic: string; $limit: number }>('SELECT questions FROM sessions WHERE topic = $topic AND user_id = $userId ORDER BY created_at DESC, rowid DESC LIMIT $limit').all({ $userId: userId, $topic: topic, $limit: options?.sessionLimit ?? 5 })
    const output = rows.reverse().flatMap((row) => json<InterviewQuestion[]>(row.questions, []).map((question) => question.question).filter(Boolean))
    return output.slice(-(options?.maxQuestions ?? 20))
  }

  async reviewedByTopic(userId: string, topic: string, limit = 50): Promise<InterviewSession[]> {
    const rows = this.sqlite.query<SessionRow, { $userId: string; $topic: string; $limit: number }>("SELECT * FROM sessions WHERE topic = $topic AND user_id = $userId AND status = 'reviewed' ORDER BY created_at ASC LIMIT $limit").all({ $userId: userId, $topic: topic, $limit: limit })
    return rows.map(asSession)
  }

  async expireStaleReviewing(userId?: string, maxAgeSeconds = 300): Promise<number> {
    const threshold = new Date(Date.now() - maxAgeSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
    const result = userId
      ? this.sqlite.query("UPDATE sessions SET status = 'review_failed', review_error = '复盘生成超时，请重新生成', updated_at = CURRENT_TIMESTAMP WHERE status = 'reviewing' AND updated_at < $threshold AND user_id = $userId").run({ $threshold: threshold, $userId: userId })
      : this.sqlite.query("UPDATE sessions SET status = 'review_failed', review_error = '服务重启导致复盘中断，请重新生成', updated_at = CURRENT_TIMESTAMP WHERE status = 'reviewing'").run()
    return result.changes
  }

  close(): void { this.sqlite.close() }
}

export class BunResumeInterviewStateRepository implements ResumeInterviewStateRepository {
  private readonly sqlite: Database
  constructor(path: string) { this.sqlite = new Database(path, { create: true }); this.sqlite.exec('PRAGMA journal_mode = WAL'); this.sqlite.exec('PRAGMA busy_timeout = 5000') }
  initialize(): void { this.sqlite.exec('CREATE TABLE IF NOT EXISTS resume_interview_state (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE INDEX IF NOT EXISTS idx_resume_state_user ON resume_interview_state(user_id);') }
  async load(sessionId: string, userId: string): Promise<ResumeInterviewState | undefined> {
    const row = this.sqlite.query<{ state: string }, { $id: string; $userId: string }>('SELECT state FROM resume_interview_state WHERE session_id = $id AND user_id = $userId').get({ $id: sessionId, $userId: userId })
    return row ? json<ResumeInterviewState | undefined>(row.state, undefined) : undefined
  }
  async save(sessionId: string, userId: string, state: ResumeInterviewState): Promise<void> {
    const owner = this.sqlite.query<{ user_id: string }, { $id: string }>('SELECT user_id FROM resume_interview_state WHERE session_id = $id').get({ $id: sessionId })
    if (owner && owner.user_id !== userId) throw new Error('Resume interview state belongs to another user')
    this.sqlite.query(`INSERT INTO resume_interview_state (session_id, user_id, state, updated_at) VALUES ($id, $userId, $state, CURRENT_TIMESTAMP) ON CONFLICT(session_id) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP`).run({ $id: sessionId, $userId: userId, $state: JSON.stringify(state) })
  }
  async delete(sessionId: string, userId: string): Promise<void> { this.sqlite.query('DELETE FROM resume_interview_state WHERE session_id = $id AND user_id = $userId').run({ $id: sessionId, $userId: userId }) }
  close(): void { this.sqlite.close() }
}

type TaskRow = { task_id: string; user_id: string; type: string; status: TaskStatus; payload: string; result: string | null; error: string | null; attempts: number; lease_owner: string | null; lease_expires_at: string | null; created_at: string; updated_at: string }
function asTask(row: TaskRow): TaskRecord { return { ...row, payload: json(row.payload, {}), result: json<Record<string, unknown> | null>(row.result, null) } }

export class BunTaskRepository implements TaskRepository {
  private readonly sqlite: Database
  constructor(path: string, private readonly clock: () => Date = () => new Date()) { this.sqlite = new Database(path, { create: true }); this.sqlite.exec('PRAGMA journal_mode = WAL'); this.sqlite.exec('PRAGMA busy_timeout = 5000') }
  initialize(): void {
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS tasks (task_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (task_id, user_id)); CREATE INDEX IF NOT EXISTS idx_tasks_recoverable ON tasks(status, updated_at);`)
    const columns = new Set(this.sqlite.query<{ name: string }, []>('PRAGMA table_info(tasks)').all().map((row) => row.name))
    const additions: Array<[string, string]> = [['lease_owner', 'TEXT'], ['lease_expires_at', 'TEXT']]
    for (const [name, definition] of additions) {
      if (columns.has(name)) continue
      try { this.sqlite.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`) } catch (error) {
        const addedByAnotherInstance = this.sqlite.query<{ name: string }, []>('PRAGMA table_info(tasks)').all().some((row) => row.name === name)
        if (!addedByAnotherInstance) throw error
      }
    }
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(status, lease_expires_at)')
  }
  async upsert(input: { taskId: string; userId: string; type: string; payload: Record<string, unknown> }): Promise<TaskRecord> {
    const now = this.clock().toISOString()
    this.sqlite.query(`INSERT INTO tasks (task_id, user_id, type, status, payload, result, error, attempts, lease_owner, lease_expires_at, updated_at) VALUES ($id, $userId, $type, 'pending', $payload, NULL, NULL, 0, NULL, NULL, CURRENT_TIMESTAMP) ON CONFLICT(task_id, user_id) DO UPDATE SET type = excluded.type, status = 'pending', payload = excluded.payload, result = NULL, error = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE tasks.status != 'running' OR tasks.lease_expires_at IS NULL OR tasks.lease_expires_at <= $now`).run({ $id: input.taskId, $userId: input.userId, $type: input.type, $payload: JSON.stringify(input.payload), $now: now })
    return (await this.get(input.taskId, input.userId))!
  }
  async get(taskId: string, userId: string): Promise<TaskRecord | undefined> {
    const row = this.sqlite.query<TaskRow, { $id: string; $userId: string }>('SELECT * FROM tasks WHERE task_id = $id AND user_id = $userId').get({ $id: taskId, $userId: userId })
    return row ? asTask(row) : undefined
  }
  async claim(taskId: string, userId: string, lease: TaskLease): Promise<TaskRecord | undefined> {
    if (!lease.owner.trim() || !Number.isFinite(lease.durationMs) || lease.durationMs <= 0) throw new Error('Invalid task lease')
    const now = this.clock()
    const row = this.sqlite.query<TaskRow, { $id: string; $userId: string; $owner: string; $now: string; $expiresAt: string }>(`UPDATE tasks SET status = 'running', attempts = attempts + 1, error = NULL, lease_owner = $owner, lease_expires_at = $expiresAt, updated_at = CURRENT_TIMESTAMP WHERE task_id = $id AND user_id = $userId AND (status = 'pending' OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= $now))) RETURNING *`).get({ $id: taskId, $userId: userId, $owner: lease.owner, $now: now.toISOString(), $expiresAt: new Date(now.getTime() + lease.durationMs).toISOString() })
    return row ? asTask(row) : undefined
  }
  async renew(taskId: string, userId: string, lease: TaskLease): Promise<boolean> {
    if (!lease.owner.trim() || !Number.isFinite(lease.durationMs) || lease.durationMs <= 0) throw new Error('Invalid task lease')
    const now = this.clock(); const expiresAt = new Date(now.getTime() + lease.durationMs).toISOString()
    return this.sqlite.query("UPDATE tasks SET lease_expires_at = $expiresAt, updated_at = CURRENT_TIMESTAMP WHERE task_id = $id AND user_id = $userId AND status = 'running' AND lease_owner = $owner AND lease_expires_at > $now").run({ $expiresAt: expiresAt, $now: now.toISOString(), $id: taskId, $userId: userId, $owner: lease.owner }).changes > 0
  }
  async complete(taskId: string, userId: string, owner: string, result: Record<string, unknown> = {}): Promise<boolean> {
    return this.sqlite.query("UPDATE tasks SET status = 'done', result = $result, error = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE task_id = $id AND user_id = $userId AND status = 'running' AND lease_owner = $owner AND lease_expires_at > $now").run({ $result: JSON.stringify(result), $now: this.clock().toISOString(), $id: taskId, $userId: userId, $owner: owner }).changes > 0
  }
  async fail(taskId: string, userId: string, owner: string, error: string): Promise<boolean> {
    return this.sqlite.query("UPDATE tasks SET status = 'error', error = $error, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE task_id = $id AND user_id = $userId AND status = 'running' AND lease_owner = $owner AND lease_expires_at > $now").run({ $error: error, $now: this.clock().toISOString(), $id: taskId, $userId: userId, $owner: owner }).changes > 0
  }
  async recoverable(): Promise<TaskRecord[]> {
    return this.sqlite.query<TaskRow, { $now: string }>("SELECT * FROM tasks WHERE status = 'pending' OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= $now)) ORDER BY created_at ASC").all({ $now: this.clock().toISOString() }).map(asTask)
  }
  close(): void { this.sqlite.close() }
}
