import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { MiddlewareHandler } from 'hono'
import { getConnInfo } from 'hono/bun'

const WINDOW_MS = 24 * 60 * 60 * 1000
const LIMIT = 5

function normalizeIp(value: string | undefined): string | undefined {
  if (!value || !isIP(value)) return undefined
  if (isIP(value) === 4) return value
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  // Bun may report IPv4 peers as IPv4-mapped IPv6 addresses.
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical)
  if (!mapped) return canonical
  const high = parseInt(mapped[1]!, 16)
  const low = parseInt(mapped[2]!, 16)
  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

export function registrationClientIp(peer: string | undefined, realIp: string | undefined, trustLoopbackProxy: boolean): string | undefined {
  const address = normalizeIp(peer)
  if (trustLoopbackProxy && (address === '127.0.0.1' || address === '::1')) return normalizeIp(realIp)
  return address
}

/** Persistent reservations prevent simultaneous requests from passing the same limit. */
export class RegistrationRateLimit {
  private readonly db: Database

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, { create: true })
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS registration_slots (
        id TEXT PRIMARY KEY,
        ip_hash TEXT NOT NULL,
        reserved_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS registration_slots_ip_time ON registration_slots(ip_hash, reserved_at);
      CREATE INDEX IF NOT EXISTS registration_slots_time ON registration_slots(reserved_at);
    `)
  }

  reserve(ip: string): { id: string } | { retryAfter: number } {
    const ipHash = createHash('sha256').update(ip).digest('hex')
    return this.db.transaction(() => {
      const now = this.now()
      this.db.query('DELETE FROM registration_slots WHERE reserved_at <= ?').run(now - WINDOW_MS)
      const row = this.db.query<{ count: number; oldest: number | null }, [string]>(
        'SELECT COUNT(*) AS count, MIN(reserved_at) AS oldest FROM registration_slots WHERE ip_hash = ?',
      ).get(ipHash)!
      if (row.count >= LIMIT) return { retryAfter: Math.max(1, Math.ceil((row.oldest! + WINDOW_MS - now) / 1000)) }
      const id = randomUUID()
      this.db.query('INSERT INTO registration_slots (id, ip_hash, reserved_at) VALUES (?, ?, ?)').run(id, ipHash, now)
      return { id }
    }).immediate()
  }

  release(id: string): void {
    this.db.query('DELETE FROM registration_slots WHERE id = ?').run(id)
  }

  close(): void { this.db.close() }
}

export function createRegistrationRateLimit(limiter: RegistrationRateLimit, trustLoopbackProxy = false): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'POST' || c.req.path !== '/api/auth/register') return next()
    const ip = registrationClientIp(getConnInfo(c).remote.address, c.req.header('X-Real-IP'), trustLoopbackProxy)
    if (!ip) return c.json({ detail: '暂时无法确认客户端地址，请稍后重试。' }, 503)
    const slot = limiter.reserve(ip)
    if ('retryAfter' in slot) {
      c.header('Retry-After', String(slot.retryAfter))
      return c.json({ detail: '同一 IP 在 24 小时内最多注册 5 个账号，请稍后再试。', code: 'registration_rate_limited' }, 429)
    }
    let succeeded = false
    try {
      await next()
      succeeded = c.res.status >= 200 && c.res.status < 300
    } finally {
      // Errors/validation failures do not use a slot. A process crash retains the
      // reservation until expiry, conservatively avoiding a restart bypass.
      if (!succeeded) limiter.release(slot.id)
    }
  }
}
