import type { TaskRecord } from './model.ts'
import type { PersistentTaskDispatcher, TaskRepository } from './ports.ts'

export type TaskHandler = (task: TaskRecord) => Promise<Record<string, unknown> | undefined>

export type PersistentTaskQueueOptions = {
  owner?: string
  leaseDurationMs?: number
  heartbeatIntervalMs?: number
  recoveryIntervalMs?: number
}

export class PersistentTaskQueue implements PersistentTaskDispatcher {
  private readonly handlers = new Map<string, TaskHandler>()
  private readonly scheduled = new Set<string>()
  readonly owner: string
  private readonly leaseDurationMs: number
  private readonly heartbeatIntervalMs: number
  private readonly recoveryIntervalMs: number
  private recoveryTimer: ReturnType<typeof setInterval> | undefined
  private recovering = false

  constructor(private readonly repository: TaskRepository, options: PersistentTaskQueueOptions = {}) {
    this.owner = options.owner?.trim() || `task-worker:${globalThis.crypto.randomUUID()}`
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1, Math.floor(this.leaseDurationMs / 3))
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? Math.max(10, Math.floor(this.leaseDurationMs / 2))
    if (!Number.isFinite(this.leaseDurationMs) || this.leaseDurationMs <= 0) throw new Error('Task lease duration must be positive')
    if (!Number.isFinite(this.heartbeatIntervalMs) || this.heartbeatIntervalMs <= 0 || this.heartbeatIntervalMs >= this.leaseDurationMs) throw new Error('Task heartbeat interval must be positive and shorter than the lease')
    if (!Number.isFinite(this.recoveryIntervalMs) || this.recoveryIntervalMs <= 0) throw new Error('Task recovery interval must be positive')
  }

  register(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler)
  }

  async start(): Promise<void> {
    if (!this.recoveryTimer) {
      this.recoveryTimer = setInterval(() => void this.recover().catch(() => undefined), this.recoveryIntervalMs)
      const unref = this.recoveryTimer as unknown as { unref?: () => void }
      unref.unref?.()
    }
    await this.recover()
  }

  stop(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    this.recoveryTimer = undefined
  }

  private async recover(): Promise<void> {
    if (this.recovering) return
    this.recovering = true
    try {
      for (const task of await this.repository.recoverable()) this.schedule(task.task_id, task.user_id)
    } finally {
      this.recovering = false
    }
  }

  async enqueue(input: { taskId: string; userId: string; type: string; payload: Record<string, unknown> }): Promise<TaskRecord> {
    const task = await this.repository.upsert(input)
    this.schedule(task.task_id, task.user_id)
    return task
  }

  get(taskId: string, userId: string): Promise<TaskRecord | undefined> {
    return this.repository.get(taskId, userId)
  }

  private schedule(taskId: string, userId: string): void {
    const key = `${taskId}:${userId}`
    if (this.scheduled.has(key)) return
    this.scheduled.add(key)
    queueMicrotask(() => void this.run(taskId, userId, key))
  }

  private async run(taskId: string, userId: string, key: string): Promise<void> {
    let claimed = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const controller = new AbortController()
    let renewing: Promise<void> | undefined
    const stopHeartbeat = (): void => {
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = undefined
    }
    try {
      const lease = { owner: this.owner, durationMs: this.leaseDurationMs }
      const task = await this.repository.claim(taskId, userId, lease)
      if (!task) return
      claimed = true
      const assertActive = async (): Promise<void> => {
        controller.signal.throwIfAborted()
        if (!renewing) {
          renewing = this.repository.renew(taskId, userId, lease)
            .then((renewed) => { if (!renewed) throw new Error('Task lease was lost') })
            .catch((error) => { controller.abort(error); throw error })
            .finally(() => { renewing = undefined })
        }
        await renewing
        controller.signal.throwIfAborted()
      }
      heartbeat = setInterval(() => { void assertActive().catch(() => undefined) }, this.heartbeatIntervalMs)
      const unref = heartbeat as unknown as { unref?: () => void }
      unref.unref?.()
      const handler = this.handlers.get(task.type)
      if (!handler) throw new Error(`No task handler registered for ${task.type}`)
      const result = await handler({ ...task, signal: controller.signal, assertActive })
      await assertActive()
      stopHeartbeat()
      await this.repository.complete(taskId, userId, this.owner, result)
    } catch (error) {
      stopHeartbeat()
      if (claimed) await this.repository.fail(taskId, userId, this.owner, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500))
    } finally {
      stopHeartbeat()
      this.scheduled.delete(key)
    }
  }
}
