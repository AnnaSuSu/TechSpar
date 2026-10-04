import type { InterviewStreamEvent } from './results.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { TextGenerationUseCases } from '../provider/ports.ts'
import type { CandidateProfilePort, ResumeInterviewStateRepository } from './ports.ts'
import { INTERVIEW_PHASES, type InlineEvaluation, type ResumeInterviewState } from './model.ts'
import { fill, RESUME_INTERVIEWER_SYSTEM } from './prompts.ts'
import { finiteNumber, isRecord, optionalText, StructuredOutputError } from '../kernel/structured-output.ts'

const SCORED_PHASES = new Set(['technical', 'project_deep_dive', 'behavioral'])
const HARD_MAX_PER_PHASE = 10
const EVAL_PATTERN = /<!--EVAL:(.*?)-->/s

export function parseInlineEvaluation(content: string): { content: string; evaluation?: InlineEvaluation } {
  const match = content.match(EVAL_PATTERN)
  if (!match) {
    const marker = content.indexOf('<!--EVAL:')
    return { content: marker < 0 ? content : content.slice(0, marker).trimEnd() }
  }
  const clean = content.replace(EVAL_PATTERN, '').trimEnd()
  try {
    const raw: unknown = JSON.parse(match[1]!)
    if (!isRecord(raw)) throw new StructuredOutputError('expected an object', 'evaluation')
    if (raw.should_advance !== undefined && typeof raw.should_advance !== 'boolean') throw new StructuredOutputError('expected a boolean', 'evaluation.should_advance')
    const score = raw.score === undefined ? undefined : finiteNumber(raw.score, 'evaluation.score', 0, 10)
    const brief = optionalText(raw.brief, 'evaluation.brief')
    const evidence = optionalText(raw.evidence, 'evaluation.evidence')
    return { content: clean, evaluation: { ...(raw.should_advance === undefined ? {} : { should_advance: raw.should_advance as boolean }), ...(score === undefined ? {} : { score }), ...(brief === undefined ? {} : { brief }), ...(evidence === undefined ? {} : { evidence }) } }
  } catch { return { content: clean } }
}

export function routeAfterAnswer(state: ResumeInterviewState, maxQuestionsPerPhase = 4): 'ask' | 'advance' | 'end' {
  if (state.is_finished) return 'end'
  const count = state.phase_question_count
  if (count >= HARD_MAX_PER_PHASE) return 'advance'
  if (state.phase === 'greeting' && count >= 1) return 'advance'
  if (state.phase === 'self_intro' && count >= 2) return 'advance'
  if (state.phase === 'reverse_qa' && count >= 2) return 'end'
  if (SCORED_PHASES.has(state.phase)) {
    const score = state.last_eval.score
    const weak = typeof score === 'number' && score < 5
    if (count >= 2 && state.last_eval.should_advance && !weak) return 'advance'
    if (count >= maxQuestionsPerPhase) return 'advance'
  }
  return 'ask'
}

function advance(state: ResumeInterviewState): void {
  const index = INTERVIEW_PHASES.indexOf(state.phase)
  if (index < 0 || index >= INTERVIEW_PHASES.length - 1) { state.is_finished = true; return }
  state.phase = INTERVIEW_PHASES[index + 1]!
  state.phase_question_count = 0
  state.last_eval = {}
}

export class ResumeInterviewEngine {
  constructor(
    private readonly ai: TextGenerationUseCases,
    private readonly states: ResumeInterviewStateRepository,
    private readonly profile: CandidateProfilePort,
    private readonly maxQuestionsPerPhase = 4,
  ) {}

  private async system(state: ResumeInterviewState, userId: string): Promise<string> {
    return fill(RESUME_INTERVIEWER_SYSTEM, {
      target_role: state.target_role || '候选人应聘岗位',
      job_description: state.job_description || '未提供岗位 JD，请结合目标岗位和简历面试。',
      resume_context: state.resume_context,
      phase: state.phase,
      asked_questions: state.questions_asked.length ? state.questions_asked.map((value) => `- ${value}`).join('\n') : '无',
      user_profile: await this.profile.summary(userId),
    })
  }

  async start(context: RequestContext, input: { sessionId: string; targetRole: string; jobDescription: string; resumeContext: string }): Promise<{ opening: string; state: ResumeInterviewState }> {
    const state: ResumeInterviewState = {
      messages: [], phase: 'greeting', target_role: input.targetRole.trim() || '候选人应聘岗位',
      job_description: input.jobDescription.trim(), resume_context: input.resumeContext,
      questions_asked: [], phase_question_count: 0, is_finished: false, last_eval: {}, eval_history: [],
    }
    const opening = await this.ai.complete(context, [
      { role: 'system', content: await this.system(state, context.userId!) },
      { role: 'user', content: '面试开始，请开场并让候选人做自我介绍。' },
    ])
    state.messages.push({ role: 'assistant', content: opening })
    return { opening, state }
  }

  private applyAnswer(state: ResumeInterviewState, message: string): boolean {
    state.messages.push({ role: 'user', content: message })
    const decision = routeAfterAnswer(state, this.maxQuestionsPerPhase)
    if (decision === 'end') { state.is_finished = true; return false }
    if (decision === 'advance') { advance(state); if (state.is_finished) return false }
    return true
  }

  private absorb(state: ResumeInterviewState, raw: string): string {
    const parsed = parseInlineEvaluation(raw)
    const questionIndex = state.phase_question_count
    state.messages.push({ role: 'assistant', content: parsed.content })
    state.questions_asked.push(parsed.content.slice(0, 100))
    state.phase_question_count += 1
    state.last_eval = {}
    if (parsed.evaluation) {
      const evaluation = { ...parsed.evaluation, phase: state.phase, question_index: questionIndex }
      state.last_eval = evaluation
      state.eval_history.push(evaluation)
    }
    return parsed.content
  }

  async turn(context: RequestContext, sessionId: string, state: ResumeInterviewState, message: string): Promise<{ message: string; isFinished: boolean }> {
    if (!this.applyAnswer(state, message)) { await this.states.save(sessionId, context.userId!, state); return { message: '', isFinished: true } }
    const raw = await this.ai.complete(context, [{ role: 'system', content: await this.system(state, context.userId!) }, ...state.messages])
    const clean = this.absorb(state, raw)
    await this.states.save(sessionId, context.userId!, state)
    return { message: clean, isFinished: state.is_finished }
  }

  async *stream(context: RequestContext, sessionId: string, state: ResumeInterviewState, message: string): AsyncIterable<InterviewStreamEvent> {
    if (!this.applyAnswer(state, message)) {
      await this.states.save(sessionId, context.userId!, state)
      yield { done: true, is_finished: true }
      return
    }
    let raw = ''
    let visible = ''
    for await (const token of this.ai.stream(context, [{ role: 'system', content: await this.system(state, context.userId!) }, ...state.messages])) {
      raw += token
      const marker = raw.indexOf('<!--EVAL:')
      const safe = marker >= 0 ? raw.slice(0, marker) : raw.slice(0, Math.max(0, raw.length - 9))
      if (safe.length > visible.length) { const next = safe.slice(visible.length); visible = safe; if (next) yield { token: next } }
    }
    const clean = this.absorb(state, raw)
    if (clean.length > visible.length) yield { token: clean.slice(visible.length) }
    await this.states.save(sessionId, context.userId!, state)
    yield { done: true, is_finished: state.is_finished }
  }
}
