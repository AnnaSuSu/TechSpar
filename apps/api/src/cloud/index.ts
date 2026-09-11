import { BunUsageRepository, BunUserRepository } from '@techspar/db'
import type { Extensions } from '../extensions.ts'
import { AfdianClient } from './afdian.ts'
import { OrderRepository } from './orders.ts'
import { processOrder } from './process-order.ts'
import { CloudQuotaService } from './quota.ts'
import { registerCloudRoutes } from './routes.ts'
import { SubscriptionRepository } from './subscriptions.ts'

/** 对账间隔。webhook 是主路径,这里只兜漏投,不需要频繁。 */
const RECONCILE_MS = 10 * 60 * 1000

// quota 与 routes 由上游分两次调用,共用同一批实例,避免各自初始化两份表句柄。
let shared: { subscriptions: SubscriptionRepository; orders: OrderRepository; users: BunUserRepository; usage: BunUsageRepository } | undefined

function store(dbPath: string) {
  if (!shared) {
    const subscriptions = new SubscriptionRepository(dbPath)
    subscriptions.initialize()
    const orders = new OrderRepository(dbPath)
    orders.initialize()
    shared = { subscriptions, orders, users: new BunUserRepository(dbPath, ''), usage: new BunUsageRepository(dbPath) }
    startReconcile(shared)
  }
  return shared
}

/**
 * 定时把平台订单捞回来补漏。
 *
 * 爱发电文档明说服务器异常时不保证及时推送,只靠 webhook 会丢单;而丢的是
 * 已经收了钱的单,用户会来问为什么没生效。
 */
function startReconcile(deps: NonNullable<typeof shared>): void {
  const client = AfdianClient.fromEnv()
  if (!client) return
  const tick = async () => {
    try {
      const orders = await client.queryOrders(1)
      let granted = 0
      for (const order of orders) {
        const outcome = await processOrder(order, {
          orders: deps.orders,
          subscriptions: deps.subscriptions,
          usage: deps.usage,
          userExists: async (id) => !!(await deps.users.findById(id)),
        })
        if (outcome === 'granted') granted += 1
      }
      if (granted) console.log(JSON.stringify({ event: 'cloud:reconciled', granted }))
    } catch (error) {
      console.error('爱发电对账失败', error)
    }
  }
  setTimeout(() => void tick(), 30_000).unref?.()
  setInterval(() => void tick(), RECONCILE_MS).unref?.()
}

const extensions: Extensions = {
  quota: (base, context) => {
    const { subscriptions, usage } = store(context.dbPath)
    return new CloudQuotaService(base, usage, subscriptions, process.env.CLOUD_FREE_QUOTA_ENABLED === 'true')
  },
  routes: (app, context) => {
    const { subscriptions, orders, users, usage } = store(context.dbPath)
    registerCloudRoutes(app, {
      subscriptions,
      orders,
      usage,
      tokens: context.tokens,
      userExists: async (id) => !!(await users.findById(id)),
    })
  },
}

export default extensions
