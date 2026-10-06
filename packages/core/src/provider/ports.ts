import type { IndexRebuildEvent } from './events.ts'
import type { RequestContext } from '../kernel/context.ts'
import type {
  ResolvedLlmConfig,
  ResolvedEmbeddingConfig,
  EmbeddingSettings,
  LlmSettings,
  ServiceSettings,
  SettingsView,
  TrainingSettings,
  ProviderSource,
} from './model.ts'

export type ChatReasoningEffort = 'none' | 'low' | 'high' | 'max'
export type ChatCompleteOptions = {
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  reasoningEffort?: ChatReasoningEffort
}
/** 一次调用的 token 消耗。cachedTokens 是 promptTokens 中命中缓存的部分。 */
export type ChatUsage = { promptTokens: number; completionTokens: number; cachedTokens: number }

export type ChatStreamOptions = {
  temperature?: number
  maxTokens?: number
  reasoningEffort?: ChatReasoningEffort
  /**
   * 流式结束时回调用量。
   *
   * 流式响应的 usage 只在最后一个分片里,拿不到就只能记 0——而流式恰恰是
   * 面试作答、Copilot 这些最贵的场景,记 0 等于让它免费无限量。
   */
  onUsage?: (usage: ChatUsage) => void
}

/** Options used by calls whose response is parsed as JSON. Providers may ignore provider-specific fields. */
export const STRUCTURED_CHAT_OPTIONS: ChatCompleteOptions = { jsonMode: true, reasoningEffort: 'low' }

export type StoredProviderSettings = {
  llm?: LlmSettings
  embedding?: EmbeddingSettings
  services: ServiceSettings
}

export interface ProviderSettingsRepository {
  loadProvider(userId: string): Promise<StoredProviderSettings>
  saveProvider(userId: string, value: StoredProviderSettings): Promise<void>
  loadTraining(userId: string): Promise<TrainingSettings>
  saveTraining(userId: string, value: TrainingSettings): Promise<void>
  loadLastReindexAt(userId: string): Promise<string>
  saveLastReindexAt(userId: string, value: string): Promise<void>
  loadSystem(): Promise<{ allow_registration: boolean } | undefined>
  saveSystem(value: { allow_registration: boolean }): Promise<void>
}

export interface VectorIndexControl {
  invalidateUser(userId: string): Promise<void>
  resetEmbeddingClient(userId: string): void
}

export interface SettingsUseCases {
  get(context: RequestContext): Promise<SettingsView>
  update(context: RequestContext, value: SettingsView): Promise<{ ok: true; embedding_changed: boolean }>
  llmSource(context: RequestContext): Promise<ProviderSource>
}

export interface SettingsOperationsUseCases {
  testLlm(context: RequestContext, value: LlmSettings): Promise<{ ok: boolean; error?: string }>
  testEmbedding(context: RequestContext, value: EmbeddingSettings): Promise<{ ok: boolean; error?: string }>
  rebuildIndex(context: RequestContext): AsyncIterable<IndexRebuildEvent>
}

export interface UsageRepository {
  initialize(): void
  record(input: { userId: string; source: ProviderSource; model: string; promptTokens: number; completionTokens: number; cachedTokens?: number }): Promise<void>
  platformCallsToday(userId: string): Promise<number>
  /** 今日平台 token 消耗(输入+输出),用于免费额度 */
  platformTokensToday(userId: string): Promise<number>
  /** 自某时刻起的平台 token 消耗,用于订阅期内的额度包 */
  platformTokensSince(userId: string, since: string): Promise<number>
}

export type QuotaUnit = 'token' | 'call'

export type QuotaWindow = 'day' | 'month' | 'subscription'

export type QuotaStatus = { source: ProviderSource; used: number; limit: number | null; unit: QuotaUnit; window: QuotaWindow }

export interface QuotaUseCases {
  check(userId: string | undefined, source: ProviderSource): Promise<void>
  status(userId: string, source: ProviderSource): Promise<QuotaStatus>
  record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number; cachedTokens?: number }): Promise<void>
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type ChatResult = { text: string; promptTokens: number; completionTokens: number; cachedTokens: number }

export interface ChatDriver {
  complete(messages: readonly ChatMessage[], signal: AbortSignal, options?: ChatCompleteOptions): Promise<ChatResult>
  stream(messages: readonly ChatMessage[], signal: AbortSignal, options?: ChatStreamOptions): AsyncIterable<string>
}

export interface ChatDriverFactory {
  create(config: ResolvedLlmConfig): ChatDriver
}

export interface TextGenerationUseCases {
  complete(context: RequestContext, messages: readonly ChatMessage[], options?: ChatCompleteOptions): Promise<string>
  stream(context: RequestContext, messages: readonly ChatMessage[], options?: ChatStreamOptions): AsyncIterable<string>
}

export interface EmbeddingDriver {
  embed(texts: readonly string[], signal: AbortSignal): Promise<readonly Float32Array[]>
}

export interface EmbeddingDriverFactory {
  create(config: ResolvedEmbeddingConfig): Promise<EmbeddingDriver>
}

export interface EmbeddingUseCases {
  embed(context: RequestContext, texts: readonly string[]): Promise<readonly Float32Array[]>
  signature(context: RequestContext): Promise<string>
  reset(userId?: string): void
}
