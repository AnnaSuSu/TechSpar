import { Database } from 'bun:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { AuthUser, UserRepository } from '@techspar/core'
import { users } from './schema.ts'

function authUser(row: typeof users.$inferSelect, defaultEmail: string): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    is_admin: row.email === defaultEmail.toLowerCase().trim(),
  }
}

export class BunUserRepository implements UserRepository {
  private readonly sqlite: Database
  private readonly db: ReturnType<typeof drizzle>

  constructor(path: string, private readonly defaultEmail: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
    this.db = drizzle(this.sqlite)
  }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    const columns = new Set(this.sqlite.query<{ name: string }, []>('PRAGMA table_info(users)').all().map((row) => row.name))
    if (!columns.has('token_version')) {
      try { this.sqlite.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0') }
      catch (error) {
        const addedByAnotherInstance = this.sqlite.query<{ name: string }, []>('PRAGMA table_info(users)').all().some((row) => row.name === 'token_version')
        if (!addedByAnotherInstance) throw error
      }
    }
  }

  async findByEmail(email: string): Promise<(AuthUser & { password: string }) | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1)
    return row ? { ...authUser(row, this.defaultEmail), password: row.password } : undefined
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return row ? authUser(row, this.defaultEmail) : undefined
  }

  async tokenVersion(id: string): Promise<number | undefined> {
    const row = this.sqlite.query<{ token_version: number }, { $id: string }>('SELECT token_version FROM users WHERE id = $id').get({ $id: id })
    return row?.token_version
  }

  async create(input: { id: string; email: string; password: string; name: string }): Promise<AuthUser> {
    const normalized = input.email.toLowerCase().trim()
    await this.db.insert(users).values({ ...input, email: normalized })
    return { id: input.id, email: normalized, name: input.name, is_admin: normalized === this.defaultEmail.toLowerCase().trim() }
  }

  async updatePassword(id: string, password: string): Promise<void> {
    this.sqlite.query('UPDATE users SET password = $password, token_version = token_version + 1 WHERE id = $id').run({ $password: password, $id: id })
  }

  close(): void {
    this.sqlite.close()
  }
}

export * from './schema.ts'
export * from './usage-repository.ts'
export * from './knowledge-vector-repository.ts'
export * from './interview-repositories.ts'
export * from './personal-agent-repository.ts'
export * from './data-migration-repository.ts'
export * from './copilot-repository.ts'
