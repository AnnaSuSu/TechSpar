import type { RequestContext } from '../kernel/context.ts'
import { ProviderNotConfigured } from '../kernel/errors.ts'
import { resolveLlmConfig } from './config.ts'
import type { PlatformProviderConfig, ResolvedLlmConfig } from './model.ts'
import type {
  ChatDriverFactory,
  ChatMessage,
  ChatCompleteOptions,
  ChatStreamOptions,
  ProviderSettingsRepository,
  QuotaUseCases,
  TextGenerationUseCases,
} from './ports.ts'

export class AiService implements TextGenerationUseCases {
  constructor(
    private readonly settings: ProviderSettingsRepository,
    private readonly platform: PlatformProviderConfig,
    private readonly quota: QuotaUseCases,
    private readonly chats: ChatDriverFactory,
    private readonly configOverride?: ResolvedLlmConfig,
  ) {}

  private async resolved(context: RequestContext) {
    if (this.configOverride) {
      if (!this.configOverride.api_key || !this.configOverride.model) throw new ProviderNotConfigured('LLM')
      return this.configOverride
    }
    const stored = context.userId ? await this.settings.loadProvider(context.userId) : undefined
    const config = resolveLlmConfig(stored?.llm, this.platform)
    if (!config.api_key || !config.model) throw new ProviderNotConfigured('LLM')
    return config
  }

  async complete(
    context: RequestContext,
    messages: readonly ChatMessage[],
    options?: ChatCompleteOptions,
  ): Promise<string> {
    const config = await this.resolved(context)
    await this.quota.check(context.userId, config.source)
    const result = await this.chats.create(config).complete(messages, context.signal, options)
    await this.quota.record({
      userId: context.userId,
      source: config.source,
      model: config.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    })
    return result.text
  }

  async *stream(
    context: RequestContext,
    messages: readonly ChatMessage[],
    options?: ChatStreamOptions,
  ): AsyncIterable<string> {
    const config = await this.resolved(context)
    await this.quota.check(context.userId, config.source)
    // 流式的 usage 只在最后一个分片,靠回调兜住;中断时拿不到就记 0,
    // 但至少不会像以前那样整条流式路径全部不计量
    let usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
    try {
      yield* this.chats.create(config).stream(messages, context.signal, { ...options, onUsage: (value) => { usage = value } })
    } finally {
      await this.quota.record({ userId: context.userId, source: config.source, model: config.model, ...usage })
    }
  }
}
