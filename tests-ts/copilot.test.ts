import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CopilotPrepService,
  CopilotRealtimeService,
  type CandidateProfilePort,
  type ChatMessage,
  type CopilotDependencies,
  type EmbeddingUseCases,
  type PersistentTaskDispatcher,
  type RequestContext,
  type TaskRecord,
  type TextGenerationUseCases,
} from '@techspar/core'
import { BunCopilotRepository } from '@techspar/db'

const directories: string[] = []
async function databasePath(): Promise<string> { const directory = await mkdtemp(join(tmpdir(), 'techspar-copilot-')); directories.push(directory); return join(directory, 'techspar.db') }
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })
const context: RequestContext = { requestId: 'copilot-test', userId: 'user-a', signal: new AbortController().signal }

class CopilotAi implements TextGenerationUseCases {
  async complete(_context: RequestContext, messages: readonly ChatMessage[]): Promise<string> {
    const prompt = messages.map((message) => message.content).join('\n')
    if (prompt.includes('面试情报分析师')) return JSON.stringify({ company_name: '示例', sources: ['https://example.test'] })
    if (prompt.includes('JD 分析引擎')) return JSON.stringify({ role_title: '后端工程师', required_skills: [{ skill: 'TypeScript' }], likely_question_dimensions: [] })
    if (prompt.includes('匹配分析引擎')) return JSON.stringify({ overall_fit: 0.7, highlights: [{ point: '服务端经验' }], gaps: [{ point: '并发控制', risk: 'high' }] })
    if (prompt.includes('面试策略引擎')) return JSON.stringify({ root_nodes: ['tech'], nodes: { tech: { id: 'tech', topic: 'TypeScript', sample_questions: ['解释事件循环'], intent: 'technical', depth: 0, risk_level: 'danger', children: [], recommended_points: ['先说调用栈'] } }, phase_order: ['technical'] })
    if (prompt.includes('风险评估引擎')) return JSON.stringify({ risk_summary: '并发是风险', risk_map: [{ node_id: 'tech', risk_level: 'danger' }], prep_hints: [{ node_id: 'tech', safe_talking_points: ['结合项目'], redirect_suggestion: '先讲可验证的项目实践' }] })
    return JSON.stringify({ phase: 'technical', strategy_tip: '保持结构化' })
  }
  async *stream(): AsyncIterable<string> { yield '先讲结论'; yield '，再给例子。' }
}

function dependencies(repository: BunCopilotRepository, tasks: PersistentTaskDispatcher, profileOverride?: CandidateProfilePort & { get?(context: RequestContext): Promise<Record<string, unknown>> }): CopilotDependencies {
  const profile = profileOverride || { async summary() { return '有后端经验' }, async targetRole() { return '' }, async updateTargetRole() {}, async get() { return { weak_points: [{ point: '并发控制' }] } } }
  const embeddings: EmbeddingUseCases = { async embed(_context, texts) { return texts.map(() => Float32Array.from([1, 0])) }, async signature() { return 'test' }, reset() {} }
  return {
    repository, tasks, ids: { next: () => 'prep-1' }, ai: new CopilotAi(), embeddings, profile,
    resume: { async status() { return { has_resume: false } }, async file() { throw new Error() }, async upload() { throw new Error() }, async delete() { throw new Error() }, async text() { return '做过订单服务' }, async parse() { throw new Error() }, async transcribe() { throw new Error() } },
    settings: { async loadProvider() { return { services: { dashscope_api_key: '', tavily_api_key: 'tv', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }, async saveProvider() {}, async loadTraining() { return { num_questions: 10, divergence: 3 } }, async saveTraining() {}, async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {} },
    search: { async search() { return [{ title: '示例', content: '工程信息', url: 'https://example.test' }] } },
    asr: { create() { return { async start() {}, sendAudio() { return true }, async stop() {} } } },
  }
}

function queued(input: { taskId: string; userId: string; type: string; payload: Record<string, unknown> }): TaskRecord { return { task_id: input.taskId, user_id: input.userId, type: input.type, status: 'pending', payload: input.payload, result: null, error: null, attempts: 0, created_at: '', updated_at: '' } }

describe('Copilot preparation', () => {
  test('persists the full JD, durable task, result, and predicted risk', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const dispatched: TaskRecord[] = []
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { const value = queued(input); dispatched.push(value); return value }, async get() { return undefined } }
    const predicted: string[] = []
    const profile = { async summary() { return '有后端经验' }, async targetRole() { return '' }, async updateTargetRole() {}, async get() { return { weak_points: [] } }, async addPredictedWeakPoints(input: { points: string[] }) { predicted.push(...input.points) } }
    const service = new CopilotPrepService(dependencies(repository, tasks, profile))
    const jd = '负责 TypeScript 服务端架构与高并发系统设计'.repeat(20)
    expect(await service.start(context, { jd_text: jd, company: '示例', position: '后端工程师' })).toEqual({ prep_id: 'prep-1' })
    expect((await repository.getPrep('prep-1', 'user-a'))?.jd_text).toBe(jd)
    await service.runPrepTask(dispatched[0]!)
    expect(await service.get(context, 'prep-1')).toMatchObject({ status: 'done', risk_summary: '并发是风险' })
    expect(await service.tree(context, 'prep-1')).toMatchObject({ root_nodes: ['tech'] })
    expect(predicted).toEqual(['并发控制'])
    expect(await repository.getPrep('prep-1', 'user-b')).toBeUndefined()
    repository.close()
  })
})

describe('Copilot realtime', () => {
  test('streams protocol events and restores conversation on reconnect', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    await repository.createPrep({ prepId: 'ready', userId: 'user-a', company: '', position: '', jdText: 'JD' })
    await repository.completePrep('ready', 'user-a', { question_strategy_tree: { root_nodes: ['tech'], nodes: { tech: { id: 'tech', topic: 'TypeScript', sample_questions: ['解释事件循环'], intent: 'technical', risk_level: 'danger', children: [], recommended_points: ['调用栈'] } }, phase_order: [] }, prep_hints: [{ node_id: 'tech', safe_talking_points: ['项目'], redirect_suggestion: '先讲项目' }], fit_report: { highlights: [{ point: '经验' }] }, profile: { weak_points: [] }, jd_analysis: { required_skills: [{ skill: 'TypeScript' }] } })
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return queued(input) }, async get() { return undefined } }
    const service = new CopilotRealtimeService(dependencies(repository, tasks))
    const events: Array<Record<string, unknown>> = []
    const connection = service.connect(context, 'live-1', async (event) => { events.push(event) })
    await connection.handle({ type: 'start', prep_id: 'ready' })
    await connection.handle({ type: 'manual', text: '请解释事件循环' })
    expect(events.some((event) => event.type === 'started')).toBeTrue()
    expect(events.some((event) => event.type === 'copilot_update' && event.tree_position === 'tech')).toBeTrue()
    expect(events.some((event) => event.type === 'risk_alert')).toBeTrue()
    expect(events.filter((event) => event.type === 'answer_chunk').map((event) => event.text).join('')).toContain('先讲结论')
    await connection.close()

    const resumed = service.connect(context, 'live-1', async () => {})
    await resumed.handle({ type: 'start', prep_id: 'ready' })
    await resumed.handle({ type: 'candidate_response', text: '我会结合任务队列解释' })
    expect(await repository.loadSession('live-1', 'user-a')).toMatchObject({ turn_count: 1, conversation: [{ role: 'hr' }, { role: 'candidate' }] })
    await resumed.close(); repository.close()
  })

  test('preserves unmatched negative confidence and null/empty strategy fields', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return queued(input) }, async get() { return undefined } }
    await repository.createPrep({ prepId: 'empty', userId: 'user-a', company: '', position: '', jdText: 'JD' })
    await repository.completePrep('empty', 'user-a', { question_strategy_tree: { nodes: {} } })
    const events: unknown[] = []
    const connection = new CopilotRealtimeService(dependencies(repository, tasks)).connect(context, 'unmatched', async (event) => { events.push(event) })
    try {
      await connection.handle({ type: 'start', prep_id: 'empty' })
      await connection.handle({ type: 'manual', text: '问题' })
      expect(events).toContainEqual({ type: 'copilot_update', intent: 'technical', tree_position: null, topic: '', confidence: -1, recommended_points: [], children: [], prep_hint: null })
      expect(events).toContainEqual({ type: 'progress', message: '未配置 DashScope API Key，请使用手动输入' })
    } finally { await connection.close(); repository.close() }
  })

  test('finishes answer metrics when a provider stream fails after a partial answer', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return queued(input) }, async get() { return undefined } }
    await repository.createPrep({ prepId: 'ready', userId: 'user-a', company: '', position: '', jdText: 'JD' })
    await repository.completePrep('ready', 'user-a', { question_strategy_tree: { nodes: {} } })
    const deps = dependencies(repository, tasks)
    deps.ai.stream = async function* (_context, messages) {
      if (messages.some((message) => message.content.includes('说一个字'))) return
      yield '部分回答'
      throw new Error('合成流错误')
    }
    const events: Array<Record<string, unknown>> = []
    const connection = new CopilotRealtimeService(deps).connect(context, 'partial', async (event) => { events.push(event) })
    try {
      await connection.handle({ type: 'start', prep_id: 'ready' })
      await expect(connection.handle({ type: 'manual', text: '问题' })).rejects.toThrow('合成流错误')
      const update = events.findIndex((event) => event.type === 'copilot_update')
      const answer = events.slice(update).filter((event) => ['answer_chunk', 'answer_done'].includes(String(event.type)))
      expect(answer[0]).toEqual({ type: 'answer_chunk', text: '部分回答' })
      expect(answer.at(-1)).toMatchObject({ type: 'answer_done', chunk_count: 1 })
      expect(events).toContainEqual(expect.objectContaining({ type: 'answer_done', chunk_count: 0 }))
    } finally { await connection.close(); repository.close() }
  })

  test('closes a late-starting ASR session and suppresses all post-close events', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return queued(input) }, async get() { return undefined } }
    await repository.createPrep({ prepId: 'ready', userId: 'user-a', company: '', position: '', jdText: 'JD' })
    await repository.completePrep('ready', 'user-a', { question_strategy_tree: { nodes: {} } })
    const deps = dependencies(repository, tasks)
    const config = await deps.settings.loadProvider('user-a')
    deps.settings.loadProvider = async () => ({ ...config, services: { ...config.services!, dashscope_api_key: 'synthetic' } })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let stopped = 0
    deps.asr = { create() { return { async start() { entered.resolve(); await release.promise }, sendAudio() { return true }, async stop() { stopped += 1 } } } }
    const events: unknown[] = []
    const connection = new CopilotRealtimeService(deps).connect(context, 'closing', async (event) => { events.push(event) })
    const started = connection.handle({ type: 'start', prep_id: 'ready' })
    try {
      await entered.promise
      const count = events.length
      const closed = connection.close()
      release.resolve()
      await Promise.all([started, closed])
      await connection.handle({ type: 'start', prep_id: 'ready' })
      expect(events).toHaveLength(count)
      expect(stopped).toBe(1)
    } finally { release.resolve(); await connection.close(); repository.close() }
  })
})
