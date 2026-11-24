import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_MODEL,
  PLATFORM_PROVIDER,
  USER_PROVIDER,
  emptyEmbeddingSettings,
  emptyLlmSettings,
  type EmbeddingSettings,
  type LlmSettings,
  type PlatformProviderConfig,
  type ResolvedEmbeddingConfig,
  type ResolvedLlmConfig,
} from './model.ts'

export function normalizeEmbeddingApiBase(apiBase: string): string {
  const value = apiBase.trim().replace(/\/+$/, '')
  return value.replace(/\/embeddings$/i, '').replace(/\/+$/, '') || value
}

export function normalizeEmbeddingSettings(settings: EmbeddingSettings): EmbeddingSettings {
  const localModel = settings.local_model.trim()
  return {
    ...settings,
    api_base: normalizeEmbeddingApiBase(settings.api_base),
    local_model: localModel.toLocaleLowerCase() === 'baai/bge-m3' ? DEFAULT_EMBEDDING_MODEL : localModel,
    local_path: settings.local_path.trim(),
  }
}

export function embeddingModeOf(settings: EmbeddingSettings): 'api' | 'local' {
  if (settings.backend === 'api' || settings.backend === 'local') return settings.backend
  return settings.api_base || settings.api_key ? 'api' : 'local'
}

export function normalizeLlmSettings(settings?: Partial<LlmSettings>): LlmSettings {
  return {
    api_base: settings?.api_base || '',
    api_key: settings?.api_key || '',
    model: settings?.model || '',
    temperature: typeof settings?.temperature === 'number' ? settings.temperature : 0.7,
    compatibility: settings?.compatibility === 'deepseek' ? 'deepseek' : 'generic',
    reasoning_effort: settings?.reasoning_effort || '',
    use_platform: settings?.use_platform === true,
  }
}

/** 本部署有没有配共享 key。自托管一般没有,前端据此决定要不要显示来源选择。 */
export function platformLlmReady(platform: PlatformProviderConfig): boolean {
  return Boolean(platform.llm.api_key && platform.llm.model)
}

export function platformEmbeddingReady(platform: PlatformProviderConfig): boolean {
  return Boolean(platform.embedding.api_key && platform.embedding.api_model)
}

/**
 * 决定这次请求用谁的 key。
 *
 * 默认自己的 key 优先——填了就是想用它,不该再去烧部署方的额度。
 * `use_platform` 是显式反选:key 留着不删,但这一阵先走平台额度。
 * 两边都不可用时返回空配置,由调用方抛 ProviderNotConfigured。
 */
export function resolveLlmConfig(
  own: LlmSettings | undefined,
  platform: PlatformProviderConfig,
): ResolvedLlmConfig {
  const usePlatform = () => ({ ...normalizeLlmSettings({ ...platform.llm, temperature: 0.7 }), source: PLATFORM_PROVIDER })
  if (own?.use_platform && platformLlmReady(platform)) return usePlatform()
  if (own?.api_key && own.model) return { ...normalizeLlmSettings(own), source: USER_PROVIDER }
  if (platformLlmReady(platform)) return usePlatform()
  return { ...emptyLlmSettings(), source: USER_PROVIDER }
}

export function resolveEmbeddingConfig(
  own: EmbeddingSettings | undefined,
  platform: PlatformProviderConfig,
): ResolvedEmbeddingConfig {
  const configured = own && Boolean(own.api_key || own.local_model || own.local_path || own.backend === 'local')
  if (configured) return { ...normalizeEmbeddingSettings(own), source: USER_PROVIDER }
  if (platformEmbeddingReady(platform)) {
    return {
      ...emptyEmbeddingSettings(),
      backend: 'api',
      api_base: normalizeEmbeddingApiBase(platform.embedding.api_base),
      api_key: platform.embedding.api_key,
      api_model: platform.embedding.api_model,
      api_batch_size: DEFAULT_EMBEDDING_BATCH_SIZE,
      source: PLATFORM_PROVIDER,
    }
  }
  return { ...emptyEmbeddingSettings(), source: USER_PROVIDER }
}

export function embeddingTarget(settings: EmbeddingSettings): string {
  const normalized = normalizeEmbeddingSettings(settings)
  if (embeddingModeOf(normalized) === 'api') return normalized.api_model || DEFAULT_EMBEDDING_MODEL
  return normalized.local_path || normalized.local_model || DEFAULT_EMBEDDING_MODEL
}
