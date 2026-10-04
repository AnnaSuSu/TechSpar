import { afterEach, describe, expect, spyOn, test } from 'bun:test'
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
import { within } from './helpers/realtime-asr.ts'

const directories: string[] = []
async function databasePath(): Promise<string> { const directory = await mkdtemp(join(tmpdir(), 'techspar-copilot-')); directories.push(directory); return join(directory, 'techspar.db') }
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })
const context: RequestContext = { requestId: 'copilot-test', userId: 'user-a', signal: new AbortController().signal }

class CopilotAi implements TextGenerationUseCases {
  async complete(_context: RequestContext, messages: readonly ChatMessage[]): Promise<string> {
    const prompt = messages.map((message) => message.content).join('\n')
    if (prompt.includes('面试情报分析师')) return JSON.stringify({ company_name: '示例', main_business: '软件服务', interviewer_mindset: '重视工程实践', how_to_reference: '引用项目结果', tech_stack: ['TypeScript'], interview_style: '结构化面试', culture_notes: '重视协作', common_focus_areas: ['并发'], sources: ['https://example.test'] })
    if (prompt.includes('JD 分析引擎')) return JSON.stringify({ role_title: '后端工程师', seniority: 'senior', required_skills: [{ skill: 'TypeScript', weight: 'core', jd_evidence: '负责 TypeScript 服务端架构' }], likely_question_dimensions: [{ dimension: '系统设计', skills: ['TypeScript'], estimated_proportion: 0.6 }], key_phrases: ['高并发'] })
    if (prompt.includes('匹配分析引擎')) return JSON.stringify({ overall_fit: 0.7, coach_brief: '突出服务端经验并补足并发案例', highlights: [{ point: '服务端经验', jd_link: '服务端架构' }], gaps: [{ point: '并发控制', risk: 'high', mitigation: '准备限流与队列案例' }], talking_points: ['说明高并发项目中的取舍'] })
    if (prompt.includes('面试策略引擎')) return JSON.stringify({ root_nodes: ['tech'], nodes: { tech: { id: 'tech', topic: 'TypeScript', sample_questions: ['解释事件循环'], intent: 'technical', depth: 0, risk_level: 'danger', children: [], recommended_points: ['先说调用栈'] } }, phase_order: ['technical'] })
    if (prompt.includes('风险评估引擎')) return JSON.stringify({ risk_summary: '并发是风险', risk_map: [{ node_id: 'tech', risk_level: 'danger', reason: '缺少系统设计证据', avoidance_strategy: '先确认边界' }], prep_hints: [{ node_id: 'tech', must_know: ['限流'], safe_talking_points: ['结合项目'], redirect_suggestion: '先讲可验证的项目实践' }] })
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
  const node = (id: string, children: string[] = [], depth = 0) => ({ id, topic: '事件循环', sample_questions: ['解释事件循环'], intent: 'technical', depth, risk_level: 'danger', children, recommended_points: ['结合例子'] })
  const cases: Array<{ name: string; stage: string; patch: Record<string, unknown> }> = [
    { name: 'company fields', stage: '面试情报分析师', patch: { tech_stack: [4] } },
    { name: 'missing company', stage: '面试情报分析师', patch: { company_name: undefined } },
    { name: 'JD seniority', stage: 'JD 分析引擎', patch: { seniority: 'expert' } },
    { name: 'JD nested skills', stage: 'JD 分析引擎', patch: { required_skills: [{ skill: 'TypeScript', weight: 'required' }] } },
    { name: 'fit score', stage: '匹配分析引擎', patch: { overall_fit: 1.1 } },
    { name: 'missing fit fields', stage: '匹配分析引擎', patch: { highlights: undefined } },
    { name: 'unknown root', stage: '面试策略引擎', patch: { root_nodes: ['missing'] } },
    { name: 'duplicate roots', stage: '面试策略引擎', patch: { root_nodes: ['tech', 'tech'] } },
    { name: 'empty tree', stage: '面试策略引擎', patch: { root_nodes: [], nodes: {} } },
    { name: 'unknown child', stage: '面试策略引擎', patch: { nodes: { tech: node('tech', ['missing']) } } },
    { name: 'cycle', stage: '面试策略引擎', patch: { nodes: { tech: node('tech', ['child']), child: node('child', ['tech'], 1) } } },
    { name: 'mismatched ID', stage: '面试策略引擎', patch: { nodes: { tech: node('other') } } },
    { name: 'wrong depth', stage: '面试策略引擎', patch: { nodes: { tech: node('tech', [], 1) } } },
    { name: 'unreachable node', stage: '面试策略引擎', patch: { nodes: { tech: node('tech'), orphan: node('orphan') } } },
    { name: 'multiple parents', stage: '面试策略引擎', patch: { root_nodes: ['tech', 'other'], nodes: { tech: node('tech', ['child']), other: node('other', ['child']), child: node('child', [], 1) } } },
    { name: 'risk reference', stage: '风险评估引擎', patch: { risk_map: [{ node_id: 'missing', risk_level: 'danger', reason: '', avoidance_strategy: '' }] } },
    { name: 'hint reference', stage: '风险评估引擎', patch: { prep_hints: [{ node_id: 'missing', must_know: [], safe_talking_points: [], redirect_suggestion: '' }] } },
  ]
  for (const { name, stage, patch } of cases) test(`fails preparation on ${name} before completion or predicted profile writes`, async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const complete = spyOn(repository, 'completePrep')
    const fail = spyOn(repository, 'failPrep')
    const dispatched: TaskRecord[] = []
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { const value = queued(input); dispatched.push(value); return value }, async get() { return undefined } }
    const deps = dependencies(repository, tasks)
    let predicted = 0
    deps.profile.addPredictedWeakPoints = async () => { predicted++ }
    const baseAi = new CopilotAi()
    deps.ai.complete = async (context, messages) => {
      const original = await baseAi.complete(context, messages)
      return messages[0]?.content.includes(stage) ? JSON.stringify({ ...JSON.parse(original), ...patch }) : original
    }
    const service = new CopilotPrepService(deps)
    try {
      await service.start(context, { jd_text: 'TypeScript 后端开发', company: '示例' })
      await expect(service.runPrepTask(dispatched[0]!)).rejects.toThrow()
      expect(complete).not.toHaveBeenCalled()
      expect(fail).toHaveBeenCalledTimes(1)
      const prep = await repository.getPrep('prep-1', 'user-a')
      expect(prep?.status).toBe('error')
      expect(prep?.result).toBeFalsy()
      expect(predicted).toBe(0)
    } finally { complete.mockRestore(); fail.mockRestore(); repository.close() }
  })

  test('uses the validated local company and risk defaults when search and risk nodes are absent', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const dispatched: TaskRecord[] = []
    const deps = dependencies(repository, { async enqueue(input) { const value = queued(input); dispatched.push(value); return value }, async get() { return undefined } })
    const config = await deps.settings.loadProvider('user-a')
    deps.settings.loadProvider = async () => ({ ...config, services: { ...config.services!, tavily_api_key: '' } })
    const original = new CopilotAi()
    const calls: string[] = []
    deps.ai.complete = async (context, messages) => {
      calls.push(messages[0]?.content || '')
      if (messages[0]?.content.includes('面试策略引擎')) return JSON.stringify({ root_nodes: ['tech'], nodes: { tech: { ...node('tech'), risk_level: 'safe' } }, phase_order: ['technical'] })
      return original.complete(context, messages)
    }
    const service = new CopilotPrepService(deps)
    try {
      await service.start(context, { jd_text: 'TypeScript 后端开发', company: '示例公司' })
      await service.runPrepTask(dispatched[0]!)
      const result = (await repository.getPrep('prep-1', 'user-a'))?.result
      expect(result).toMatchObject({ risk_map: [], prep_hints: [], risk_summary: '' })
      expect(JSON.parse(result!.company_report as string)).toMatchObject({ company_name: '示例公司', tech_stack: [], sources: [] })
      expect(calls.some(call => call.includes('面试情报分析师') || call.includes('风险评估引擎'))).toBeFalse()
    } finally { repository.close() }
  })

  test('fails malformed JSON without persisting a fallback prep result', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const dispatched: TaskRecord[] = []
    const deps = dependencies(repository, { async enqueue(input) { const value = queued(input); dispatched.push(value); return value }, async get() { return undefined } })
    deps.ai.complete = async () => '{"broken":'
    const service = new CopilotPrepService(deps)
    try {
      await service.start(context, { jd_text: 'TypeScript 后端开发', company: '示例公司' })
      await expect(service.runPrepTask(dispatched[0]!)).rejects.toThrow()
      expect(await repository.getPrep('prep-1', 'user-a')).toMatchObject({ status: 'error', result: null })
    } finally { repository.close() }
  })

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
    const stored = await repository.getPrep('prep-1', 'user-a')
    expect(typeof stored?.result?.company_report).toBe('string')
    expect(JSON.parse(stored!.result!.company_report as string)).toMatchObject({ company_name: '示例', tech_stack: ['TypeScript'] })
    expect(await service.tree(context, 'prep-1')).toMatchObject({ root_nodes: ['tech'] })
    expect(predicted).toEqual(['并发控制'])
    expect(await repository.getPrep('prep-1', 'user-b')).toBeUndefined()
    repository.close()
  })
})

describe('Copilot realtime', () => {
  for (const mode of ['invalid', 'missing', 'valid'] as const) test(`handles ${mode} model updates before publishing realtime events`, async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    await repository.createPrep({ prepId: 'ready', userId: 'user-a', company: '', position: '', jdText: 'JD' })
    await repository.completePrep('ready', 'user-a', { question_strategy_tree: { nodes: {} } })
    const deps = dependencies(repository, { async enqueue(input) { return queued(input) }, async get() { return undefined } })
    const calls: string[] = []
    deps.ai.complete = async (_context, messages) => {
      const hr = messages.some(message => message.content.includes('分析 HR'))
      calls.push(hr ? 'hr' : 'monitor')
      if (mode === 'missing') return '{}'
      return JSON.stringify(hr
        ? { type: 'error', style: mode === 'invalid' ? {} : '细致', focus: '', satisfaction_signals: '', advice: '', extension: { kept: true } }
        : { type: 'error', phase: 'technical', last_answer_feedback: '', covered_topics: mode === 'invalid' ? [3] : [], uncovered_topics: [], strategy_tip: '', extension: { kept: true } })
    }
    const events: Array<Record<string, unknown>> = []
    const connection = new CopilotRealtimeService(deps).connect(context, 'live', async event => { events.push(event) })
    try {
      await connection.handle({ type: 'start', prep_id: 'ready' })
      for (const text of ['问题一', '问题二', '问题三']) await connection.handle({ type: 'manual', text })
      expect(calls.filter(call => call === 'hr')).toHaveLength(1)
      expect(calls.filter(call => call === 'monitor')).toHaveLength(3)
      expect(events.filter(event => event.type === 'hr_profile_update')).toHaveLength(mode === 'valid' ? 1 : 0)
      expect(events.filter(event => event.type === 'monitor_update')).toHaveLength(mode === 'valid' ? 3 : 0)
      expect(events.some(event => event.type === 'error')).toBeFalse()
      if (mode === 'valid') expect(events.find(event => event.type === 'hr_profile_update')).toMatchObject({ extension: { kept: true } })
      expect((await repository.loadSession('live', 'user-a'))?.turn_count).toBe(3)
    } finally { await connection.close(); repository.close() }
  })

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

  test('stops ASR before waiting for a handshake that only stop can release', async () => {
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
    deps.asr = { create() { return { async start() { entered.resolve(); await release.promise }, sendAudio() { return true }, async stop() { stopped += 1; release.resolve() } } } }
    let warmups = 0
    deps.ai.stream = async function* () { warmups += 1; yield 'must not start after close' }
    const events: unknown[] = []
    const connection = new CopilotRealtimeService(deps).connect(context, 'closing', async (event) => { events.push(event) })
    const started = connection.handle({ type: 'start', prep_id: 'ready' })
    try {
      await entered.promise
      const count = events.length
      const closed = connection.close()
      expect(connection.close()).toBe(closed)
      await within(Promise.all([started, closed]))
      await connection.handle({ type: 'start', prep_id: 'ready' })
      expect(events).toHaveLength(count)
      expect(stopped).toBe(1)
      expect(warmups).toBe(0)
    } finally { release.resolve(); await connection.close(); repository.close() }
  })

  test('does not create ASR when close arrives before startup dependencies finish', async () => {
    const repository = new BunCopilotRepository(await databasePath()); repository.initialize()
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return queued(input) }, async get() { return undefined } }
    await repository.createPrep({ prepId: 'ready', userId: 'user-a', company: '', position: '', jdText: 'JD' })
    await repository.completePrep('ready', 'user-a', { question_strategy_tree: { nodes: {} } })
    const deps = dependencies(repository, tasks)
    const config = await deps.settings.loadProvider('user-a')
    deps.settings.loadProvider = async () => ({ ...config, services: { ...config.services!, dashscope_api_key: 'synthetic' } })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    deps.voiceprint = { async detector() { entered.resolve(); await release.promise; return undefined } }
    let created = 0
    deps.asr = { create() { created += 1; throw new Error('must not create ASR after close') } }
    const events: unknown[] = []
    const connection = new CopilotRealtimeService(deps).connect(context, 'closing-before-asr', async (event) => { events.push(event) })
    const started = connection.handle({ type: 'start', prep_id: 'ready' })
    try {
      await within(entered.promise)
      const count = events.length
      const closed = connection.close()
      release.resolve()
      await within(Promise.all([started, closed]))
      expect(created).toBe(0)
      expect(events).toHaveLength(count)
    } finally { release.resolve(); await connection.close(); repository.close() }
  })
})
