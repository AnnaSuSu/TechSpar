import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createBunWebSocket } from 'hono/bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CopilotRealtimeService, type CopilotDependencies, type CopilotRealtimeUseCases, type CopilotServerEvent, type RequestContext } from '@techspar/core'
import { CopilotServerEventSchema } from '@techspar/contracts/events'
import { BunCopilotRepository } from '@techspar/db'
import { boundaryApp } from '../../../tests-ts/contracts/test-app.ts'
import { dependencyStub } from '../../../tests-ts/contracts/real-service-harness.ts'
import { loadTextFixture } from '../../../tests-ts/contracts/fixture.ts'
import { ResponseContractError } from './http/response.ts'

const disposers: Array<() => void | Promise<void>> = []
afterEach(async () => { while (disposers.length) await disposers.pop()!() })

async function socketHarness(realtime: CopilotRealtimeUseCases, token = 'test-token') {
  const { upgradeWebSocket, websocket } = createBunWebSocket()
  const app = boundaryApp({ copilotRealtime: realtime, websocketUpgrade: upgradeWebSocket })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch, websocket })
  const origin = `http://127.0.0.1:${server.port}`
  disposers.push(async () => {
    // Bun 1.3.14 leaves stop()'s promise/pendingWebSockets counter unsettled
    // after server-initiated close (also reproducible without Hono). Verify the
    // actual shutdown instead: clients close first, then the listener refuses TCP.
    void server.stop(true)
    server.unref()
    await expect(fetch(origin)).rejects.toThrow()
  })
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/copilot/live-1?token=${token}`)
  const events: unknown[] = []
  const listeners = new Set<() => void>()
  let closeCode: number | undefined
  ws.addEventListener('message', (event) => { events.push(JSON.parse(String(event.data))); listeners.forEach((listener) => listener()) })
  ws.addEventListener('close', (event) => { closeCode = event.code; listeners.forEach((listener) => listener()) })
  disposers.push(async () => {
    if (ws.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test WebSocket did not close')), 2000)
      ws.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.close()
    })
  })
  await new Promise<void>((resolve, reject) => { ws.addEventListener('open', () => resolve(), { once: true }); ws.addEventListener('error', reject, { once: true }) })
  async function until(predicate: () => boolean) {
    if (predicate()) return
    await new Promise<void>((resolve, reject) => {
      const check = () => { if (predicate()) { clearTimeout(timer); listeners.delete(check); resolve() } }
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Timed out waiting for test WebSocket event')) }, 2000)
      listeners.add(check)
    })
  }
  return { ws, events, until, get closeCode() { return closeCode }, send(value: unknown) { ws.send(JSON.stringify(value)) } }
}

describe('Copilot contracts over real Bun WebSockets', () => {
  test('validates every outgoing event without changing its payload', async () => {
    const fixture = JSON.parse(await loadTextFixture('copilot/events.json')) as CopilotServerEvent[]
    const h = await socketHarness({ connect(_context, _id, emit) { return {
      async handle() { for (const event of fixture) await emit(event) }, audio() {}, async close() {},
    } } })
    h.send({ type: 'start', prep_id: 'ready' })
    await h.until(() => h.events.length === fixture.length)
    expect<unknown>(h.events).toEqual(fixture)
    for (const event of h.events) expect<unknown>(CopilotServerEventSchema.parse(event)).toEqual(event)
  })

  test('rejects unauthorized sockets and never creates a service connection', async () => {
    let connected = false
    const h = await socketHarness({ connect() { connected = true; throw new Error('must not connect') } }, 'invalid')
    await h.until(() => h.closeCode !== undefined)
    expect<unknown>(h.closeCode).toBe(1008)
    expect<unknown>(connected).toBeFalse()
    expect<unknown>(h.events).toEqual([])
  })

  test('routes binary PCM separately and validates client/error messages', async () => {
    const received: Uint8Array[] = []
    const messages: unknown[] = []
    const h = await socketHarness({ connect(_context, _id, emit) { return {
      audio(bytes) { if (bytes[0] === 255) throw new Error('合成音频错误'); received.push(bytes) },
      async handle(message) { messages.push(message); if (message.type === 'manual') throw new Error('合成业务错误'); await emit({ type: 'stopped' }) },
      async close() {},
    } } })
    h.ws.send(Uint8Array.from([1, 0, 2, 0]))
    h.ws.send(Uint8Array.from([255]))
    h.ws.send('{bad json')
    h.send({ type: 'unknown' })
    h.send({ type: 'candidate_response', text: 123 })
    h.send({ type: 'manual', text: '问题' })
    h.send({ type: 'stop' })
    await h.until(() => h.events.length === 6)
    expect<unknown>(received).toEqual([Uint8Array.from([1, 0, 2, 0])])
    expect<unknown>(messages).toEqual([{ type: 'manual', text: '问题' }, { type: 'stop' }])
    expect<unknown>(h.events).toEqual([{ type: 'error', message: '合成音频错误' }, ...[1, 2, 3].map(() => ({ type: 'error', message: 'Invalid message' })), { type: 'error', message: '合成业务错误' }, { type: 'stopped' }])
  })

  test('blocks bad primary output, sanitizes logs and closes/aborts exactly once', async () => {
    let closed = 0
    let context: RequestContext | undefined
    const logger = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const h = await socketHarness({ connect(ctx, _id, emit) {
        context = ctx
        return { async handle() {
          await emit({ type: 'answer_chunk', text: { secret: 'PRIVATE-DATA' } } as unknown as CopilotServerEvent)
          await emit({ type: 'started', session_id: 'must-not-send' })
        }, audio() {}, async close() { closed += 1 } }
      } })
      h.send({ type: 'start' })
      await h.until(() => h.closeCode !== undefined)
      expect<unknown>(h.events).toEqual([{ type: 'error', message: 'Internal Server Error' }])
      expect<unknown>(h.closeCode).toBe(1011)
      expect<unknown>(context?.signal.aborted).toBeTrue()
      expect<unknown>(closed).toBe(1)
      const error = logger.mock.calls[0]![0]
      expect<unknown>(error).toBeInstanceOf(ResponseContractError)
      expect<unknown>(JSON.stringify(error)).not.toContain('PRIVATE-DATA')
      expect<unknown>(JSON.stringify(error)).not.toContain('live-1')
    } finally { logger.mockRestore() }
  })

  test('drops malformed background updates while valid partial/extended updates and answers continue', async () => {
    const logger = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const h = await socketHarness({ connect(_context, _id, emit) { return {
        async handle() {
          await emit({ type: 'monitor_update', covered_topics: 1 } as unknown as CopilotServerEvent)
          await emit({ type: 'hr_profile_update', style: null } as unknown as CopilotServerEvent)
          await emit({ type: 'monitor_update', strategy_tip: '继续', custom: { preserved: true } })
          await emit({ type: 'answer_chunk', text: '有效回答' })
        }, audio() {}, async close() {},
      } } })
      h.send({ type: 'manual', text: '问题' })
      await h.until(() => h.events.length === 2)
      expect<unknown>(h.events).toEqual([{ type: 'monitor_update', strategy_tip: '继续', custom: { preserved: true } }, { type: 'answer_chunk', text: '有效回答' }])
      expect<unknown>(logger).toHaveBeenCalledTimes(2)
      expect<unknown>(h.closeCode).toBeUndefined()
    } finally { logger.mockRestore() }
  })

  test('aborts active work and prevents late emissions when the client disconnects', async () => {
    const closed = Promise.withResolvers<void>()
    let context: RequestContext | undefined
    let emitLate: ((event: CopilotServerEvent) => Promise<void>) | undefined
    const h = await socketHarness({ connect(ctx, _id, emit) {
      context = ctx; emitLate = emit
      return {
        async handle() {
          await emit({ type: 'progress', message: 'working' })
          await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }))
          await emit({ type: 'answer_chunk', text: 'must not send' })
        },
        audio() {}, async close() { closed.resolve() },
      }
    } })
    h.send({ type: 'start' })
    await h.until(() => h.events.length === 1)
    h.ws.close()
    await closed.promise
    await h.until(() => h.closeCode !== undefined)
    await emitLate!({ type: 'error', message: 'late callback' })
    expect(context?.signal.aborted).toBeTrue()
    expect(h.events).toEqual([{ type: 'progress', message: 'working' }])
  })

  test('real service matches every fixture, preserves roles and recovers the user conversation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'techspar-ws-contract-'))
    disposers.push(() => rm(directory, { recursive: true, force: true }))
    const repository = new BunCopilotRepository(join(directory, 'test.db'))
    repository.initialize()
    disposers.push(() => repository.close())
    await repository.createPrep({ prepId: 'ready', userId: 'user-a', company: '', position: '', jdText: '合成JD' })
    await repository.completePrep('ready', 'user-a', {
      question_strategy_tree: { nodes: {
        tech: { topic: 'TypeScript', intent: 'technical', sample_questions: ['事件循环'], recommended_points: ['调用栈'], children: ['child'], risk_level: 'danger' },
        child: { topic: '任务队列', sample_questions: ['解释微任务'] },
      } }, prep_hints: [{ node_id: 'tech', safe_talking_points: ['项目'], redirect_suggestion: '先讲项目' }],
    })
    let asr: Parameters<CopilotDependencies['asr']['create']>[0] | undefined
    let stops = 0
    const deps = dependencyStub<CopilotDependencies>({
      repository, voiceprint: undefined,
      embeddings: dependencyStub<CopilotDependencies['embeddings']>({ async embed(_context: RequestContext, texts: readonly string[]) { return texts.map(() => Float32Array.from([1, 0])) } }),
      settings: dependencyStub<CopilotDependencies['settings']>({ async loadProvider() { return { services: { dashscope_api_key: 'synthetic', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } } }),
      asr: { create(input) { asr = input; return { async start() {}, sendAudio() { return true }, async stop() { stops += 1 } } } },
      ai: {
        async complete(_context, messages) {
          // A model-supplied type must never override the event discriminator.
          return JSON.stringify(messages.some((message) => message.content.includes('分析 HR'))
            ? { type: 'error', style: '追问细节', focus: '项目', satisfaction_signals: '继续追问', advice: '给出证据' }
            : { type: 'error', phase: 'technical', last_answer_feedback: '有实例', covered_topics: ['项目'], uncovered_topics: ['并发'], strategy_tip: '保持结构化' })
        },
        async *stream() { yield '先讲结论'; yield '，再给例子。' },
      },
    })
    const service = new CopilotRealtimeService(deps)
    const h = await socketHarness(service)
    h.send({ type: 'start', prep_id: 'ready' })
    const has = (type: string) => h.events.some((event) => (event as { type: string }).type === type)
    await h.until(() => has('started') && has('answer_done'))
    // Warmup meta/done legitimately have no answer_chunk or copilot_update.
    expect<unknown>(has('answer_chunk')).toBeFalse()
    await asr!.onInterim('请介绍')
    await asr!.onFinal('请介绍一下项目', 'hr')
    await asr!.onFinal('我负责订单服务', 'candidate')
    await asr!.onFinal('再解释原理', 'hr')
    await asr!.onFinal('还有其他实例吗', 'hr')
    await asr!.onError('合成识别错误')
    h.send({ type: 'stop' })
    await h.until(() => has('stopped') && has('hr_profile_update'))
    const fixture = JSON.parse(await loadTextFixture('copilot/events.json')) as CopilotServerEvent[]
    for (const expected of fixture) {
      const actual = CopilotServerEventSchema.parse(h.events.find((event) => (event as { type: string }).type === expected.type))
      if (actual.type === 'answer_meta') { expect<unknown>(actual.first_token_ms).toBeNumber(); actual.first_token_ms = 0 }
      if (actual.type === 'answer_done') { expect<unknown>(actual.total_ms).toBeNumber(); actual.total_ms = 0 }
      expect<unknown>(actual).toEqual(expected)
    }
    expect<unknown>(h.events).toContainEqual({ type: 'asr_final', text: '我负责订单服务', role: 'candidate' })
    expect<unknown>(stops).toBe(1)
    expect<unknown>(await repository.loadSession('live-1', 'user-b')).toBeUndefined()
    h.ws.close()
    await h.until(() => h.closeCode !== undefined)
    const resumed = await socketHarness(service)
    resumed.send({ type: 'start', prep_id: 'ready' })
    await resumed.until(() => resumed.events.some((event) => (event as { type: string }).type === 'started'))
    const stored = await repository.loadSession('live-1', 'user-a')
    expect<unknown>(stored?.turn_count).toBe(3)
    expect<unknown>(stored?.conversation.map((turn) => turn.role)).toEqual(['hr', 'candidate', 'hr', 'hr'])
    await resumed.until(() => resumed.events.some((event) => (event as { type: string }).type === 'answer_done'))
    deps.ai.stream = async function* () { yield '部分回答'; throw new Error('ASR 触发的模型流错误') }
    await asr!.onFinal('新的问题', 'hr')
    await resumed.until(() => resumed.events.some((event) => (event as { message?: string }).message === 'ASR 触发的模型流错误'))
    expect(resumed.events).toContainEqual({ type: 'answer_chunk', text: '部分回答' })
    expect(resumed.events).toContainEqual(expect.objectContaining({ type: 'answer_done', chunk_count: 1 }))
    resumed.send({ type: 'stop' })
    await resumed.until(() => resumed.events.some((event) => (event as { type: string }).type === 'stopped'))
  })
})
