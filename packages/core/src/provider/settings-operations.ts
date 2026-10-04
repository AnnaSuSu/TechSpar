import type { IndexRebuildEvent } from './events.ts'
import { AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { finiteNumber, identifier, record, requiredText, uniqueIds, StructuredOutputError } from '../kernel/structured-output.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { KnowledgeVectorRepository, KnowledgeStore } from '../knowledge/ports.ts'
import type { PersonalAgentUseCases } from '../personal-agent/ports.ts'
import type { ProfileUseCases } from '../profile/ports.ts'
import { embeddingModeOf, normalizeEmbeddingSettings } from './config.ts'
import { USER_PROVIDER, type EmbeddingSettings, type LlmSettings } from './model.ts'
import type { ChatDriverFactory, EmbeddingDriverFactory, ProviderSettingsRepository, SettingsOperationsUseCases, VectorIndexControl } from './ports.ts'

export interface TopicIndexRebuilder extends VectorIndexControl {
  rebuildTopic(context: RequestContext, topic: string): Promise<void>
}

function message(error: unknown): string {
  const value = error as { status?: number; name?: string; message?: string }
  if (value.status === 401 || value.name === 'AuthenticationError') return 'API Key 无效（认证失败）'
  if (value.status === 403 || value.name === 'PermissionDeniedError') return 'Key 无该模型权限或被拒绝访问'
  if (value.status === 404 || value.name === 'NotFoundError') return '模型不存在，或 Base URL 路径不正确'
  if (value.name === 'APIConnectionError' || value.name === 'FetchError') return '无法连接到 Base URL，请检查地址与网络'
  return String(value.message || error || '').replace(/\s+/g, ' ').slice(0, 300) || '连接失败'
}
function userId(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }

const LLM_PROBE_MESSAGES = [
  { role: 'system' as const, content: '你是专项训练出题引擎。只返回 JSON 对象，不要其他内容。' },
  { role: 'user' as const, content: '请生成 2 道 JavaScript 专项训练题，只返回严格 JSON 对象。格式必须是 {"questions":[{"id":1,"question":"题目","difficulty":3,"focus_area":"考察点"}]}，必须完整闭合。' },
]

function validateLlmProbe(text: string): void {
  try {
    const value = parseJsonResponse(text)
    const questions = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).questions)
        ? (value as { questions: unknown[] }).questions
        : undefined
    if (!questions || questions.length !== 2) throw new StructuredOutputError('must contain exactly two questions', 'questions')
    const parsed = questions.map((item, index) => {
      const question = record(item, `questions[${index}]`)
      const rawId = identifier(question.id, `questions[${index}].id`)
      requiredText(question.question, `questions[${index}].question`)
      requiredText(question.focus_area, `questions[${index}].focus_area`)
      finiteNumber(question.difficulty, `questions[${index}].difficulty`, 1, 5)
      return rawId
    })
    uniqueIds(parsed, 'questions.id')
  } catch (error) {
    throw new Error('模型已连接，但未返回完整的专项训练结构化结果；请换用支持长文本 JSON 输出的模型。', { cause: error })
  }
}

export class SettingsOperationsService implements SettingsOperationsUseCases {
  constructor(private readonly deps: {
    chats: ChatDriverFactory
    embeddingDrivers: EmbeddingDriverFactory
    embeddings: { embed(context: RequestContext, texts: readonly string[]): Promise<readonly Float32Array[]> }
    index: TopicIndexRebuilder
    vectors: KnowledgeVectorRepository
    knowledge: KnowledgeStore
    personal: PersonalAgentUseCases
    profile: ProfileUseCases
    settings: ProviderSettingsRepository
  }) {}

  async testLlm(context: RequestContext, value: LlmSettings): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!value.api_key.trim() || !value.model.trim()) throw new Error('请先填写必填字段')
      const probeOptions = value.compatibility === 'deepseek'
        ? { maxTokens: 4096, temperature: 0, jsonMode: true, reasoningEffort: 'low' as const }
        : { maxTokens: 2048, temperature: 0 }
      const result = await this.deps.chats.create({ ...value, source: USER_PROVIDER }).complete(LLM_PROBE_MESSAGES, context.signal, probeOptions)
      validateLlmProbe(result.text)
      return { ok: true }
    } catch (error) { return { ok: false, error: message(error) } }
  }

  async testEmbedding(context: RequestContext, value: EmbeddingSettings): Promise<{ ok: boolean; error?: string }> {
    try {
      const config = normalizeEmbeddingSettings(value)
      const mode = embeddingModeOf(config)
      if (mode === 'api' && (!config.api_key.trim() || !config.api_model.trim())) throw new Error('请先填写必填字段')
      const driver = await this.deps.embeddingDrivers.create({ ...config, backend: mode, source: USER_PROVIDER })
      await driver.embed(['TechSpar embedding probe'], context.signal)
      return { ok: true }
    } catch (error) { return { ok: false, error: message(error) } }
  }

  async *rebuildIndex(context: RequestContext): AsyncIterable<IndexRebuildEvent> {
    const id = userId(context)
    try {
      const topics = await this.deps.knowledge.loadTopics(id)
      const plan: Array<[string, string]> = [['cleanup', '清理旧向量'], ['weak_points', '记忆 / 薄弱点']]
      if (await this.deps.personal.hasDocuments(context)) plan.push(['personal_documents', '个人资料库'])
      for (const [key, topic] of Object.entries(topics)) plan.push([`topic:${key}`, `知识库 · ${topic.name || key}`])
      const result: { weak_points: boolean; personal_documents: boolean; topics: string[] } = { weak_points: false, personal_documents: false, topics: [] }
      let completed = 0
      for (const [key, label] of plan) {
        yield { completed, total: plan.length, label, status: 'running' }
        try {
          if (key === 'cleanup') await this.deps.index.invalidateUser(id)
          else if (key === 'weak_points') {
            const profile = await this.deps.profile.get(context)
            const points = profile.weak_points.filter((point) => !point.improved && !point.archived).map((point) => `${point.topic || '综合'}: ${point.point}`)
            const vectors = points.length ? await this.deps.embeddings.embed(context, points) : []
            await this.deps.vectors.replaceChunks({ userId: id, chunkType: 'weak_point', chunks: points.map((content, index) => ({ content, source: 'profile.json', embedding: vectors[index]! })) })
            result.weak_points = true
          } else if (key === 'personal_documents') { await this.deps.personal.reindexAll(context); result.personal_documents = true }
          else if (key.startsWith('topic:')) { const topic = key.slice(6); await this.deps.index.rebuildTopic(context, topic); result.topics.push(topic) }
          completed += 1; yield { completed, total: plan.length, label, status: 'done' }
        } catch (error) { completed += 1; yield { completed, total: plan.length, label, status: 'error', error: error instanceof Error ? error.message : String(error) } }
      }
      const now = new Date().toISOString().slice(0, 19)
      await this.deps.settings.saveLastReindexAt(id, now)
      yield { done: true, rebuilt: result, last_rebuild_at: now }
    } catch (error) { yield { fatal: true, error: error instanceof Error ? error.message : String(error) } }
  }
}
