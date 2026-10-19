import type { IdGenerator } from '../account/ports.ts'
import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import type { CopilotConversationTurn, CopilotReviewSubmission, CopilotSessionState, CopilotSessionSummary } from './model.ts'
import type { CopilotRepository, CopilotReviewPort, CopilotSessionUseCases } from './ports.ts'

export const COPILOT_TRANSCRIPT_LIMIT = 40_000
const ACTIVE_WINDOW_MS = 120_000
const CLAIM_WINDOW_MS = 120_000
const labels = { hr: '面试官', candidate: '候选人' } as const
function user(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }

export function copilotTranscript(turns: readonly CopilotConversationTurn[]) {
  const blocks: Array<{ role: CopilotConversationTurn['role']; text: string }> = []
  for (const turn of turns) {
    const text = turn.text.trim()
    if (!text) continue
    const last = blocks.at(-1)
    if (last?.role === turn.role) last.text += ` ${text}`
    else blocks.push({ role: turn.role, text })
  }
  return { text: blocks.map((block) => `${labels[block.role]}: ${block.text}`).join('\n\n'), hrBlocks: blocks.filter((block) => block.role === 'hr').length, candidateBlocks: blocks.filter((block) => block.role === 'candidate').length }
}

function summary(state: CopilotSessionState): CopilotSessionSummary {
  return { session_id: state.session_id, prep_id: state.prep_id, status: state.status, created_at: state.created_at, updated_at: state.updated_at, review_session_id: state.review_session_id || null,
    hr_turns: state.conversation.filter((turn) => turn.role === 'hr' && turn.text.trim()).length,
    candidate_turns: state.conversation.filter((turn) => turn.role === 'candidate' && turn.text.trim()).length }
}
function submission(sessionId: string, reviewId: string, created: boolean): CopilotReviewSubmission {
  return { copilot_session_id: sessionId, review_session_id: reviewId, mode: 'copilot', status: 'pending', created }
}

export class CopilotSessionService implements CopilotSessionUseCases {
  private readonly pending = new Map<string, Promise<CopilotReviewSubmission>>()
  constructor(private readonly deps: { repository: CopilotRepository; reviews: CopilotReviewPort; ids: IdGenerator; now?: () => number }) {}
  private now(): number { return this.deps.now?.() ?? Date.now() }
  private async load(context: RequestContext, sessionId: string) {
    const state = await this.deps.repository.loadSession(sessionId, user(context))
    if (!state) throw new AppError('实战记录不存在', 404)
    return state
  }
  private async prep(context: RequestContext, prepId: string) {
    const prep = await this.deps.repository.getPrep(prepId, user(context))
    if (!prep) throw new AppError('准备记录不存在', 404)
    return prep
  }
  private active(state: CopilotSessionState): boolean {
    return state.status === 'active' && (!Number.isFinite(Date.parse(state.updated_at)) || this.now() - Date.parse(state.updated_at) < ACTIVE_WINDOW_MS)
  }
  async list(context: RequestContext, prepId: string) {
    await this.prep(context, prepId)
    return (await this.deps.repository.listSessions(prepId, user(context))).map(summary)
  }
  async get(context: RequestContext, sessionId: string) {
    const state = await this.load(context, sessionId)
    const prep = await this.prep(context, state.prep_id)
    return { ...summary(state), company: prep.company, position: prep.position, conversation: state.conversation }
  }
  async delete(context: RequestContext, sessionId: string): Promise<{ ok: true }> {
    const state = await this.load(context, sessionId)
    if (this.active(state)) throw new AppError('面试仍在进行，请先结束面试', 409)
    if (state.review_claimed_at && this.now() - Date.parse(state.review_claimed_at) < CLAIM_WINDOW_MS) throw new AppError('复盘正在创建，请稍后重试', 409)
    if (!await this.deps.repository.deleteSession(sessionId, user(context))) throw new AppError('实战记录不存在', 404)
    return { ok: true }
  }
  async review(context: RequestContext, sessionId: string): Promise<CopilotReviewSubmission> {
    const key = JSON.stringify([user(context), sessionId])
    const existing = this.pending.get(key)
    if (existing) return { ...await existing, created: false }
    const operation = this.createReview(context, sessionId)
    this.pending.set(key, operation)
    try { return await operation }
    finally { this.pending.delete(key) }
  }
  private async createReview(context: RequestContext, sessionId: string): Promise<CopilotReviewSubmission> {
    const state = await this.load(context, sessionId)
    const prep = await this.prep(context, state.prep_id)
    if (state.review_session_id) {
      // A missing review during another process's submission is a reservation,
      // not a deleted review. Expiry also allows recovery after a process crash.
      if (state.review_claimed_at && this.now() - Date.parse(state.review_claimed_at) < CLAIM_WINDOW_MS) throw new AppError('复盘正在创建，请稍后重试', 409)
      if (await this.deps.reviews.ensureSubmitted(context, state.review_session_id)) {
        await this.deps.repository.completeReviewLink(sessionId, user(context), state.review_session_id)
        return submission(sessionId, state.review_session_id, false)
      }
    }
    if (this.active(state)) throw new AppError('面试仍在进行，请先结束面试', 409)
    const transcript = copilotTranscript(state.conversation)
    if (!transcript.hrBlocks || !transcript.candidateBlocks) throw new AppError('需要至少一段面试官提问和一段本人回答才能生成复盘', 400)
    if (transcript.text.length > COPILOT_TRANSCRIPT_LIMIT) throw new AppError(`对话超过 ${COPILOT_TRANSCRIPT_LIMIT} 字符，暂不支持生成复盘；原始记录已保留`, 400)
    context.signal.throwIfAborted()
    const reviewId = this.deps.ids.next()
    const claimed = await this.deps.repository.linkReview(sessionId, user(context), reviewId, state.review_session_id || null, new Date(this.now()).toISOString())
    if (!claimed) {
      const current = await this.load(context, sessionId)
      if (current.review_session_id && !current.review_claimed_at && await this.deps.reviews.ensureSubmitted(context, current.review_session_id)) return submission(sessionId, current.review_session_id, false)
      throw new AppError('复盘正在创建，请稍后重试', 409)
    }
    try {
      await this.deps.reviews.analyzeConversation(context, { sessionId: reviewId, transcript: transcript.text, company: prep.company, position: prep.position, meta: { copilot_session_id: sessionId, prep_id: prep.prep_id } })
    } catch (error) {
      await this.deps.repository.unlinkReview(sessionId, user(context), reviewId)
      throw error
    }
    await this.deps.repository.completeReviewLink(sessionId, user(context), reviewId)
    return submission(sessionId, reviewId, true)
  }
}
