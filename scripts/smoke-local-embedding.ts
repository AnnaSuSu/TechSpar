import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const port = await new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close((error) => error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0))
  })
})
const root = await mkdtemp(join(tmpdir(), 'techspar-local-embedding-'))
const executable = join(process.cwd(), 'apps', 'desktop', 'resources', 'backend', process.platform === 'win32' ? 'techspar-api.exe' : 'techspar-api')
const onnxRuntime = join(process.cwd(), 'apps', 'desktop', 'resources', 'backend', 'onnxruntime')
const libraryEnvironment = process.platform === 'darwin'
  ? { DYLD_LIBRARY_PATH: [onnxRuntime, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':') }
  : process.platform === 'linux'
    ? { LD_LIBRARY_PATH: [onnxRuntime, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
    : { PATH: [onnxRuntime, process.env.PATH].filter(Boolean).join(';') }
const child = Bun.spawn([executable], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'inherit',
  env: {
    ...process.env,
    ...libraryEnvironment,
    HOST: '127.0.0.1',
    PORT: String(port),
    TECHSPAR_BASE_DIR: root,
    TECHSPAR_DATA_DIR: join(root, 'data'),
    DB_PATH: join(root, 'data', 'interviews.db'),
    TECHSPAR_MODEL_CACHE_DIR: join(root, 'models'),
    JWT_SECRET: 'local-embedding-smoke-jwt-secret-with-at-least-32-chars',
    VOICEPRINT_ENCRYPTION_KEY: 'local-embedding-smoke-voiceprint-key-with-32-chars',
    DEFAULT_EMAIL: 'admin@techspar.local',
    DEFAULT_PASSWORD: 'local-embedding-smoke-password',
    DEFAULT_NAME: 'Admin',
  },
})

try {
  const reader = child.stdout.getReader(); const decoder = new TextDecoder(); let buffer = ''
  for (;;) {
    const { done, value } = await reader.read(); if (done) throw new Error('Backend exited before readiness')
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop() || ''
    if (lines.some((line) => { try { return (JSON.parse(line) as { event?: string }).event === 'techspar:ready' } catch { return false } })) break
  }
  const origin = `http://127.0.0.1:${port}`
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@techspar.local', password: 'admin123' }) })
  if (!login.ok) throw new Error(`Login failed: ${login.status} ${await login.text()}`)
  const token = (await login.json() as { token: string }).token
  const model = process.env.TECHSPAR_SMOKE_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2'
  const probe = await fetch(`${origin}/api/settings/test-embedding`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend: 'local', api_base: '', api_key: '', api_model: '', local_model: model, local_path: '', api_batch_size: 10 }),
  })
  const result = await probe.json() as { ok?: boolean; error?: string }
  if (!probe.ok || !result.ok) throw new Error(`Local embedding probe failed: ${probe.status} ${result.error || JSON.stringify(result)}`)
  console.log(JSON.stringify({ event: 'techspar:local-embedding-smoke-ok', model }))
} finally {
  child.kill('SIGTERM')
  await child.exited
  await rm(root, { recursive: true, force: true })
}
