import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersistentTaskQueue } from '@techspar/core'
import { BunTaskRepository } from '@techspar/db'

const directories: string[] = []

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-task-queue-'))
  directories.push(directory)
  return join(directory, 'techspar.db')
}

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true })
})

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for task state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('persistent task queue leases', () => {
  test('migrates the legacy task table before claiming work', async () => {
    const path = await databasePath()
    const legacy = new Database(path, { create: true })
    legacy.exec("CREATE TABLE tasks (task_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (task_id, user_id))")
    legacy.close()

    const repository = new BunTaskRepository(path)
    repository.initialize()
    await repository.upsert({ taskId: 'legacy', userId: 'user-a', type: 'review', payload: {} })
    expect(await repository.claim('legacy', 'user-a', { owner: 'worker-a', durationMs: 1_000 })).toMatchObject({
      status: 'running',
      lease_owner: 'worker-a',
      attempts: 1,
    })
    expect((await repository.get('legacy', 'user-a'))?.lease_expires_at).toBeString()
    repository.close()
  })

  test('lets only one queue instance execute the same pending task', async () => {
    const path = await databasePath()
    const first = new BunTaskRepository(path)
    const second = new BunTaskRepository(path)
    first.initialize()
    second.initialize()
    await first.upsert({ taskId: 'contended', userId: 'user-a', type: 'review', payload: {} })

    const gate = deferred()
    let executions = 0
    const handler = async () => {
      executions += 1
      await gate.promise
      return { worker: 'winner' }
    }
    const firstQueue = new PersistentTaskQueue(first, { owner: 'worker-a', leaseDurationMs: 1_000, heartbeatIntervalMs: 100 })
    const secondQueue = new PersistentTaskQueue(second, { owner: 'worker-b', leaseDurationMs: 1_000, heartbeatIntervalMs: 100 })
    firstQueue.register('review', handler)
    secondQueue.register('review', handler)

    await Promise.all([firstQueue.start(), secondQueue.start()])
    await waitFor(() => executions === 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(executions).toBe(1)
    expect(await first.get('contended', 'user-a')).toMatchObject({ status: 'running', attempts: 1 })

    gate.resolve()
    await waitFor(async () => (await first.get('contended', 'user-a'))?.status === 'done')
    expect(await first.get('contended', 'user-a')).toMatchObject({ result: { worker: 'winner' }, attempts: 1 })
    firstQueue.stop()
    secondQueue.stop()
    first.close()
    second.close()
  })

  test('allows expired takeover and rejects completion or failure from the old owner', async () => {
    const path = await databasePath()
    let now = Date.UTC(2026, 7, 20, 0, 0, 0)
    const clock = () => new Date(now)
    const first = new BunTaskRepository(path, clock)
    const second = new BunTaskRepository(path, clock)
    first.initialize()
    second.initialize()
    await first.upsert({ taskId: 'takeover', userId: 'user-a', type: 'review', payload: {} })

    expect(await first.claim('takeover', 'user-a', { owner: 'old-worker', durationMs: 1_000 })).toMatchObject({ lease_owner: 'old-worker', attempts: 1 })
    expect(await second.claim('takeover', 'user-a', { owner: 'new-worker', durationMs: 1_000 })).toBeUndefined()
    now += 1_001
    expect((await second.recoverable()).map((task) => task.task_id)).toEqual(['takeover'])
    expect(await first.renew('takeover', 'user-a', { owner: 'old-worker', durationMs: 1_000 })).toBeFalse()
    expect(await first.complete('takeover', 'user-a', 'old-worker', { staleBeforeTakeover: true })).toBeFalse()
    expect(await second.claim('takeover', 'user-a', { owner: 'new-worker', durationMs: 1_000 })).toMatchObject({ lease_owner: 'new-worker', attempts: 2 })

    expect(await first.complete('takeover', 'user-a', 'old-worker', { stale: true })).toBeFalse()
    expect(await first.fail('takeover', 'user-a', 'old-worker', 'stale failure')).toBeFalse()
    expect(await second.complete('takeover', 'user-a', 'new-worker', { fresh: true })).toBeTrue()
    expect(await first.get('takeover', 'user-a')).toMatchObject({ status: 'done', result: { fresh: true }, error: null })
    first.close()
    second.close()
  })

  test('recovers pending and expired running tasks when a new queue starts', async () => {
    const path = await databasePath()
    let now = Date.UTC(2026, 7, 20, 0, 0, 0)
    const clock = () => new Date(now)
    const repository = new BunTaskRepository(path, clock)
    repository.initialize()
    await repository.upsert({ taskId: 'pending', userId: 'user-a', type: 'review', payload: {} })
    await repository.upsert({ taskId: 'expired', userId: 'user-a', type: 'review', payload: {} })
    await repository.claim('expired', 'user-a', { owner: 'dead-worker', durationMs: 1_000 })
    now += 1_001

    const queue = new PersistentTaskQueue(repository, { owner: 'replacement', leaseDurationMs: 1_000, heartbeatIntervalMs: 100 })
    queue.register('review', async (task) => ({ recovered: task.task_id }))
    await queue.start()
    await waitFor(async () => (await repository.get('pending', 'user-a'))?.status === 'done' && (await repository.get('expired', 'user-a'))?.status === 'done')

    expect(await repository.get('pending', 'user-a')).toMatchObject({ result: { recovered: 'pending' }, attempts: 1 })
    expect(await repository.get('expired', 'user-a')).toMatchObject({ result: { recovered: 'expired' }, attempts: 2 })
    queue.stop()
    repository.close()
  })

  test('takes over a dead worker after its lease expires while the replacement stays running', async () => {
    const path = await databasePath()
    let now = Date.UTC(2026, 7, 20, 0, 0, 0)
    const clock = () => new Date(now)
    const repository = new BunTaskRepository(path, clock)
    repository.initialize()
    await repository.upsert({ taskId: 'eventual-takeover', userId: 'user-a', type: 'review', payload: {} })
    await repository.claim('eventual-takeover', 'user-a', { owner: 'dead-worker', durationMs: 1_000 })

    const queue = new PersistentTaskQueue(repository, { owner: 'replacement', leaseDurationMs: 1_000, heartbeatIntervalMs: 100, recoveryIntervalMs: 10 })
    queue.register('review', async () => ({ recovered: true }))
    await queue.start()
    expect((await repository.get('eventual-takeover', 'user-a'))?.lease_owner).toBe('dead-worker')

    now += 1_001
    await waitFor(async () => (await repository.get('eventual-takeover', 'user-a'))?.status === 'done')
    expect(await repository.get('eventual-takeover', 'user-a')).toMatchObject({ attempts: 2, result: { recovered: true } })
    queue.stop()
    repository.close()
  })

  test('aborts the old handler when its lease expires and a replacement completes', async () => {
    const path = await databasePath()
    let now = Date.UTC(2026, 7, 20, 0, 0, 0)
    const clock = () => new Date(now)
    const firstRepo = new BunTaskRepository(path, clock)
    const secondRepo = new BunTaskRepository(path, clock)
    firstRepo.initialize(); secondRepo.initialize()
    await firstRepo.upsert({ taskId: 'lost-lease', userId: 'user-a', type: 'review', payload: {} })

    const gate = deferred()
    let oldSignal: AbortSignal | undefined
    const first = new PersistentTaskQueue(firstRepo, { owner: 'old-worker', leaseDurationMs: 100, heartbeatIntervalMs: 10 })
    const second = new PersistentTaskQueue(secondRepo, { owner: 'replacement', leaseDurationMs: 100, heartbeatIntervalMs: 10 })
    first.register('review', async (task) => { oldSignal = task.signal; await gate.promise; return { stale: true } })
    second.register('review', async () => ({ fresh: true }))
    await first.start()
    await waitFor(() => oldSignal !== undefined)

    now += 101
    await second.start()
    await waitFor(async () => (await secondRepo.get('lost-lease', 'user-a'))?.status === 'done')
    await waitFor(() => oldSignal!.aborted)
    gate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await firstRepo.get('lost-lease', 'user-a')).toMatchObject({ status: 'done', attempts: 2, result: { fresh: true } })

    first.stop(); second.stop(); firstRepo.close(); secondRepo.close()
  })

  test('renews the lease while a handler is still running', async () => {
    const path = await databasePath()
    const repository = new BunTaskRepository(path)
    const competitor = new BunTaskRepository(path)
    repository.initialize()
    competitor.initialize()
    await repository.upsert({ taskId: 'heartbeat', userId: 'user-a', type: 'review', payload: {} })

    const gate = deferred()
    const leaseDurationMs = 2_000
    const queue = new PersistentTaskQueue(repository, { owner: 'live-worker', leaseDurationMs, heartbeatIntervalMs: 100 })
    queue.register('review', async () => {
      await gate.promise
      return { ok: true }
    })
    await queue.start()
    await waitFor(async () => (await repository.get('heartbeat', 'user-a'))?.status === 'running')
    const initialExpiry = Date.parse((await repository.get('heartbeat', 'user-a'))!.lease_expires_at!)
    await waitFor(() => Date.now() > initialExpiry + 20, leaseDurationMs + 1_000)

    const renewed = await repository.get('heartbeat', 'user-a')
    expect(Date.parse(renewed!.lease_expires_at!)).toBeGreaterThan(initialExpiry)
    expect(Date.parse(renewed!.lease_expires_at!)).toBeGreaterThan(Date.now())
    expect(await competitor.claim('heartbeat', 'user-a', { owner: 'other-worker', durationMs: leaseDurationMs })).toBeUndefined()

    gate.resolve()
    await waitFor(async () => (await repository.get('heartbeat', 'user-a'))?.status === 'done')
    expect(await repository.get('heartbeat', 'user-a')).toMatchObject({ attempts: 1, result: { ok: true } })
    queue.stop()
    repository.close()
    competitor.close()
  })
})
