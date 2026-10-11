import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AuthService,
  ensureDefaultAccount,
  QuotaService,
  SettingsService,
  type AuthUser,
  type PlatformProviderConfig,
  type KnowledgeUseCases,
  type ResumeUseCases,
  type ProviderSettingsRepository,
  type StoredProviderSettings,
  type TrainingSettings,
  type UserRepository,
} from '@techspar/core'
import { createApp } from '../apps/api/src/app.ts'
import { LoginRateLimiter } from '../apps/api/src/http/login-rate-limiter.ts'
import { BcryptPasswordHasher, JoseTokenService, loadConfig, ShortUuidGenerator } from '@techspar/platform'
import { BunUserRepository } from '@techspar/db'
import rootPackage from '../package.json' with { type: 'json' }

class MemoryUsers implements UserRepository {
  rows = new Map<string, AuthUser & { password: string }>()
  tokenVersions = new Map<string, number>()
  async findByEmail(email: string) { return [...this.rows.values()].find((row) => row.email === email.toLowerCase().trim()) }
  async findById(id: string) { return this.rows.get(id) }
  async tokenVersion(id: string) { return this.rows.has(id) ? this.tokenVersions.get(id) ?? 0 : undefined }
  async create(input: { id: string; email: string; password: string; name: string }) {
    const user = { id: input.id, email: input.email.toLowerCase().trim(), name: input.name, is_admin: false }
    this.rows.set(user.id, { ...user, password: input.password })
    this.tokenVersions.set(user.id, 0)
    return user
  }
  async updatePassword(id: string, password: string) {
    const row = this.rows.get(id)
    if (row) this.rows.set(id, { ...row, password })
    if (row) this.tokenVersions.set(id, (this.tokenVersions.get(id) ?? 0) + 1)
  }
}

class MemorySettings implements ProviderSettingsRepository {
  async loadProvider(): Promise<StoredProviderSettings> { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }
  async saveProvider(): Promise<void> {}
  async loadTraining(): Promise<TrainingSettings> { return { num_questions: 10, divergence: 3 } }
  async saveTraining(): Promise<void> {}
  async loadLastReindexAt(): Promise<string> { return '' }
  async saveLastReindexAt(): Promise<void> {}
  async loadSystem() { return undefined }
  async saveSystem(): Promise<void> {}
}

const platform: PlatformProviderConfig = {
  llm: { api_base: '', api_key: '', model: '' },
  embedding: { api_base: '', api_key: '', api_model: '' },
  dailyCallLimit: 0, tokenLimit: 0, tokenWindow: 'day' as const,
}

function testApp(allowRegistration = false) {
  const users = new MemoryUsers()
  const config = loadConfig({ TECHSPAR_BASE_DIR: '/tmp/techspar-test', JWT_SECRET: 'test-jwt-secret-with-at-least-32-chars', VOICEPRINT_ENCRYPTION_KEY: 'test-voiceprint-key-with-at-least-32-chars', DEFAULT_PASSWORD: 'test-default-password', ALLOW_REGISTRATION: String(allowRegistration) })
  const passwords = new BcryptPasswordHasher()
  const tokens = new JoseTokenService(config.jwtSecret, Date.now, users)
  const registration = { allowRegistration }
  const auth = new AuthService(users, passwords, tokens, new ShortUuidGenerator(), registration)
  const settings = new SettingsService(new MemorySettings(), users, { async invalidateUser() {}, resetEmbeddingClient() {} }, platform, registration)
  const usage = { initialize() {}, async record() {}, async platformCallsToday() { return 0 }, async platformTokensToday() { return 0 }, async platformTokensSince() { return 0 } }
  return { users, config, passwords, app: createApp({ auth, registration, settings, quota: new QuotaService(usage, platform), tokens, knowledge: {} as KnowledgeUseCases, resume: {} as ResumeUseCases, loginLimiter: new LoginRateLimiter(2), trustProxy: true }) }
}

describe('auth compatibility', () => {
  test('returns only the verified token subject and rejects absent or forged tokens', async () => {
    const { app, users, passwords } = testApp();
    users.rows.set('user-b', { id: 'user-b', email: 'b@example.com', name: 'B', is_admin: false, password: await passwords.hash('secret') });
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'b@example.com', password: 'secret' }) });
    const { token } = await login.json() as { token: string };
    const response = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'user-b' });
    expect((await app.request('/api/auth/me')).status).toBe(401);
    const [header, payload] = token.split('.');
    const forged = `${header}.${Buffer.from(JSON.stringify({ sub: 'user-a' })).toString('base64url')}.${payload}`;
    expect((await app.request('/api/auth/me', { headers: { authorization: `Bearer ${forged}` } })).status).toBe(401);
  });

  test('reports registration flag and service version', async () => {
    const { app } = testApp()
    expect(await (await app.request('/api/auth/config')).json()).toEqual({ allow_registration: false })
    expect(await (await app.request('/api/')).json()).toEqual({ service: 'TechSpar', version: rootPackage.version })
  })

  test('does not grant arbitrary websites cross-origin access to the local API', async () => {
    const { app } = testApp()
    const response = await app.request('/api/auth/config', { headers: { origin: 'https://attacker.example' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('accepts an existing bcrypt password', async () => {
    const { app, users, passwords } = testApp()
    users.rows.set('legacy01', { id: 'legacy01', email: 'admin@example.com', name: 'Admin', is_admin: false, password: await passwords.hash('secret') })
    const response = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ADMIN@example.com', password: 'secret' }) })
    expect(response.status).toBe(200)
    expect((await response.json() as { user: AuthUser }).user.id).toBe('legacy01')
  })

  test('keeps FastAPI login error body', async () => {
    const { app } = testApp()
    const response = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }) })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ detail: 'Invalid email or password' })
  })

  test('limits repeated failed logins by client address and allows a different address', async () => {
    const { app, users, passwords } = testApp()
    users.rows.set('user01', { id: 'user01', email: 'user@example.com', name: 'User', is_admin: false, password: await passwords.hash('correct-password') })
    const attempt = (address: string, password: string) => app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': address }, body: JSON.stringify({ email: 'user@example.com', password }) })
    expect((await attempt('192.0.2.1', 'wrong')).status).toBe(401)
    expect((await attempt('192.0.2.1', 'wrong')).status).toBe(401)
    expect((await attempt('192.0.2.1', 'correct-password')).status).toBe(429)
    expect((await attempt('192.0.2.2', 'correct-password')).status).toBe(200)
  })

  test('changes an authenticated account password and rejects the old credential', async () => {
    const { app, users, passwords } = testApp()
    users.rows.set('user01', { id: 'user01', email: 'user@example.com', name: 'User', is_admin: false, password: await passwords.hash('old-password') })
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.com', password: 'old-password' }) })
    const token = (await login.json() as { token: string }).token
    const changed = await app.request('/api/auth/password', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: 'old-password', new_password: 'new-password-2026' }),
    })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toEqual({ status: 'ok' })
    expect((await app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
    expect((await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.com', password: 'old-password' }) })).status).toBe(401)
    expect((await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.com', password: 'new-password-2026' }) })).status).toBe(200)
  })

  test('requires authentication and a sufficiently strong new password', async () => {
    const { app } = testApp()
    const unauthorized = await app.request('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current_password: 'old-password', new_password: 'new-password' }) })
    expect(unauthorized.status).toBe(401)
    const invalid = await app.request('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' }, body: JSON.stringify({ current_password: 'old-password', new_password: 'short' }) })
    expect(invalid.status).toBe(422)
  })

  test('registration remains disabled by default', async () => {
    const { app } = testApp()
    const response = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@example.com', password: 'secret', name: '' }) })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'Registration is disabled' })
  })
})

describe('default account bootstrap', () => {
  test('creates a random-password desktop owner and rotates the former fixed password', async () => {
    const users = new MemoryUsers()
    const passwords = new BcryptPasswordHasher()
    const ids = { next: () => 'owner001' }
    const input = { email: 'admin@techspar.local', password: 'random-desktop-secret', name: 'Admin', rotateLegacyPassword: 'admin123' }

    expect(await ensureDefaultAccount(users, passwords, ids, input)).toBe('created')
    expect(await passwords.verify(input.password, users.rows.get('owner001')!.password)).toBe(true)

    users.rows.set('owner001', { ...users.rows.get('owner001')!, password: await passwords.hash('admin123') })
    expect(await ensureDefaultAccount(users, passwords, ids, input)).toBe('rotated')
    expect(await passwords.verify(input.password, users.rows.get('owner001')!.password)).toBe(true)
    expect(await ensureDefaultAccount(users, passwords, ids, input)).toBe('unchanged')
  })

  test('does not overwrite a custom existing password', async () => {
    const users = new MemoryUsers()
    const passwords = new BcryptPasswordHasher()
    users.rows.set('owner001', { id: 'owner001', email: 'admin@techspar.local', name: 'Admin', is_admin: true, password: await passwords.hash('my-custom-password') })
    const result = await ensureDefaultAccount(users, passwords, { next: () => 'unused' }, {
      email: 'admin@techspar.local', password: 'random-desktop-secret', name: 'Admin', rotateLegacyPassword: 'admin123',
    })
    expect(result).toBe('unchanged')
    expect(await passwords.verify('my-custom-password', users.rows.get('owner001')!.password)).toBe(true)
  })
})

test('upgrades existing users with token versions and invalidates JWTs after a password update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-user-token-version-'))
  const path = join(directory, 'users.db')
  try {
    const legacy = new Database(path, { create: true })
    legacy.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO users (id, email, password, name) VALUES ('user-a', 'a@example.com', 'old-hash', 'A')")
    legacy.close()

    const users = new BunUserRepository(path, 'admin@example.com')
    users.initialize()
    const tokens = new JoseTokenService('test-jwt-secret-with-at-least-32-chars', Date.now, users)
    const oldToken = await tokens.create('user-a')
    expect(await tokens.decode(oldToken)).toBe('user-a')
    expect(await users.tokenVersion('user-a')).toBe(0)
    await users.updatePassword('user-a', 'new-hash')
    expect(await users.tokenVersion('user-a')).toBe(1)
    expect(await tokens.decode(oldToken)).toBeUndefined()
    const newToken = await tokens.create('user-a')
    expect(await tokens.decode(newToken)).toBe('user-a')
    users.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
