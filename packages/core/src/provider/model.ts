export const USER_PROVIDER = 'user' as const
export const PLATFORM_PROVIDER = 'platform' as const
// The upstream BAAI checkpoint does not ship the ONNX assets required by
// Transformers.js. This conversion keeps the same model while making local
// inference work in the TypeScript runtime.
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-m3'
export const DEFAULT_EMBEDDING_BATCH_SIZE = 10

export type ProviderSource = typeof USER_PROVIDER | typeof PLATFORM_PROVIDER

export type LlmCompatibility = 'generic' | 'deepseek'

export type LlmSettings = {
  api_base: string
  api_key: string
  model: string
  temperature: number
  compatibility: LlmCompatibility
  /** 显式选用部署方的共享 key。填了自己的 key 但仍想走平台额度时才需要它。 */
  use_platform: boolean
}

export type EmbeddingSettings = {
  backend: '' | 'api' | 'local'
  api_base: string
  api_key: string
  api_model: string
  local_model: string
  local_path: string
  api_batch_size: number
}

export type ServiceSettings = {
  dashscope_api_key: string
  /** Beijing Model Studio workspace; blank uses the shared Beijing endpoint. */
  dashscope_workspace_id?: string
  tavily_api_key: string
  oss_access_key_id: string
  oss_access_key_secret: string
  oss_bucket: string
  oss_endpoint: string
}

export type TrainingSettings = {
  num_questions: number
  divergence: number
}

export type SystemSettings = {
  allow_registration: boolean
}

export type ProviderStatus = { llm: boolean; embedding: boolean }

export type SettingsView = {
  llm: LlmSettings
  embedding: EmbeddingSettings
  services: ServiceSettings
  system: SystemSettings
  training: TrainingSettings
  is_admin: boolean
  /** 当前能不能用——自己的或平台的,任一可用即为 true。 */
  configured: ProviderStatus
  /** 本部署是否提供共享 key。自托管通常全 false,前端据此隐藏来源选择。 */
  platform: ProviderStatus
  /** 此刻实际在用谁的 key。用户判断"会不会消耗额度"只看这个。 */
  source: ProviderSource
  last_reindex_at: string
}

export type ResolvedLlmConfig = LlmSettings & { source: ProviderSource }
export type ResolvedEmbeddingConfig = EmbeddingSettings & { source: ProviderSource }

export const emptyLlmSettings = (): LlmSettings => ({ api_base: '', api_key: '', model: '', temperature: 0.7, compatibility: 'generic', use_platform: false })
export const emptyEmbeddingSettings = (): EmbeddingSettings => ({
  backend: '', api_base: '', api_key: '', api_model: '', local_model: '', local_path: '', api_batch_size: DEFAULT_EMBEDDING_BATCH_SIZE,
})
export const emptyServiceSettings = (): ServiceSettings => ({
  dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '',
})
export const defaultTrainingSettings = (): TrainingSettings => ({ num_questions: 10, divergence: 3 })

export type PlatformProviderConfig = {
  llm: Pick<LlmSettings, 'api_base' | 'api_key' | 'model'> & { compatibility?: LlmCompatibility }
  embedding: Pick<EmbeddingSettings, 'api_base' | 'api_key' | 'api_model'>
  dailyCallLimit: number
  /** token 上限,0 表示不启用;设了就优先于 dailyCallLimit */
  tokenLimit: number
  /** token 上限的计量窗口。按天算,一个白嫖用户一年能烧掉几十块;按月封顶才可控 */
  tokenWindow: 'day' | 'month'
}
