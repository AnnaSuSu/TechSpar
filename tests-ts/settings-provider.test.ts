import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PLATFORM_PROVIDER,
  QuotaExceeded,
  QuotaService,
  SettingsOperationsService,
  SettingsService,
  USER_PROVIDER,
  DEFAULT_EMBEDDING_MODEL,
  embeddingTarget,
  normalizeEmbeddingSettings,
  resolveEmbeddingConfig,
  resolveLlmConfig,
  type PlatformProviderConfig,
  type UsageRepository,
  type UserRepository,
} from '@techspar/core'
import { FileProviderSettingsRepository } from '@techspar/platform'

const emptyPlatform: PlatformProviderConfig = {
  llm: { api_base: '', api_key: '', model: '' },
  embedding: { api_base: '', api_key: '', api_model: '' },
  dailyCallLimit: 0, tokenLimit: 0, tokenWindow: 'day' as const,
}

describe('provider resolution', () => {
  test('unconfigured users stay unconfigured without a platform fallback', () => {
    expect(resolveLlmConfig(undefined, emptyPlatform)).toMatchObject({ api_key: '', source: USER_PROVIDER })
  })

  test('platform fallback is used only when own config is incomplete', () => {
    const platform = { ...emptyPlatform, llm: { api_base: 'https://platform.test/v1', api_key: 'platform-key', model: 'platform-model' } }
    expect(resolveLlmConfig(undefined, platform).source).toBe(PLATFORM_PROVIDER)
    expect(resolveLlmConfig({ api_base: '', api_key: 'mine', model: '', temperature: 0.7, compatibility: 'generic', use_platform: false }, platform).source).toBe(PLATFORM_PROVIDER)
    expect(resolveLlmConfig({ api_base: '', api_key: 'mine', model: 'my-model', temperature: 0.7, compatibility: 'generic', use_platform: false }, platform).source).toBe(USER_PROVIDER)
  })

  test('opting into the platform keeps a complete own config from being used', () => {
    const platform = { ...emptyPlatform, llm: { api_base: 'https://platform.test/v1', api_key: 'platform-key', model: 'platform-model' } }
    const own = { api_base: '', api_key: 'mine', model: 'my-model', temperature: 0.7, compatibility: 'generic' as const, use_platform: true }
    expect(resolveLlmConfig(own, platform)).toMatchObject({ api_key: 'platform-key', source: PLATFORM_PROVIDER })
    // 自托管没有共享 key,勾了也只能回落到自己的,不能变成"未配置"
    expect(resolveLlmConfig(own, emptyPlatform)).toMatchObject({ api_key: 'mine', source: USER_PROVIDER })
  })

  test('explicit local embedding is never replaced by platform API', () => {
    const platform = { ...emptyPlatform, embedding: { api_base: 'https://platform.test/v1', api_key: 'key', api_model: 'model' } }
    const resolved = resolveEmbeddingConfig({ backend: 'local', api_base: '', api_key: '', api_model: '', local_model: '', local_path: '', api_batch_size: 10 }, platform)
    expect(resolved.backend).toBe('local')
    expect(resolved.source).toBe(USER_PROVIDER)
  })

  test('migrates the legacy Python bge-m3 identifier for local ONNX inference', () => {
    const legacy = { backend: 'local' as const, api_base: '', api_key: '', api_model: '', local_model: 'BAAI/bge-m3', local_path: '', api_batch_size: 10 }
    expect(normalizeEmbeddingSettings(legacy).local_model).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(resolveEmbeddingConfig(legacy, emptyPlatform).local_model).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(embeddingTarget(legacy)).toBe(DEFAULT_EMBEDDING_MODEL)
  })
})

describe('quota policy', () => {
  class MemoryUsage implements UsageRepository {
    calls = new Map<string, number>()
    tokens = new Map<string, number>()
    initialize(): void {}
    async record(input: { userId: string; source: 'user' | 'platform'; promptTokens?: number; completionTokens?: number }) {
      if (input.source !== PLATFORM_PROVIDER) return
      this.calls.set(input.userId, (this.calls.get(input.userId) || 0) + 1)
      const spent = (input.promptTokens || 0) + (input.completionTokens || 0)
      this.tokens.set(input.userId, (this.tokens.get(input.userId) || 0) + spent)
    }
    async platformCallsToday(userId: string) { return this.calls.get(userId) || 0 }
    async platformTokensToday(userId: string) { return this.tokens.get(userId) || 0 }
    async platformTokensSince(userId: string) { return this.tokens.get(userId) || 0 }
  }

  test('配了 token 上限就按 token 计,而不是次数', async () => {
    const repository = new MemoryUsage()
    const quota = new QuotaService(repository, { ...emptyPlatform, dailyCallLimit: 100, tokenLimit: 1000 })
    // 一次调用就烧掉整个 token 上限:按次数算远没到 100 次,按 token 算已经满了
    await quota.record({ userId: 'u1', source: PLATFORM_PROVIDER, promptTokens: 900, completionTokens: 100 })
    await expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toBeInstanceOf(QuotaExceeded)
    expect((await quota.status('u1', PLATFORM_PROVIDER)).unit).toBe('token')
  })

  test('limits platform calls per user but never own-key calls', async () => {
    const repository = new MemoryUsage()
    const quota = new QuotaService(repository, { ...emptyPlatform, dailyCallLimit: 1 })
    await quota.record({ userId: 'u1', source: PLATFORM_PROVIDER })
    await expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toBeInstanceOf(QuotaExceeded)
    await quota.check('u2', PLATFORM_PROVIDER)
    await quota.check('u1', USER_PROVIDER)
  })

  test('zero means unlimited and status uses null', async () => {
    const quota = new QuotaService(new MemoryUsage(), emptyPlatform)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect(await quota.status('u1', PLATFORM_PROVIDER)).toEqual({ source: PLATFORM_PROVIDER, used: 0, limit: null, unit: 'call', window: 'day' })
  })
})

describe('settings persistence', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })

  test('persists admin registration changes atomically and canonicalizes embedding base', async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-settings-'))
    const repository = new FileProviderSettingsRepository(join(root, 'data'))
    const users: UserRepository = {
      async findByEmail() { return undefined },
      async findById() { return { id: 'admin', email: 'admin@example.com', name: 'Admin', is_admin: true } },
      async create() { throw new Error('not used') },
      async updatePassword() {},
    }
    const registration = { allowRegistration: false }
    const service = new SettingsService(repository, users, { async invalidateUser() {}, resetEmbeddingClient() {} }, emptyPlatform, registration)
    const context = { requestId: 'test', userId: 'admin', signal: new AbortController().signal }
    const current = await service.get(context)
    current.system.allow_registration = true
    current.embedding = { ...current.embedding, backend: 'api', api_base: 'https://example.test/v1/embeddings/', api_key: 'key', api_model: 'model' }
    await service.update(context, current)

    expect(registration.allowRegistration).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'data', 'system_settings.json'), 'utf8'))).toEqual({ allow_registration: true })
    expect((await repository.loadProvider('admin')).embedding?.api_base).toBe('https://example.test/v1')
  })

  test('canonicalizes legacy local model ids while loading existing provider files', async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-settings-'))
    const data = join(root, 'data')
    const repository = new FileProviderSettingsRepository(data)
    await repository.saveProvider('legacy', {
      embedding: { backend: 'local', api_base: '', api_key: '', api_model: '', local_model: 'BAAI/bge-m3', local_path: '', api_batch_size: 10 },
      services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' },
    })
    expect((await repository.loadProvider('legacy')).embedding?.local_model).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(JSON.parse(await readFile(join(data, 'users/legacy/provider.json'), 'utf8')).embedding.local_model).toBe(DEFAULT_EMBEDDING_MODEL)
  })
})

describe('settings operations', () => {
  for (const questions of [
    [{ id: 1, question: '问题', difficulty: 3, focus_area: '知识点' }],
    [{ id: 1, question: '问题', difficulty: 3, focus_area: '知识点' }, { id: '1', question: '问题二', difficulty: 3, focus_area: '知识点' }],
    [{ id: 1, question: '问题', difficulty: 6, focus_area: '知识点' }, { id: 2, question: '问题二', difficulty: 3, focus_area: '知识点' }],
  ]) test(`rejects invalid probe questions ${JSON.stringify(questions)}`, async () => {
    const service = new SettingsOperationsService({
      chats: { create() { return { async complete() { return { text: JSON.stringify({ questions }), promptTokens: 1, completionTokens: 1 } }, async *stream() {} } } },
    } as never)
    expect(await service.testLlm({ requestId: 'test', userId: 'user', signal: new AbortController().signal }, { api_base: 'https://example.test/v1', api_key: 'synthetic', model: 'model', temperature: 0.2, compatibility: 'generic', use_platform: false })).toMatchObject({ ok: false })
  })

  test('tests submitted provider values without reading persisted settings', async () => {
    let llmConfig: Record<string, unknown> | undefined
    let llmMessages: Array<Record<string, unknown>> | undefined
    let llmOptions: Record<string, unknown> | undefined
    let embeddingConfig: Record<string, unknown> | undefined
    const service = new SettingsOperationsService({
      chats: { create(config: Record<string, unknown>) { llmConfig = config; return { async complete(messages: Array<Record<string, unknown>>, _signal: unknown, options: Record<string, unknown>) { llmMessages = messages; llmOptions = options; return { text: JSON.stringify({ questions: [{ id: 1, question: '闭包是什么？', difficulty: 2, focus_area: '闭包' }, { id: 2, question: '事件循环如何工作？', difficulty: 3, focus_area: '事件循环' }] }), promptTokens: 1, completionTokens: 1 } }, async *stream() {} } } },
      embeddingDrivers: { async create(config: Record<string, unknown>) { embeddingConfig = config; return { async embed() { return [Float32Array.from([1])] } } } },
      embeddings: {}, index: {}, vectors: {}, knowledge: {}, personal: {}, profile: {}, settings: {},
    } as never)
    const context = { requestId: 'test', userId: 'user', signal: new AbortController().signal }
    expect(await service.testLlm(context, { api_base: 'https://submitted.test/v1', api_key: 'submitted-key', model: 'submitted-model', temperature: 0.2, compatibility: 'deepseek', use_platform: false })).toEqual({ ok: true })
    expect(llmConfig).toMatchObject({ api_base: 'https://submitted.test/v1', api_key: 'submitted-key', model: 'submitted-model', source: USER_PROVIDER })
    expect(llmMessages?.map((message) => message.content).join('\n')).toContain('专项训练')
    expect(llmOptions).toEqual({ maxTokens: 4096, temperature: 0, jsonMode: true, reasoningEffort: 'low' })
    expect(await service.testEmbedding(context, { backend: 'local', api_base: '', api_key: '', api_model: '', local_model: 'Xenova/bge-m3', local_path: '', api_batch_size: 10 })).toEqual({ ok: true })
    expect(embeddingConfig).toMatchObject({ backend: 'local', local_model: 'Xenova/bge-m3', source: USER_PROVIDER })
  })

  test('rejects a truncated structured LLM probe even when the request itself succeeds', async () => {
    const service = new SettingsOperationsService({
      chats: { create() { return { async complete() { return { text: '[{"id":1,"question":"未闭合"', promptTokens: 1, completionTokens: 1 } }, async *stream() {} } } },
      embeddingDrivers: {}, embeddings: {}, index: {}, vectors: {}, knowledge: {}, personal: {}, profile: {}, settings: {},
    } as never)
    const context = { requestId: 'test', userId: 'user', signal: new AbortController().signal }

    expect(await service.testLlm(context, { api_base: 'https://submitted.test/v1', api_key: 'submitted-key', model: 'submitted-model', temperature: 0.2, compatibility: 'generic', use_platform: false })).toEqual({
      ok: false,
      error: '模型已连接，但未返回完整的专项训练结构化结果；请换用支持长文本 JSON 输出的模型。',
    })
  })

  test('streams rebuild progress and persists the completion time', async () => {
    const calls: string[] = []
    const service = new SettingsOperationsService({
      chats: {}, embeddingDrivers: {}, embeddings: { async embed(_context: unknown, texts: string[]) { return texts.map(() => Float32Array.from([1])) } },
      index: { async invalidateUser(id: string) { calls.push(`invalidate:${id}`) }, async rebuildTopic(_context: unknown, topic: string) { calls.push(`topic:${topic}`) }, resetEmbeddingClient() {} },
      vectors: { async replaceChunks(input: { chunkType: string }) { calls.push(`vectors:${input.chunkType}`) } },
      knowledge: { async loadTopics() { return { typescript: { name: 'TypeScript' } } } },
      personal: { async hasDocuments() { return false } },
      profile: { async get() { return { weak_points: [{ point: '事件循环', topic: 'runtime', improved: false, archived: false }] } } },
      settings: { async saveLastReindexAt(_id: string, value: string) { calls.push(`saved:${value}`) } },
    } as never)
    const events: Array<Record<string, unknown>> = []
    for await (const event of service.rebuildIndex({ requestId: 'test', userId: 'user', signal: new AbortController().signal })) events.push(event)
    expect(events.at(-1)).toMatchObject({ done: true, rebuilt: { weak_points: true, personal_documents: false, topics: ['typescript'] } })
    expect(calls).toContain('invalidate:user')
    expect(calls).toContain('vectors:weak_point')
    expect(calls).toContain('topic:typescript')
    expect(calls.some((value) => value.startsWith('saved:'))).toBe(true)
  })
})
