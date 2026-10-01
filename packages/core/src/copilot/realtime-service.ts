import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import type { RequestContext } from '../kernel/context.ts'
import { fill } from '../interview/prompts.ts'
import { STRUCTURED_CHAT_OPTIONS } from '../provider/ports.ts'
import type { CopilotClientMessage, CopilotConversationTurn, CopilotServerEvent, CopilotSessionState } from './model.ts'
import type { CopilotDependencies, CopilotRealtimeConnection, CopilotRealtimeUseCases, RealtimeAsrSession } from './ports.ts'
import { COPILOT_ADVICE_PROMPT, COPILOT_HR_PROFILE_PROMPT, COPILOT_MONITOR_PROMPT } from './prompts.ts'
import { StrategyNavigator } from './strategy.ts'

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function items(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.map(object) : [] }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : [] }
function parseObject(text: string): Record<string, unknown> | undefined { try { const value = parseJsonResponse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined } catch { return undefined } }
function conversationText(turns: CopilotConversationTurn[]): string { return turns.map((turn) => `${turn.role === 'hr' ? 'HR' : '候选人'}: ${turn.text}`).join('\n') }
function summaryPoints(values: unknown, limit: number): string { return items(values).slice(0, limit).map((item) => String(item.point || JSON.stringify(item))).join('; ') || '无' }

class RealtimeConnection implements CopilotRealtimeConnection {
  private state?: CopilotSessionState
  private prep: Record<string, unknown> = {}
  private navigator?: StrategyNavigator
  private asr?: RealtimeAsrSession
  private stopped = false
  private closed = false
  private chain = Promise.resolve()

  constructor(private readonly deps: CopilotDependencies, private readonly context: RequestContext, private readonly sessionId: string, private readonly sink: (event: CopilotServerEvent) => Promise<void>) {}

  private emit(event: CopilotServerEvent): Promise<void> {
    if (this.closed || this.context.signal.aborted) return Promise.resolve()
    return this.sink(event)
  }

  handle(message: CopilotClientMessage): Promise<void> {
    const next = this.chain.then(() => this.route(message))
    this.chain = next.catch(() => {})
    return next
  }

  private async route(message: CopilotClientMessage): Promise<void> {
    if (this.closed || this.context.signal.aborted) return
    if (message.type === 'start') { try { await this.start(message.prep_id || '') } catch (error) { await this.emit({ type: 'error', message: `初始化失败: ${error instanceof Error ? error.message : String(error)}` }) }; return }
    if (message.type === 'stop') { await this.stop(); return }
    if (!this.state || this.stopped) return
    if (message.type === 'manual' && message.text?.trim()) await this.utterance(message.text.trim(), 'hr')
    if (message.type === 'candidate_response' && message.text.trim()) await this.utterance(message.text.trim(), 'candidate')
  }

  private userId(): string { if (!this.context.userId) throw new AuthenticationError(); return this.context.userId }

  private async start(prepId: string): Promise<void> {
    if (!prepId) throw new AppError('Prep session not ready', 400)
    if (this.asr) await this.asr.stop()
    const record = await this.deps.repository.getPrep(prepId, this.userId())
    if (!record || record.status !== 'done' || !record.result) throw new AppError('Prep session not ready', 400)
    this.prep = record.result
    this.navigator = new StrategyNavigator(object(this.prep.question_strategy_tree))
    await this.emit({ type: 'progress', message: '正在预计算策略树 embedding...' })
    await this.navigator.prepare(this.context, this.deps.embeddings)
    if (this.closed || this.context.signal.aborted) return
    const stored = await this.deps.repository.loadSession(this.sessionId, this.userId())
    const now = new Date().toISOString()
    this.state = stored?.prep_id === prepId ? { ...stored, status: 'active', updated_at: now } : { session_id: this.sessionId, user_id: this.userId(), prep_id: prepId, conversation: [], last_node_id: null, turn_count: 0, status: 'active', created_at: now, updated_at: now }
    await this.deps.repository.saveSession(this.state)
    this.stopped = false
    const key = (await this.deps.settings.loadProvider(this.userId())).services.dashscope_api_key
    const roleDetector = await this.deps.voiceprint?.detector(this.context)
    if (this.closed || this.context.signal.aborted) return
    if (key) {
      try {
        this.asr = this.deps.asr.create({
          apiKey: key,
          ...(roleDetector ? { roleDetector } : {}),
          onInterim: (text) => this.emit({ type: 'asr_interim', text }),
          onFinal: async (text, detectedRole) => {
            const role = detectedRole || 'hr'
            await this.emit({ type: 'asr_final', text, role })
            try { await this.handle(role === 'candidate' ? { type: 'candidate_response', text } : { type: 'manual', text }) }
            catch (error) { await this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
          },
          onError: (message) => this.emit({ type: 'error', message: `ASR: ${message}` }),
        })
        await this.asr.start()
        await this.emit({ type: 'progress', message: roleDetector ? '语音识别 + 声纹自动识别已就绪' : '语音识别已就绪' })
      } catch { this.asr = undefined; await this.emit({ type: 'progress', message: '语音识别不可用，请使用手动输入' }) }
    } else await this.emit({ type: 'progress', message: '未配置 DashScope API Key，请使用手动输入' })
    await this.emit({ type: 'started', session_id: this.sessionId })
    void this.warmup()
  }

  audio(bytes: Uint8Array): void { this.asr?.sendAudio(bytes) }

  private async persist(): Promise<void> { if (this.state) { this.state.updated_at = new Date().toISOString(); await this.deps.repository.saveSession(this.state) } }

  private async utterance(text: string, role: 'hr' | 'candidate'): Promise<void> {
    if (!this.state || !this.navigator) return
    this.state.conversation.push({ role, text, at: new Date().toISOString() })
    if (role === 'candidate') { await this.persist(); void this.monitor([...this.state.conversation]); return }
    this.state.turn_count += 1
    const matched = await this.navigator.match(this.context, this.deps.embeddings, text, this.state.last_node_id)
    if (matched.nodeId) this.state.last_node_id = matched.nodeId
    await this.persist()
    const node = this.navigator.node(matched.nodeId)
    const children = this.navigator.children(matched.nodeId).map((child) => ({ topic: String(child.topic || ''), question: String((Array.isArray(child.sample_questions) ? child.sample_questions[0] : '') || '') }))
    const hint = items(this.prep.prep_hints).find((item) => item.node_id === matched.nodeId)
    await this.emit({ type: 'copilot_update', intent: matched.intent, tree_position: matched.nodeId || null, topic: String(node?.topic || ''), confidence: matched.confidence, recommended_points: strings(node?.recommended_points), children, prep_hint: hint ? { safe_talking_points: strings(hint.safe_talking_points), redirect_suggestion: String(hint.redirect_suggestion || '') } : null })
    const riskLevel = String(node?.risk_level || 'safe')
    const riskAlert = riskLevel === 'danger' ? String(hint?.redirect_suggestion || `注意：'${node?.topic || ''}' 是你的薄弱领域，建议简述核心概念后引导到实际项目经验`) : riskLevel === 'caution' ? `提示：'${node?.topic || ''}' 需要注意，确保回答有条理` : ''
    if (riskAlert) await this.emit({ type: 'risk_alert', message: riskAlert, node_id: matched.nodeId || null })
    const turnCount = this.state.turn_count; const snapshot = [...this.state.conversation]
    if (turnCount >= 3 && turnCount % 3 === 0) void this.hrProfile(snapshot)
    void this.monitor(snapshot)
    const fit = object(this.prep.fit_report); const profile = object(this.prep.profile)
    const prior = snapshot.slice(0, -1).map((turn) => `  ${turn.role === 'hr' ? 'HR' : '候选人'}: ${turn.text}`).join('\n')
    const prompt = fill(COPILOT_ADVICE_PROMPT, { conversation_section: prior ? `对话历史:\n${prior}\n\n` : '', utterance: text, highlights: summaryPoints(fit.highlights, 3), weak_points: summaryPoints(profile.weak_points, 5), key_points: [...strings(node?.recommended_points), ...strings(hint?.safe_talking_points)].slice(0, 5).join('; ') || '无' })
    const started = Date.now(); let first: number | undefined; let chunks = 0
    try {
      for await (const token of this.deps.ai.stream(this.context, [{ role: 'system', content: '直接输出答案，不要 JSON 格式' }, { role: 'user', content: prompt }])) {
        chunks += 1; if (first === undefined) { first = Date.now() - started; await this.emit({ type: 'answer_meta', first_token_ms: first }) }
        await this.emit({ type: 'answer_chunk', text: token })
      }
    } finally { await this.emit({ type: 'answer_done', total_ms: Date.now() - started, chunk_count: chunks }) }
  }

  private async warmup(): Promise<void> {
    const started = Date.now(); let first: number | undefined; let chunks = 0
    try { for await (const _ of this.deps.ai.stream(this.context, [{ role: 'user', content: '说一个字：好' }])) { chunks += 1; if (first === undefined) first = Date.now() - started } await this.emit({ type: 'answer_meta', first_token_ms: first ?? Date.now() - started }); await this.emit({ type: 'answer_done', total_ms: Date.now() - started, chunk_count: chunks }) } catch { /* warmup is optional */ }
  }

  private async hrProfile(turns: CopilotConversationTurn[]): Promise<void> {
    if (turns.length < 3 || this.stopped) return
    try { const result = parseObject(await this.deps.ai.complete(this.context, [{ role: 'system', content: '只输出 JSON' }, { role: 'user', content: fill(COPILOT_HR_PROFILE_PROMPT, { conversation: conversationText(turns) }) }], STRUCTURED_CHAT_OPTIONS)); if (result && !this.stopped) await this.emit({ ...result, type: 'hr_profile_update' }) } catch { /* background analysis is best effort */ }
  }

  private async monitor(turns: CopilotConversationTurn[]): Promise<void> {
    if (!turns.length || this.stopped) return
    const fit = object(this.prep.fit_report); const jd = object(this.prep.jd_analysis); const profile = object(this.prep.profile)
    const skills = items(jd.required_skills).slice(0, 10).map((item) => String(item.skill || JSON.stringify(item))).join('; ') || '无'
    try { const result = parseObject(await this.deps.ai.complete(this.context, [{ role: 'system', content: '只输出 JSON' }, { role: 'user', content: fill(COPILOT_MONITOR_PROMPT, { conversation: conversationText(turns), required_skills: skills, highlights: summaryPoints(fit.highlights, 5), weak_points: summaryPoints(profile.weak_points, 5) }) }], STRUCTURED_CHAT_OPTIONS)); if (result && !this.stopped) await this.emit({ ...result, type: 'monitor_update' }) } catch { /* background analysis is best effort */ }
  }

  private async stop(): Promise<void> { this.stopped = true; await this.asr?.stop(); this.asr = undefined; if (this.state) { this.state.status = 'stopped'; await this.persist() }; await this.emit({ type: 'stopped' }) }
  async close(): Promise<void> {
    this.closed = true; this.stopped = true
    await this.chain.catch(() => {})
    // Startup can still be acquiring ASR when close arrives. Stop it after the
    // queued command settles, rather than losing a late-created session.
    await this.asr?.stop(); this.asr = undefined
  }
}

export class CopilotRealtimeService implements CopilotRealtimeUseCases {
  constructor(private readonly deps: CopilotDependencies) {}
  connect(context: RequestContext, sessionId: string, emit: (event: CopilotServerEvent) => Promise<void>): CopilotRealtimeConnection { return new RealtimeConnection(this.deps, context, sessionId, emit) }
}
