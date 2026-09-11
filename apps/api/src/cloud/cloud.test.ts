import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { AppError, PLATFORM_PROVIDER, QuotaExceeded, USER_PROVIDER, type ProviderSource, type QuotaUseCases, type UsageRepository } from '@techspar/core'
import { JoseTokenService } from '@techspar/platform'
import { QuotaStatusSchema } from '@techspar/contracts'
import { verifyOrderSignature, type AfdianOrder } from './afdian.ts'
import { OrderRepository } from './orders.ts'
import { processOrder } from './process-order.ts'
import { CloudQuotaService } from './quota.ts'
import { registerCloudRoutes } from './routes.ts'
import { SubscriptionRepository } from './subscriptions.ts'
import { resetTierCache } from './tiers.ts'

const DAY = 86_400_000
const TIERS = [
  { key: 'basic', planId: 'plan-basic', label: '保持手感', price_cents: 990, token_quota: 1000 },
  { key: 'sprint', planId: 'plan-sprint', label: '全力冲刺', price_cents: 6990, token_quota: 0 },
  { key: 'tip', planId: 'plan-tip', label: '随意投喂', price_cents: 500, token_quota: 0, donation: true },
]

class StubUsage implements UsageRepository {
  constructor(public tokens = 0) {}
  initialize(): void {}
  async record(): Promise<void> {}
  async platformCallsToday(): Promise<number> { return 0 }
  async platformTokensToday(): Promise<number> { return this.tokens }
  async platformTokensSince(): Promise<number> { return this.tokens }
}

class StubBaseQuota implements QuotaUseCases {
  checked = 0
  async check(): Promise<void> { this.checked += 1 }
  async status(_userId: string, source: ProviderSource) { return { source, used: 0, limit: 20, unit: 'token' as const, window: 'month' as const } }
  async record(): Promise<void> {}
}

function order(overrides: Partial<AfdianOrder> = {}): AfdianOrder {
  return {
    out_trade_no: 'order-1', user_id: 'afdian-user', plan_id: 'plan-basic',
    custom_order_id: 'u1', month: 1, total_amount: '9.90', status: 2, ...overrides,
  }
}

let directory: string
let subscriptions: SubscriptionRepository
let orders: OrderRepository

beforeEach(() => {
  process.env.CLOUD_TIERS = JSON.stringify(TIERS)
  resetTierCache()
  directory = mkdtempSync(join(tmpdir(), 'techspar-cloud-'))
  subscriptions = new SubscriptionRepository(join(directory, 'test.db'))
  subscriptions.initialize()
  orders = new OrderRepository(join(directory, 'test.db'))
  orders.initialize()
})

afterEach(() => {
  subscriptions.close()
  orders.close()
  rmSync(directory, { recursive: true, force: true })
  delete process.env.CLOUD_TIERS
  resetTierCache()
})

describe('SubscriptionRepository', () => {
  test('未订阅时无档位', () => {
    expect(subscriptions.isActive('u1')).toBe(false)
    expect(subscriptions.activeTier('u1')).toBeNull()
    expect(subscriptions.status('u1').tier).toBeNull()
  })

  test('发放后生效并记录档位', () => {
    const expiry = subscriptions.grant('u1', 'basic')
    expect(subscriptions.activeTier('u1')?.key).toBe('basic')
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(29 * DAY)
    expect(subscriptions.status('u1').tier).toBe('basic')
  })

  test('按月份数折算时长', () => {
    const expiry = subscriptions.grant('u1', 'basic', 3)
    expect(Math.round((expiry.getTime() - Date.now()) / DAY)).toBe(90)
  })

  test('续费从原到期时间往后接,不从现在重算', () => {
    const first = subscriptions.grant('u1', 'basic')
    const second = subscriptions.grant('u1', 'basic')
    expect(second.getTime() - first.getTime()).toBe(30 * DAY)
  })

  test('换档位时剩余时间顺延,不清零', () => {
    const first = subscriptions.grant('u1', 'basic')
    const second = subscriptions.grant('u1', 'sprint')
    expect(second.getTime() - first.getTime()).toBe(30 * DAY)
    expect(subscriptions.activeTier('u1')?.key).toBe('sprint')
  })

  test('未知档位被拒', () => {
    expect(() => subscriptions.grant('u1', 'nope')).toThrow('unknown tier')
  })
})

describe('CloudQuotaService', () => {
  test('显式开启免费赠送时,未订阅用户委托给默认策略', async () => {
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(999), subscriptions, true)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect(base.checked).toBe(1)
    expect((await quota.status('u1', PLATFORM_PROVIDER)).limit).toBe(20)
  })

  test('默认不赠送免费额度,零用量用户也不能调用平台模型', async () => {
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(0), subscriptions)
    await expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toThrow('停止赠送免费额度')
    await expect(quota.check(undefined, PLATFORM_PROVIDER)).rejects.toThrow(QuotaExceeded)
    expect(base.checked).toBe(0)
    expect(QuotaStatusSchema.parse(await quota.status('u1', PLATFORM_PROVIDER))).toMatchObject({ source: PLATFORM_PROVIDER, used: 0, limit: 0 })
  })

  test('关闭免费赠送后,未订阅用户仍可使用自己的 Key', async () => {
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(0), subscriptions, false)
    await quota.check('u1', USER_PROVIDER)
    expect(base.checked).toBe(1)
    expect(await quota.status('u1', USER_PROVIDER)).toEqual(await base.status('u1', USER_PROVIDER))
  })

  test('关闭免费赠送后,有效订阅仍按原额度包计费', async () => {
    subscriptions.grant('u1', 'basic')
    const usage = new StubUsage(400)
    const quota = new CloudQuotaService(new StubBaseQuota(), usage, subscriptions, false)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect(await quota.status('u1', PLATFORM_PROVIDER)).toMatchObject({ used: 400, limit: 1000, window: 'subscription' })
    usage.tokens = 1000
    await expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toThrow('本期额度已用完')
  })

  test('关闭免费赠送后,订阅过期不能回落到免费额度', async () => {
    subscriptions.grant('u1', 'basic')
    const db = new Database(join(directory, 'test.db'))
    try {
      db.query('UPDATE cloud_subscriptions SET expires_at = ? WHERE user_id = ?').run(new Date(Date.now() - DAY).toISOString(), 'u1')
    } finally { db.close() }
    const quota = new CloudQuotaService(new StubBaseQuota(), new StubUsage(0), subscriptions, false)
    await expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toThrow('停止赠送免费额度')
    expect((await quota.status('u1', PLATFORM_PROVIDER)).limit).toBe(0)
  })

  test('非平台来源始终委托', async () => {
    subscriptions.grant('u1', 'basic')
    const base = new StubBaseQuota()
    await new CloudQuotaService(base, new StubUsage(999), subscriptions).check('u1', USER_PROVIDER)
    expect(base.checked).toBe(1)
  })

  test('按档位额度包计,烧完被拦', async () => {
    subscriptions.grant('u1', 'basic')
    const quota = new CloudQuotaService(new StubBaseQuota(), new StubUsage(1000), subscriptions)
    expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toThrow(QuotaExceeded)
    const status = await quota.status('u1', PLATFORM_PROVIDER)
    expect(status.limit).toBe(1000)
    expect(status.unit).toBe('token')
  })

  test('token_quota 为 0 的档位不限量', async () => {
    subscriptions.grant('u1', 'sprint')
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(10_000), subscriptions, false)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect(base.checked).toBe(0)
    expect((await quota.status('u1', PLATFORM_PROVIDER)).limit).toBeNull()
  })

  test('额度按订阅期起算,不看历史消耗', async () => {
    subscriptions.grant('u1', 'basic')
    // StubUsage 返回的是"自 periodStart 起"的量,未超额即放行
    const quota = new CloudQuotaService(new StubBaseQuota(), new StubUsage(400), subscriptions)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect((await quota.status('u1', PLATFORM_PROVIDER)).used).toBe(400)
  })
})

describe('processOrder', () => {
  const deps = () => ({ orders, subscriptions, usage: new StubUsage(), userExists: async (id: string) => id === 'u1' })

  test('正常订单发放订阅', async () => {
    expect(await processOrder(order(), deps())).toBe('granted')
    expect(subscriptions.activeTier('u1')?.key).toBe('basic')
  })

  test('重复推送不会二次延长有效期', async () => {
    await processOrder(order(), deps())
    const first = subscriptions.expiresAt('u1')!.getTime()
    expect(await processOrder(order(), deps())).toBe('already')
    expect(subscriptions.expiresAt('u1')!.getTime()).toBe(first)
  })

  test('认不出档位时不发放,留待人工', async () => {
    expect(await processOrder(order({ plan_id: 'unknown' }), deps())).toBe('unknown_plan')
    expect(subscriptions.isActive('u1')).toBe(false)
    expect(orders.pending()).toHaveLength(1)
  })

  test('对不上账号时不发放,留待人工', async () => {
    expect(await processOrder(order({ custom_order_id: 'ghost' }), deps())).toBe('unmatched')
    expect(orders.pending()).toHaveLength(1)
  })

  test('纯赞助档不发订阅,也不进待人工队列', async () => {
    expect(await processOrder(order({ plan_id: 'plan-tip' }), deps())).toBe('ignored')
    expect(subscriptions.isActive('u1')).toBe(false)
    expect(orders.pending()).toHaveLength(0)
  })

  test('非成功状态直接忽略', async () => {
    expect(await processOrder(order({ status: 1 }), deps())).toBe('ignored')
    expect(subscriptions.isActive('u1')).toBe(false)
  })

  test('续费重新给满额度,上期没用完的不累加', async () => {
    await processOrder(order(), deps())
    // 用掉 300 后再买一次,拿到的仍是一整期的 1000,不是 700 + 1000
    const renewed = { orders, subscriptions, usage: new StubUsage(300), userExists: async (id: string) => id === 'u1' }
    await processOrder(order({ out_trade_no: 'order-2' }), renewed)
    expect(subscriptions.active('u1')?.tokenQuota).toBe(1000)
  })

  test('按订单月份数发放', async () => {
    await processOrder(order({ month: 2 }), deps())
    expect(Math.round((subscriptions.expiresAt('u1')!.getTime() - Date.now()) / DAY)).toBe(60)
  })
})

describe('verifyOrderSignature', () => {
  test('缺签名一律拒绝', () => {
    expect(verifyOrderSignature(order(), undefined)).toBe(false)
    expect(verifyOrderSignature(order(), '')).toBe(false)
  })

  test('伪造签名被拒', () => {
    expect(verifyOrderSignature(order(), Buffer.from('forged').toString('base64'))).toBe(false)
  })
})

describe('cloud routes', () => {
  const tokens = new JoseTokenService('test-secret-for-cloud-routes')

  function testApp(): OpenAPIHono {
    const app = new OpenAPIHono()
    app.onError((error, c) => {
      if (error instanceof AppError) return c.json({ detail: error.message }, error.status as 400)
      throw error
    })
    registerCloudRoutes(app, { subscriptions, orders, usage: new StubUsage(), tokens, userExists: async (id) => id === 'u1' })
    return app
  }

  test('订阅状态需要登录', async () => {
    expect((await testApp().request('/api/cloud/subscription')).status).toBe(401)
  })

  test('登录后返回状态与档位', async () => {
    const token = await tokens.create('u1')
    const response = await testApp().request('/api/cloud/subscription', { headers: { authorization: `Bearer ${token}` } })
    const body = (await response.json()) as { active: boolean; plans: unknown[] }
    expect(response.status).toBe(200)
    expect(body.active).toBe(false)
    expect(body.plans).toHaveLength(2) // 纯赞助档不出现在付费墙里
  })

  test('webhook 拒绝无效签名且不发放', async () => {
    const response = await testApp().request('/api/cloud/afdian/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { type: 'order', order: order(), sign: 'forged' } }),
    })
    expect((await response.json() as { ec: number }).ec).toBe(403)
    expect(subscriptions.isActive('u1')).toBe(false)
  })

  test('webhook 拒绝非订单负载', async () => {
    const response = await testApp().request('/api/cloud/afdian/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { type: 'ping' } }),
    })
    expect((await response.json() as { ec: number }).ec).toBe(400)
  })

  test('没配 secret 时手动发放接口关闭', async () => {
    delete process.env.CLOUD_GRANT_SECRET
    const response = await testApp().request('/api/cloud/subscription/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'u1', plan: 'basic' }),
    })
    expect(response.status).toBe(404)
    expect(subscriptions.isActive('u1')).toBe(false)
  })

  test('凭据不对不发放', async () => {
    process.env.CLOUD_GRANT_SECRET = 'right'
    try {
      const response = await testApp().request('/api/cloud/subscription/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cloud-secret': 'wrong' },
        body: JSON.stringify({ user_id: 'u1', plan: 'basic' }),
      })
      expect(response.status).toBe(403)
      expect(subscriptions.isActive('u1')).toBe(false)
    } finally { delete process.env.CLOUD_GRANT_SECRET }
  })

  test('凭据正确则手动发放', async () => {
    process.env.CLOUD_GRANT_SECRET = 'right'
    try {
      const response = await testApp().request('/api/cloud/subscription/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cloud-secret': 'right' },
        body: JSON.stringify({ user_id: 'u1', plan: 'basic' }),
      })
      expect(response.status).toBe(200)
      expect(subscriptions.activeTier('u1')?.key).toBe('basic')
    } finally { delete process.env.CLOUD_GRANT_SECRET }
  })

  test('待处理订单接口同样需要凭据', async () => {
    process.env.CLOUD_GRANT_SECRET = 'right'
    try {
      expect((await testApp().request('/api/cloud/orders/pending')).status).toBe(403)
      const ok = await testApp().request('/api/cloud/orders/pending', { headers: { 'x-cloud-secret': 'right' } })
      expect(ok.status).toBe(200)
    } finally { delete process.env.CLOUD_GRANT_SECRET }
  })
})
