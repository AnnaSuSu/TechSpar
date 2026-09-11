import { PLATFORM_PROVIDER, QuotaExceeded, type ProviderSource, type QuotaStatus, type QuotaUseCases, type UsageRepository } from '@techspar/core'
import type { ActiveSubscription, SubscriptionRepository } from './subscriptions.ts'

/**
 * 订阅制配额策略,包装开源版默认实现。
 *
 * 订阅按 token 额度包计:买的是订阅期内可用的总量,而不是每日次数。按次数算
 * 与真实成本严重脱节——一次实时 Copilot 的上下文可能是普通问答的几十倍。
 *
 * 免费赠送开启时,未订阅用户委托给默认实现;关闭后仅有效订阅可用平台额度。
 * 用户自备 API Key 始终交回默认策略,不受免费赠送开关影响。
 */
export class CloudQuotaService implements QuotaUseCases {
  constructor(
    private readonly base: QuotaUseCases,
    private readonly usage: UsageRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly freeQuotaEnabled = false,
  ) {}

  /** 该用户当下生效的订阅;非平台来源或未订阅都返回 null。 */
  private active(userId: string | undefined, source: ProviderSource): ActiveSubscription | null {
    if (!userId || source !== PLATFORM_PROVIDER) return null
    return this.subscriptions.active(userId)
  }

  async check(userId: string | undefined, source: ProviderSource): Promise<void> {
    const active = this.active(userId, source)
    if (!active) {
      if (source === PLATFORM_PROVIDER && !this.freeQuotaEnabled) {
        throw new QuotaExceeded('平台已停止赠送免费额度。可以开通订阅，或在「设置」里填写自己的 API Key 继续使用。')
      }
      return this.base.check(userId, source)
    }
    if (active.tokenQuota <= 0) return
    const used = await this.usage.platformTokensSince(userId!, active.periodStart)
    if (used >= active.tokenQuota) {
      throw new QuotaExceeded('本期额度已用完。可以续费，或在「设置」里填自己的 API Key 继续免费使用。')
    }
  }

  async status(userId: string, source: ProviderSource): Promise<QuotaStatus> {
    const active = this.active(userId, source)
    if (!active) {
      const status = await this.base.status(userId, source)
      return source === PLATFORM_PROVIDER && !this.freeQuotaEnabled ? { ...status, limit: 0 } : status
    }
    return {
      source,
      used: await this.usage.platformTokensSince(userId, active.periodStart),
      limit: active.tokenQuota > 0 ? active.tokenQuota : null,
      unit: 'token',
      window: 'subscription',
    }
  }

  async record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number; cachedTokens?: number }): Promise<void> {
    return this.base.record(input)
  }
}
