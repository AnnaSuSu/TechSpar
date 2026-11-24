import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError, type AuthUseCases } from '@techspar/core'
import { createApp, type AppDependencies } from '../app.ts'
import { createRegistrationRateLimit, RegistrationRateLimit, registrationClientIp } from './registration-rate-limit.ts'

const directories: string[] = []
const limiters: RegistrationRateLimit[] = []
afterEach(() => {
  for (const limiter of limiters.splice(0)) limiter.close()
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'techspar-registration-limit-'))
  directories.push(dir)
  return join(dir, 'limits.db')
}

function limiter(path = databasePath(), now?: () => number) {
  const result = new RegistrationRateLimit(path, now)
  limiters.push(result)
  return result
}

function fixture(options: { trustProxy?: boolean; path?: string; now?: () => number } = {}) {
  const quota = limiter(options.path, options.now)
  const emails = new Set<string>()
  const auth: AuthUseCases = {
    async register(email, _password, name) {
      await Promise.resolve() // exercise reservations while another request is in flight
      if (emails.has(email)) throw new AppError('Email already registered', 409)
      emails.add(email)
      return { token: 'test', user: { id: email, email, name, is_admin: false } }
    },
    async login(email) { return { token: 'test', user: { id: email, email, name: '', is_admin: false } } },
    async changePassword() { return { status: 'ok' } },
  }
  const app = createApp({
    auth, registration: { allowRegistration: true },
    registrationRateLimit: createRegistrationRateLimit(quota, options.trustProxy),
    tokens: { async create() { return 'test' }, async decode() { return undefined } },
    settings: {} as AppDependencies['settings'], quota: {} as AppDependencies['quota'],
    knowledge: {} as AppDependencies['knowledge'], resume: {} as AppDependencies['resume'],
  })
  const request = (email: string | null, peer = '192.0.2.1', headers: Record<string, string> = {}, path = '/api/auth/register') => app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email, password: 'test-password', name: '' }),
    }),
    { requestIP: () => peer ? { address: peer } : null },
  )
  return { request, emails, quota }
}

describe('registration IP limit', () => {
  test('allows five accounts, rejects the sixth, and leaves login and other IPs alone', async () => {
    const { request, emails } = fixture()
    for (let i = 0; i < 5; i++) expect((await request(`user${i}@example.com`)).status).toBe(200)
    const response = await request('sixth@example.com')
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('86400')
    expect((await response.json()).code).toBe('registration_rate_limited')
    expect(emails.size).toBe(5)
    expect((await request('other@example.com', '192.0.2.2')).status).toBe(200)
    expect((await request('user0@example.com', '192.0.2.1', {}, '/api/auth/login')).status).toBe(200)
  })

  test('validation and duplicate-email failures release their reservations', async () => {
    const { request } = fixture()
    expect((await request('first@example.com')).status).toBe(200)
    for (let i = 0; i < 6; i++) {
      expect((await request(null)).status).toBe(422)
      expect((await request('first@example.com')).status).toBe(409)
    }
    for (let i = 0; i < 4; i++) expect((await request(`next${i}@example.com`)).status).toBe(200)
    expect((await request('sixth@example.com')).status).toBe(429)
  })

  test('enforces the limit across concurrent requests and independent database connections', async () => {
    const path = databasePath()
    const a = fixture({ path })
    const b = fixture({ path })
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).request(`user${i}@example.com`)))
    expect(responses.filter((r) => r.status === 200)).toHaveLength(5)
    expect(responses.filter((r) => r.status === 429)).toHaveLength(15)
  })

  test('persists across reopening and uses a rolling 24-hour window', () => {
    const path = databasePath()
    let now = Date.UTC(2026, 9, 3, 15, 59)
    const first = new RegistrationRateLimit(path, () => now)
    for (let i = 0; i < 5; i++) expect(first.reserve('192.0.2.1')).toHaveProperty('id')
    first.close()
    const reopened = limiter(path, () => now)
    now += 2 * 60 * 1000 // crosses midnight in Beijing; must not reset
    expect(reopened.reserve('192.0.2.1')).toHaveProperty('retryAfter')
    now += 24 * 60 * 60 * 1000 - 2 * 60 * 1000 - 1
    expect(reopened.reserve('192.0.2.1')).toEqual({ retryAfter: 1 })
    now += 1
    expect(reopened.reserve('192.0.2.1')).toHaveProperty('id')
  })

  test('does not accept forged forwarding headers from an untrusted peer', async () => {
    const { request } = fixture({ trustProxy: true })
    for (let i = 0; i < 6; i++) {
      const response = await request(`user${i}@example.com`, '192.0.2.1', { 'x-real-ip': `198.51.100.${i + 1}`, 'x-forwarded-for': `198.51.100.${i + 1}` })
      expect(response.status).toBe(i < 5 ? 200 : 429)
    }
  })

  test('uses only the overwritten X-Real-IP from an explicitly trusted loopback proxy', async () => {
    const { request } = fixture({ trustProxy: true })
    for (let i = 0; i < 6; i++) {
      const response = await request(`user${i}@example.com`, '127.0.0.1', { 'x-real-ip': '192.0.2.1', 'x-forwarded-for': `198.51.100.${i + 1}` })
      expect(response.status).toBe(i < 5 ? 200 : 429)
    }
    expect((await request('other@example.com', '127.0.0.1', { 'x-real-ip': '192.0.2.2' })).status).toBe(200)
    expect((await request('missing@example.com', '127.0.0.1')).status).toBe(503)
    expect((await request('malformed@example.com', '127.0.0.1', { 'x-real-ip': '192.0.2.1, 192.0.2.2' })).status).toBe(503)
    expect((await request('unknown@example.com', '')).status).toBe(503)
  })

  test('canonicalizes IPv6 and mapped IPv4 without trusting headers by default', () => {
    expect(registrationClientIp('2001:0db8:0:0::1', undefined, false)).toBe('2001:db8::1')
    expect(registrationClientIp('::ffff:192.0.2.1', undefined, false)).toBe('192.0.2.1')
    expect(registrationClientIp('::ffff:c000:201', undefined, false)).toBe('192.0.2.1')
    expect(registrationClientIp('127.0.0.1', '192.0.2.1', false)).toBe('127.0.0.1')
    expect(registrationClientIp('::ffff:127.0.0.1', '192.0.2.1', true)).toBe('192.0.2.1')
  })
})
