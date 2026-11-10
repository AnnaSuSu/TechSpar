import type { AuthPolicy, UserRepository } from '../account/ports.ts'
import type { RequestContext } from '../kernel/context.ts'
import { AuthenticationError } from '../kernel/errors.ts'
import {
  embeddingTarget,
  normalizeLlmSettings,
  platformEmbeddingReady,
  platformLlmReady,
  resolveEmbeddingConfig,
  resolveLlmConfig,
} from './config.ts'
import {
  defaultTrainingSettings,
  emptyEmbeddingSettings,
  emptyServiceSettings,
  type PlatformProviderConfig,
  type SettingsView,
} from './model.ts'
import type { ProviderSettingsRepository, SettingsUseCases, VectorIndexControl } from './ports.ts'

export class SettingsService implements SettingsUseCases {
  constructor(
    private readonly repository: ProviderSettingsRepository,
    private readonly users: UserRepository,
    private readonly indexes: VectorIndexControl,
    private readonly platform: PlatformProviderConfig,
    private readonly registration: AuthPolicy,
  ) {}

  private userId(context: RequestContext): string {
    if (!context.userId) throw new AuthenticationError()
    return context.userId
  }

  async get(context: RequestContext): Promise<SettingsView> {
    const userId = this.userId(context)
    const [stored, training, lastReindexAt, user] = await Promise.all([
      this.repository.loadProvider(userId),
      this.repository.loadTraining(userId),
      this.repository.loadLastReindexAt(userId),
      this.users.findById(userId),
    ])
    const llm = normalizeLlmSettings(stored.llm)
    const embedding = stored.embedding || emptyEmbeddingSettings()
    const resolvedLlm = resolveLlmConfig(stored.llm, this.platform)
    const resolvedEmbedding = resolveEmbeddingConfig(stored.embedding, this.platform)
    return {
      llm,
      embedding,
      services: stored.services || emptyServiceSettings(),
      system: { allow_registration: this.registration.allowRegistration },
      training: training || defaultTrainingSettings(),
      is_admin: user?.is_admin || false,
      configured: {
        llm: Boolean(resolvedLlm.api_key && resolvedLlm.model),
        embedding: resolvedEmbedding.backend === 'local' || Boolean(resolvedEmbedding.api_key),
      },
      platform: { llm: platformLlmReady(this.platform), embedding: platformEmbeddingReady(this.platform) },
      source: resolvedLlm.source,
      last_reindex_at: lastReindexAt,
    }
  }

  async update(context: RequestContext, value: SettingsView): Promise<{ ok: true; embedding_changed: boolean }> {
    const userId = this.userId(context)
    const [stored, user] = await Promise.all([this.repository.loadProvider(userId), this.users.findById(userId)])
    const before = embeddingTarget(resolveEmbeddingConfig(stored.embedding, this.platform))
    const after = embeddingTarget(resolveEmbeddingConfig(value.embedding, this.platform))
    const embeddingChanged = before !== after
    // Keep the old provider active if invalidating its vectors fails.
    if (embeddingChanged) await this.indexes.invalidateUser(userId)
    await this.repository.saveProvider(userId, { llm: value.llm, embedding: value.embedding, services: value.services })
    this.indexes.resetEmbeddingClient(userId)
    if (user?.is_admin) {
      await this.repository.saveSystem(value.system)
      this.registration.allowRegistration = value.system.allow_registration
    }
    await this.repository.saveTraining(userId, value.training)
    return { ok: true, embedding_changed: embeddingChanged }
  }

  async llmSource(context: RequestContext) {
    const stored = await this.repository.loadProvider(this.userId(context))
    return resolveLlmConfig(stored.llm, this.platform).source
  }
}
