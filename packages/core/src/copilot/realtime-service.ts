import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { isRecord, stringArray, textValue, StructuredOutputError } from '../kernel/structured-output.ts'
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
function stringFields(value: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) textValue(value[field], field)
}
function validateHrProfile(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new StructuredOutputError('expected an object')
  stringFields(value, ['style', 'focus', 'satisfaction_signals', 'advice'])
  return value
}
function validateMonitor(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new StructuredOutputError('expected an object')
  stringFields(value, ['phase', 'last_answer_feedback', 'strategy_tip'])
  for (const field of ['covered_topics', 'uncovered_topics']) value[field] = stringArray(value[field], field)
  return value
}
function parseObject<T extends Record<string, unknown>>(text: string, validate: (value: unknown) => T): T | undefined {
  try { return validate(parseJsonResponse(text)) } catch { return undefined }
}
function conversationText(turns: CopilotConversationTurn[]): string { return turns.map((turn) => `${turn.role === 'hr' ? 'HR' : '候选人'}: ${turn.text}`).join('\n') }
function summaryPoints(values: unknown, limit: number): string { return items(values).slice(0, limit).map((item) => String(item.point || JSON.stringify(item))).join('; ') || '无' }

class RealtimeConnection implements CopilotRealtimeConnection {
  private state?: CopilotSessionState
  private prep: Record<string, unknown> = {}
  private navigator?: StrategyNavigator
  private asrs = new Map<string, RealtimeAsrSession>()
  private audioEpoch = 0
  private dualAudio = false
  private stopped = false
  private closed = false
  private closing?: Promise<void>
  private chain = Promise.resolve()
  private answer?: AbortController

  constructor(private readonly deps: CopilotDependencies, private readonly context: RequestContext, private readonly sessionId: string, private readonly sink: (event: CopilotServerEvent) => Promise<void>) {}

  private emit(event: CopilotServerEvent): Promise<void> {
    if (this.closed || this.context.signal.aborted) return Promise.resolve()
    return this.sink(event)
  }

  handle(message: CopilotClientMessage): Promise<void> {
    let answer: AbortController | undefined
    if (message.type === 'manual' && message.text?.trim()) {
      this.answer?.abort()
      answer = new AbortController()
      this.answer = answer
    } else if (message.type === 'stop' || message.type === 'start') this.answer?.abort()
    const next = this.chain.then(() => this.route(message, answer)).catch((error) => {
      if (!answer?.signal.aborted) throw error
    })
    this.chain = next.catch(() => {})
    return next
  }

  private async route(message: CopilotClientMessage, answer?: AbortController): Promise<void> {
    if (this.closed || this.context.signal.aborted) return
    if (message.type === 'start') { try { await this.start(message.prep_id || '', message.audio_mode === 'dual') } catch (error) { await this.emit({ type: 'error', message: `初始化失败: ${error instanceof Error ? error.message : String(error)}` }) }; return }
    if (message.type === 'stop') { await this.stop(); return }
    if (!this.state || this.stopped) return
    if (message.type === 'manual' && message.text?.trim()) await this.utterance(message.text.trim(), 'hr', answer)
    if (message.type === 'candidate_response' && message.text.trim()) await this.utterance(message.text.trim(), 'candidate')
  }

  private userId(): string { if (!this.context.userId) throw new AuthenticationError(); return this.context.userId }

  private async start(prepId: string, dualAudio: boolean): Promise<void> {
    if (!prepId) throw new AppError('Prep session not ready', 400)
    await this.stopAsr()
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
    const services = (await this.deps.settings.loadProvider(this.userId())).services
    const key = this.deps.asrConfig?.apiKey || services.dashscope_api_key
    const workspaceId = this.deps.asrConfig?.apiKey ? this.deps.asrConfig.workspaceId : services.dashscope_workspace_id
    if (this.closed || this.context.signal.aborted) return
    this.dualAudio = dualAudio
    const epoch = this.audioEpoch
    const active = () => epoch === this.audioEpoch && !this.stopped && !this.closed && !this.context.signal.aborted
    if (key) {
      try {
        for (const source of dualAudio ? ['system', 'microphone'] : ['system']) {
          if (!active()) return
          const sourceRole = source === 'microphone' ? 'candidate' : 'hr'
          const asr = this.deps.asr.create({
            apiKey: key,
            workspaceId,
            onInterim: (text) => active() ? this.emit({ type: 'asr_interim', text, ...(dualAudio ? { role: sourceRole } : {}) }) : Promise.resolve(),
            onFinal: async (text, legacyRole) => {
              if (!active()) return
              const role = dualAudio ? sourceRole : legacyRole || 'hr'
              await this.emit({ type: 'asr_final', text, role })
              if (!active()) return
              try { await this.handle(role === 'candidate' ? { type: 'candidate_response', text } : { type: 'manual', text }) }
              catch (error) { await this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
            },
            onError: async (message) => {
              if (!active()) return
              await this.emit({ type: 'error', message: dualAudio ? `ASR (${source === 'system' ? '对方' : '自己'}): ${message}` : `ASR: ${message}` })
              // Do not silently continue with only one speaker after a channel fails.
              if (dualAudio) await this.stopAsr()
            },
          })
          this.asrs.set(source, asr)
          await asr.start(this.context.signal)
        }
        if (active()) await this.emit({ type: 'progress', message: dualAudio ? '双路语音识别已就绪' : '语音识别已就绪' })
      } catch { await this.stopAsr(); await this.emit({ type: 'progress', message: '语音识别不可用，请使用手动输入' }) }
    } else await this.emit({ type: 'progress', message: '未配置 DashScope API Key，请使用手动输入' })
    if (this.closed || this.context.signal.aborted) return
    await this.emit({ type: 'started', session_id: this.sessionId, ...(dualAudio ? { audio_ready: this.asrs.size === 2 } : {}) })
  }

  audio(bytes: Uint8Array, source: 'system' | 'microphone' = 'system'): void {
    if (this.closed || this.stopped || this.context.signal.aborted) return
    if (this.dualAudio && this.asrs.size !== 2) return
    const asr = this.asrs.get(source)
    if (asr && !asr.sendAudio(bytes)) {
      void this.emit({ type: 'error', message: 'ASR: 语音连接拥堵或已断开，请重新进入' })
      void this.stopAsr()
    }
  }

  private async persist(): Promise<void> { if (this.state) { this.state.updated_at = new Date().toISOString(); await this.deps.repository.saveSession(this.state) } }

  private async utterance(text: string, role: 'hr' | 'candidate', answer?: AbortController): Promise<void> {
    if (!this.state || !this.navigator) return
    this.state.conversation.push({ role, text, at: new Date().toISOString() })
    if (role === 'candidate') { await this.persist(); void this.monitor([...this.state.conversation]); return }
    this.state.turn_count += 1
    await this.persist()
    const signal = answer ? AbortSignal.any([this.context.signal, answer.signal]) : this.context.signal
    signal.throwIfAborted()
    const answerContext = { ...this.context, signal }
    const matched = await this.navigator.match(answerContext, this.deps.embeddings, text, this.state.last_node_id)
    signal.throwIfAborted()
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
    const prior = snapshot.slice(-13, -1).map((turn) => `  ${turn.role === 'hr' ? 'HR' : '候选人'}: ${turn.text}`).join('\n').slice(-8000)
    const prompt = fill(COPILOT_ADVICE_PROMPT, { conversation_section: prior ? `对话历史:\n${prior}\n\n` : '', utterance: text, highlights: summaryPoints(fit.highlights, 3), weak_points: summaryPoints(profile.weak_points, 5), key_points: [...strings(node?.recommended_points), ...strings(hint?.safe_talking_points)].slice(0, 5).join('; ') || '无' })
    const started = Date.now(); let first: number | undefined; let chunks = 0
    try {
      for await (const token of this.deps.ai.stream(answerContext, [{ role: 'system', content: '直接输出答案，不要 JSON 格式' }, { role: 'user', content: prompt }], { reasoningEffort: 'none', maxTokens: 600 })) {
        signal.throwIfAborted()
        chunks += 1; if (first === undefined) { first = Date.now() - started; await this.emit({ type: 'answer_meta', first_token_ms: first }) }
        await this.emit({ type: 'answer_chunk', text: token })
      }
    } finally { await this.emit({ type: 'answer_done', total_ms: Date.now() - started, chunk_count: chunks }) }
  }

  private async hrProfile(turns: CopilotConversationTurn[]): Promise<void> {
    if (turns.length < 3 || this.stopped) return
    try { const result = parseObject(await this.deps.ai.complete(this.context, [{ role: 'system', content: '只输出 JSON' }, { role: 'user', content: fill(COPILOT_HR_PROFILE_PROMPT, { conversation: conversationText(turns) }) }], STRUCTURED_CHAT_OPTIONS), validateHrProfile); if (result && !this.stopped) await this.emit({ ...result, type: 'hr_profile_update' }) } catch { /* background analysis is best effort */ }
  }

  private async monitor(turns: CopilotConversationTurn[]): Promise<void> {
    if (!turns.length || this.stopped) return
    const fit = object(this.prep.fit_report); const jd = object(this.prep.jd_analysis); const profile = object(this.prep.profile)
    const skills = items(jd.required_skills).slice(0, 10).map((item) => String(item.skill || JSON.stringify(item))).join('; ') || '无'
    try { const result = parseObject(await this.deps.ai.complete(this.context, [{ role: 'system', content: '只输出 JSON' }, { role: 'user', content: fill(COPILOT_MONITOR_PROMPT, { conversation: conversationText(turns), required_skills: skills, highlights: summaryPoints(fit.highlights, 5), weak_points: summaryPoints(profile.weak_points, 5) }) }], STRUCTURED_CHAT_OPTIONS), validateMonitor); if (result && !this.stopped) await this.emit({ ...result, type: 'monitor_update' }) } catch { /* background analysis is best effort */ }
  }

  private async stopAsr(): Promise<void> {
    this.audioEpoch += 1
    const sessions = [...this.asrs.values()]
    this.asrs.clear()
    const results = await Promise.allSettled(sessions.map((asr) => asr.stop()))
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }

  private async stop(): Promise<void> { this.stopped = true; await this.stopAsr(); if (this.state) { this.state.status = 'stopped'; await this.persist() }; await this.emit({ type: 'stopped' }) }
  close(): Promise<void> {
    this.closed = true; this.stopped = true
    this.answer?.abort()
    return this.closing ||= this.finishClose()
  }

  private async finishClose(): Promise<void> {
    // A pending handshake may need stop() to settle, so stop existing ASR first.
    try { await this.stopAsr() }
    finally {
      await this.chain.catch(() => {})
      // Also cover startup that was still acquiring dependencies when close began.
      await this.stopAsr()
      this.stopped = true
    }
  }
}

export class CopilotRealtimeService implements CopilotRealtimeUseCases {
  constructor(private readonly deps: CopilotDependencies) {}
  connect(context: RequestContext, sessionId: string, emit: (event: CopilotServerEvent) => Promise<void>): CopilotRealtimeConnection { return new RealtimeConnection(this.deps, context, sessionId, emit) }
}
