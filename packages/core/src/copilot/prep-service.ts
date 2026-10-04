import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { enumValue, finiteNumber, isRecord, record, requiredText, stringArray, StructuredOutputError } from '../kernel/structured-output.ts'
import { STRUCTURED_CHAT_OPTIONS } from '../provider/ports.ts'
import { fill } from '../interview/prompts.ts'
import type { TaskRecord } from '../interview/model.ts'
import { INTERVIEW_PHASES } from '../interview/model.ts'
import type { CopilotDependencies, CopilotPrepUseCases, SearchResult } from './ports.ts'
import { COPILOT_COMPANY_PROMPT, COPILOT_FIT_PROMPT, COPILOT_JD_PROMPT, COPILOT_RISK_PROMPT, COPILOT_STRATEGY_PROMPT } from './prompts.ts'

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function object(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {} }
function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new StructuredOutputError('expected a string', path)
  return value.trim()
}
function parseValidated<T>(textValue: string, validate: (value: unknown) => T): T {
  return validate(parseJsonResponse(textValue))
}
function validateCompanyReport(value: unknown): Record<string, unknown> {
  const source = record(value)
  requiredText(source.company_name, 'company_name')
  for (const field of ['main_business', 'interviewer_mindset', 'how_to_reference', 'interview_style', 'culture_notes']) text(source[field], field)
  for (const field of ['tech_stack', 'common_focus_areas', 'sources']) source[field] = stringArray(source[field], field)
  return source
}
function validateJdAnalysis(value: unknown): Record<string, unknown> {
  const source = record(value)
  requiredText(source.role_title, 'role_title')
  enumValue(source.seniority, ['junior', 'mid', 'senior', 'lead'] as const, 'seniority')
  if (!Array.isArray(source.required_skills)) throw new StructuredOutputError('expected an array', 'required_skills')
  source.required_skills = source.required_skills.map((raw, index) => {
    const item = record(raw, `required_skills[${index}]`)
    requiredText(item.skill, `required_skills[${index}].skill`)
    enumValue(item.weight, ['core', 'preferred', 'bonus'] as const, `required_skills[${index}].weight`)
    text(item.jd_evidence, `required_skills[${index}].jd_evidence`)
    return item
  })
  if (!Array.isArray(source.likely_question_dimensions)) throw new StructuredOutputError('expected an array', 'likely_question_dimensions')
  source.likely_question_dimensions = source.likely_question_dimensions.map((raw, index) => {
    const item = record(raw, `likely_question_dimensions[${index}]`)
    requiredText(item.dimension, `likely_question_dimensions[${index}].dimension`)
    item.skills = stringArray(item.skills, `likely_question_dimensions[${index}].skills`)
    finiteNumber(item.estimated_proportion, `likely_question_dimensions[${index}].estimated_proportion`, 0, 1)
    return item
  })
  source.key_phrases = stringArray(source.key_phrases, 'key_phrases')
  return source
}
function validateFitReport(value: unknown): Record<string, unknown> {
  const source = record(value)
  finiteNumber(source.overall_fit, 'overall_fit', 0, 1)
  text(source.coach_brief, 'coach_brief')
  if (!Array.isArray(source.highlights)) throw new StructuredOutputError('expected an array', 'highlights')
  source.highlights = source.highlights.map((raw, index) => {
    const item = record(raw, `highlights[${index}]`)
    requiredText(item.point, `highlights[${index}].point`)
    text(item.jd_link, `highlights[${index}].jd_link`)
    return item
  })
  if (!Array.isArray(source.gaps)) throw new StructuredOutputError('expected an array', 'gaps')
  source.gaps = source.gaps.map((raw, index) => {
    const item = record(raw, `gaps[${index}]`)
    requiredText(item.point, `gaps[${index}].point`)
    enumValue(item.risk, ['high', 'medium', 'low'] as const, `gaps[${index}].risk`)
    text(item.mitigation, `gaps[${index}].mitigation`)
    return item
  })
  source.talking_points = stringArray(source.talking_points, 'talking_points')
  return source
}
function validateStrategyTree(value: unknown): Record<string, unknown> {
  const source = record(value)
  const roots = stringArray(source.root_nodes, 'root_nodes')
  source.root_nodes = roots
  if (!roots.length) throw new StructuredOutputError('must contain at least one root node', 'root_nodes')
  if (new Set(roots).size !== roots.length) throw new StructuredOutputError('must be unique', 'root_nodes')
  const nodes = record(source.nodes, 'nodes')
  if (!Object.keys(nodes).length) throw new StructuredOutputError('must contain at least one node', 'nodes')
  source.phase_order = stringArray(source.phase_order, 'phase_order')
  for (const phase of source.phase_order as string[]) enumValue(phase, INTERVIEW_PHASES, 'phase_order')
  const ids = new Set(Object.keys(nodes))
  const childrenById = new Map<string, string[]>()
  for (const [nodeId, raw] of Object.entries(nodes)) {
    const item = record(raw, `nodes.${nodeId}`)
    if (requiredText(item.id, `nodes.${nodeId}.id`) !== nodeId) throw new StructuredOutputError('must match node map key', `nodes.${nodeId}.id`)
    item.id = nodeId
    requiredText(item.topic, `nodes.${nodeId}.topic`)
    item.sample_questions = stringArray(item.sample_questions, `nodes.${nodeId}.sample_questions`)
    enumValue(item.intent, INTERVIEW_PHASES, `nodes.${nodeId}.intent`)
    if (!Number.isInteger(item.depth) || (item.depth as number) < 0 || (item.depth as number) > 3) throw new StructuredOutputError('must be an integer from 0 to 3', `nodes.${nodeId}.depth`)
    enumValue(item.risk_level, ['safe', 'caution', 'danger'] as const, `nodes.${nodeId}.risk_level`)
    const children = stringArray(item.children, `nodes.${nodeId}.children`)
    item.children = children
    if (new Set(children).size !== children.length) throw new StructuredOutputError('must be unique', `nodes.${nodeId}.children`)
    if (item.trigger_condition !== undefined) text(item.trigger_condition, `nodes.${nodeId}.trigger_condition`)
    item.recommended_points = stringArray(item.recommended_points, `nodes.${nodeId}.recommended_points`)
    for (const child of children) if (!ids.has(child)) throw new StructuredOutputError('references an unknown node', `nodes.${nodeId}.children`)
    childrenById.set(nodeId, children)
  }
  for (const root of roots) if (!ids.has(root)) throw new StructuredOutputError('references an unknown node', 'root_nodes')
  const visiting = new Set<string>(); const visited = new Set<string>()
  const walk = (nodeId: string, expectedDepth: number): void => {
    const node = nodes[nodeId] as Record<string, unknown>
    if (visiting.has(nodeId)) throw new StructuredOutputError('contains a cycle', `nodes.${nodeId}.children`)
    if (node.depth !== expectedDepth) throw new StructuredOutputError('does not match tree depth', `nodes.${nodeId}.depth`)
    if (visited.has(nodeId)) throw new StructuredOutputError('node must have only one parent', `nodes.${nodeId}`)
    visiting.add(nodeId)
    for (const child of childrenById.get(nodeId) || []) walk(child, expectedDepth + 1)
    visiting.delete(nodeId); visited.add(nodeId)
  }
  for (const root of roots) walk(root, 0)
  if (visited.size !== ids.size) throw new StructuredOutputError('contains unreachable nodes', 'nodes')
  return source
}
function validateRiskReport(value: unknown, nodeIds: ReadonlySet<string>): Record<string, unknown> {
  const source = record(value)
  text(source.risk_summary, 'risk_summary')
  if (!Array.isArray(source.risk_map)) throw new StructuredOutputError('expected an array', 'risk_map')
  source.risk_map = source.risk_map.map((raw, index) => {
    const item = record(raw, `risk_map[${index}]`)
    const nodeId = requiredText(item.node_id, `risk_map[${index}].node_id`)
    if (!nodeIds.has(nodeId)) throw new StructuredOutputError('references an unknown strategy node', `risk_map[${index}].node_id`)
    enumValue(item.risk_level, ['danger', 'caution'] as const, `risk_map[${index}].risk_level`)
    for (const field of ['reason', 'avoidance_strategy']) text(item[field], `risk_map[${index}].${field}`)
    return item
  })
  if (!Array.isArray(source.prep_hints)) throw new StructuredOutputError('expected an array', 'prep_hints')
  source.prep_hints = source.prep_hints.map((raw, index) => {
    const item = record(raw, `prep_hints[${index}]`)
    const nodeId = requiredText(item.node_id, `prep_hints[${index}].node_id`)
    if (!nodeIds.has(nodeId)) throw new StructuredOutputError('references an unknown strategy node', `prep_hints[${index}].node_id`)
    item.must_know = stringArray(item.must_know, `prep_hints[${index}].must_know`)
    item.safe_talking_points = stringArray(item.safe_talking_points, `prep_hints[${index}].safe_talking_points`)
    text(item.redirect_suggestion, `prep_hints[${index}].redirect_suggestion`)
    return item
  })
  return source
}
function json(value: unknown): string { return JSON.stringify(value, null, 2) }
function newContext(task: TaskRecord): RequestContext { return { requestId: `task:${task.task_id}`, userId: task.user_id, signal: new AbortController().signal } }

export class CopilotPrepService implements CopilotPrepUseCases {
  constructor(private readonly deps: CopilotDependencies) {}

  async start(context: RequestContext, input: { jd_text: string; company?: string; position?: string }): Promise<{ prep_id: string }> {
    const userId = id(context)
    if (!input.jd_text.trim()) throw new AppError('JD must not be blank.', 400)
    const prepId = this.deps.ids.next()
    await this.deps.repository.createPrep({ prepId, userId, company: (input.company || '').trim(), position: (input.position || '').trim(), jdText: input.jd_text })
    try { await this.deps.tasks.enqueue({ taskId: `copilot_prep:${prepId}`, userId, type: 'copilot_prep', payload: { prep_id: prepId } }) }
    catch (error) { await this.deps.repository.failPrep(prepId, userId, error instanceof Error ? error.message : String(error)); throw error }
    return { prep_id: prepId }
  }

  async get(context: RequestContext, prepId: string): Promise<Record<string, unknown>> {
    const prep = await this.deps.repository.getPrep(prepId, id(context))
    if (!prep) throw new AppError('Prep session not found', 404)
    const response: Record<string, unknown> = { status: prep.status, progress: prep.progress, error: prep.error, company: prep.company, position: prep.position }
    if (prep.status === 'done' && prep.result) for (const key of ['company_report', 'jd_analysis', 'fit_report', 'risk_map', 'risk_summary', 'prep_hints']) response[key] = prep.result[key] ?? (key.endsWith('map') || key.endsWith('hints') ? [] : '')
    return response
  }

  async list(context: RequestContext): Promise<Array<Record<string, unknown>>> {
    return (await this.deps.repository.listPreps(id(context))).map((prep) => ({ prep_id: prep.prep_id, company: prep.company, position: prep.position, jd_excerpt: prep.jd_text.slice(0, 80), status: prep.status, progress: prep.progress, created_at: prep.created_at }))
  }

  async tree(context: RequestContext, prepId: string): Promise<Record<string, unknown>> {
    const prep = await this.deps.repository.getPrep(prepId, id(context))
    if (!prep || prep.status !== 'done' || !prep.result) throw new AppError('Prep not ready', 404)
    return object(prep.result.question_strategy_tree)
  }

  async delete(context: RequestContext, prepId: string): Promise<{ ok: true }> {
    if (!(await this.deps.repository.deletePrep(prepId, id(context)))) throw new AppError('Prep session not found', 404)
    return { ok: true }
  }

  private async search(context: RequestContext, apiKey: string, company: string, position: string): Promise<SearchResult[]> {
    if (!apiKey) return []
    const queries = [`${company} ${position} 业务方向 技术场景 产品`, `${company} ${position} 面试经验 面试流程 考察重点`, `${company} 技术栈 工程文化 技术架构`]
    const groups = await Promise.all(queries.map(async (query) => { try { return await this.deps.search.search({ apiKey, query, maxResults: 3, signal: context.signal }) } catch { return [] } }))
    return groups.flat()
  }

  async runPrepTask(task: TaskRecord): Promise<Record<string, unknown>> {
    const prepId = String(task.payload.prep_id || '').trim()
    const prep = await this.deps.repository.getPrep(prepId, task.user_id)
    if (!prep) throw new Error('Prep session not found')
    const context = newContext(task)
    try {
      await this.deps.repository.updatePrepProgress(prepId, task.user_id, '正在并行分析公司信息、岗位要求和简历匹配度...')
      const [services, resumeText, profileSummary, profile] = await Promise.all([
        this.deps.settings.loadProvider(task.user_id).then((value) => value.services),
        this.deps.resume.text(context).catch(() => ''),
        this.deps.profile.summary(task.user_id),
        this.deps.profile.get ? this.deps.profile.get(context).catch((): Record<string, unknown> => ({})) : Promise.resolve<Record<string, unknown>>({}),
      ])
      const company = (async () => {
        const results = await this.search(context, services.tavily_api_key, prep.company, prep.position)
        if (!results.length) return validateCompanyReport({ company_name: prep.company || '未知', main_business: '', interviewer_mindset: '', how_to_reference: '', tech_stack: [], interview_style: '无法获取（未配置搜索 API 或搜索无结果）', culture_notes: '', common_focus_areas: [], sources: [] })
        const generated = await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试情报分析师。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_COMPANY_PROMPT, { company: prep.company, position: prep.position, results: json(results) }) }], STRUCTURED_CHAT_OPTIONS)
        return validateCompanyReport(parseJsonResponse(generated))
      })()
      const jd = this.deps.ai.complete(context, [{ role: 'system', content: '你是 JD 分析引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_JD_PROMPT, { jd_text: prep.jd_text.slice(0, 6000) }) }], STRUCTURED_CHAT_OPTIONS)
      const fit = this.deps.ai.complete(context, [{ role: 'system', content: '你是匹配分析引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_FIT_PROMPT, { jd_text: prep.jd_text.slice(0, 6000), resume_context: resumeText.slice(0, 5000) || '未上传简历', profile_summary: profileSummary }) }], STRUCTURED_CHAT_OPTIONS)
      const [companyReport, jdText, fitText] = await Promise.all([company, jd, fit])
      const jdAnalysis = parseValidated(jdText, validateJdAnalysis)
      const fitReport = parseValidated(fitText, validateFitReport)

      await this.deps.repository.updatePrepProgress(prepId, task.user_id, '正在生成 HR 提问策略树...')
      const strategyText = await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试策略引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_STRATEGY_PROMPT, { role_title: jdAnalysis.role_title || '技术岗位', company_report: json(companyReport).slice(0, 3000), jd_analysis: json(jdAnalysis).slice(0, 3000), fit_report: json(fitReport).slice(0, 3000), profile_summary: profileSummary.slice(0, 3000) }) }], STRUCTURED_CHAT_OPTIONS)
      const strategy = parseValidated(strategyText, validateStrategyTree)

      await this.deps.repository.updatePrepProgress(prepId, task.user_id, '正在评估风险路径...')
      const nodes = object(strategy.nodes)
      const riskNodes = Object.entries(nodes).flatMap(([nodeId, raw]) => { const node = object(raw); return ['danger', 'caution'].includes(String(node.risk_level)) ? [{ node_id: nodeId, topic: node.topic || '', risk_level: node.risk_level }] : [] })
      const riskText = riskNodes.length
        ? await this.deps.ai.complete(context, [{ role: 'system', content: '你是风险评估引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_RISK_PROMPT, { weak_points: json(Array.isArray(profile.weak_points) ? profile.weak_points.slice(0, 10) : []), gaps: json(Array.isArray(fitReport.gaps) ? fitReport.gaps.slice(0, 10) : []), risk_nodes: json(riskNodes) }) }], STRUCTURED_CHAT_OPTIONS)
        : JSON.stringify({ risk_summary: '', risk_map: [], prep_hints: [] })
      const risk = parseValidated(riskText, (value) => validateRiskReport(value, new Set(Object.keys(nodes))))
      const companyReportText = json(companyReport)
      const result = { user_id: task.user_id, jd_text: prep.jd_text, resume_context: resumeText.slice(0, 2000), profile, company_report: companyReportText, jd_analysis: jdAnalysis, fit_report: fitReport, question_strategy_tree: strategy, risk_map: risk.risk_map, risk_summary: risk.risk_summary, prep_hints: risk.prep_hints, status: 'done', progress: '准备完成', error: '' }
      await this.deps.repository.completePrep(prepId, task.user_id, result)
      const predicted = Array.isArray(fitReport.gaps) ? fitReport.gaps.flatMap((raw) => { const gap = object(raw); return gap.risk === 'high' && typeof gap.point === 'string' ? [gap.point] : [] }) : []
      if (predicted.length && this.deps.profile.addPredictedWeakPoints) { try { await this.deps.profile.addPredictedWeakPoints({ userId: task.user_id, topic: prep.position || '综合', points: predicted }) } catch { /* prep result remains usable */ } }
      return { prep_id: prepId, status: 'done' }
    } catch (error) {
      await this.deps.repository.failPrep(prepId, task.user_id, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500))
      throw error
    }
  }
}
