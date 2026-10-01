import type { InterviewAnswer, InterviewQuestion, InterviewSession, TaskRecord } from '../interview/model.ts'
import { fill } from '../interview/prompts.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import type { RequestContext } from '../kernel/context.ts'
import { STRUCTURED_CHAT_OPTIONS } from '../provider/ports.ts'
import { formatDualReview, formatSoloReview } from './formatters.ts'
import type { RecordingAnalyzeInput } from './model.ts'
import type { RecordingDependencies, RecordingUseCases } from './ports.ts'
import { RECORDING_DUAL_EVAL_PROMPT, RECORDING_SOLO_EVAL_PROMPT, RECORDING_STRUCTURE_PROMPT } from './prompts.ts'

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Expected JSON object')
  return value as Record<string, unknown>
}
function arrayOfObjects(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [] }
function contextSuffix(company: unknown, position: unknown): string {
  const lines = [["公司", company], ["岗位", position]].flatMap(([label, value]) => typeof value === 'string' && value.trim() ? [`${label}: ${value.trim()}`] : [])
  return lines.length ? `\n\n## 面试背景\n${lines.join('\n')}` : ''
}
function fileSuffix(filename: string): string {
  const basename = filename.replace(/\\/g, '/').split('/').pop() || ''
  const dot = basename.lastIndexOf('.')
  return dot > 0 ? basename.slice(dot).toLowerCase() : '.webm'
}

export class RecordingService implements RecordingUseCases {
  constructor(private readonly deps: RecordingDependencies) {}

  async transcribe(context: RequestContext, filename: string, bytes: Uint8Array): Promise<{ transcript: string; segments: unknown[] }> {
    id(context)
    if (!bytes.length) throw new AppError('Empty audio file.', 400)
    const suffix = fileSuffix(filename || 'audio.webm')
    try { return { transcript: await this.deps.transcription.transcribe(context, bytes, suffix), segments: [] } }
    catch (error) { throw new AppError(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`, 500) }
  }

  async analyze(context: RequestContext, input: RecordingAnalyzeInput): Promise<{ session_id: string; status: 'pending' }> {
    const userId = id(context)
    const transcript = input.transcript.trim()
    if (!transcript) throw new AppError('Transcript must not be blank.', 400)
    const sessionId = this.deps.ids.next()
    const meta = { recording_mode: input.recording_mode || 'dual', company: (input.company || '').trim(), position: (input.position || '').trim(), source_transcript: input.transcript }
    await this.deps.sessions.create({ sessionId, userId, mode: 'recording', meta })
    try {
      await this.deps.sessions.appendMessage(sessionId, userId, 'user', input.transcript)
      await this.deps.sessions.updateStatus(sessionId, userId, 'reviewing')
      await this.deps.tasks.enqueue({ taskId: sessionId, userId, type: 'recording_review', payload: { session_id: sessionId } })
    } catch (error) {
      await this.deps.sessions.updateStatus(sessionId, userId, 'review_failed', { reviewError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
      throw error
    }
    return { session_id: sessionId, status: 'pending' }
  }

  async runAnalysisTask(task: TaskRecord): Promise<Record<string, unknown>> {
    const session = await this.deps.sessions.get(task.task_id, task.user_id)
    if (!session) throw new Error('Session not found.')
    if (task.payload.profile_only === true) {
      if (session.review == null) throw new Error('No saved review to synchronize')
      await this.deps.sessions.updateStatus(session.session_id, session.user_id, 'reviewed', { clearError: true })
      await this.updateProfile({ ...session, status: 'reviewed' })
      return { session_id: session.session_id, status: 'done' }
    }
    const transcript = String(session.meta.source_transcript || session.transcript[0]?.content || '').trim()
    if (!transcript) throw new Error('Transcript must not be blank.')
    const request: RequestContext = { requestId: `task:${task.task_id}`, userId: task.user_id, signal: new AbortController().signal }
    try {
      let scores: Array<Record<string, unknown>> = []
      let overall: Record<string, unknown> = {}
      let review = ''
      if (session.meta.recording_mode === 'dual') {
        const structured = object(parseJsonResponse(await this.deps.ai.complete(request, [
          { role: 'system', content: '你是面试记录分析引擎。只返回 JSON，不要其他内容。' },
          { role: 'user', content: fill(RECORDING_STRUCTURE_PROMPT, { transcript }) },
        ], STRUCTURED_CHAT_OPTIONS)))
        const pairs = arrayOfObjects(structured.qa_pairs)
        const questions: InterviewQuestion[] = pairs.flatMap((pair, index) => {
          const question = String(pair.question || '').trim()
          return question ? [{ id: pair.id as string | number ?? index + 1, question, difficulty: 3, focus_area: String(pair.focus_area || '') }] : []
        })
        const answers: InterviewAnswer[] = pairs.slice(0, questions.length).map((pair, index) => ({ question_id: questions[index]!.id, answer: String(pair.answer || '') }))
        await this.deps.sessions.saveQuestions(session.session_id, session.user_id, questions)
        await this.deps.sessions.saveAnswers(session.session_id, session.user_id, answers)
        const qa = questions.map((question, index) => `### Q${question.id} (${question.focus_area || ''})\n**题目**: ${question.question}\n**回答**: ${answers[index]?.answer || ''}`).join('\n\n')
        const evaluated = object(parseJsonResponse(await this.deps.ai.complete(request, [
          { role: 'system', content: '你是面试评估引擎。只返回 JSON，不要其他内容。' },
          { role: 'user', content: fill(RECORDING_DUAL_EVAL_PROMPT, { qa_pairs: qa, profile_summary: await this.deps.profile.summary(session.user_id) }) + contextSuffix(session.meta.company, session.meta.position) },
        ], STRUCTURED_CHAT_OPTIONS)))
        scores = arrayOfObjects(evaluated.scores)
        for (const score of scores) if (score.difficulty === undefined) score.difficulty = 3
        overall = object(evaluated.overall || {})
        review = formatDualReview(questions, answers, scores, overall)
      } else {
        const evaluated = object(parseJsonResponse(await this.deps.ai.complete(request, [
          { role: 'system', content: '你是录音评估引擎。只返回 JSON，不要其他内容。' },
          { role: 'user', content: fill(RECORDING_SOLO_EVAL_PROMPT, { transcript, profile_summary: await this.deps.profile.summary(session.user_id) }) + contextSuffix(session.meta.company, session.meta.position) },
        ], STRUCTURED_CHAT_OPTIONS)))
        const topics = arrayOfObjects(evaluated.topics_covered)
        overall = object(evaluated.overall || {})
        overall.topics_covered = topics
        scores = topics.map((topic, index) => ({ question_id: topic.id ?? index + 1, score: topic.score, difficulty: 3 }))
        review = formatSoloReview(topics, overall)
      }
      await this.deps.sessions.saveReview({ sessionId: session.session_id, userId: session.user_id, review, scores, weakPoints: Array.isArray(overall.new_weak_points) ? overall.new_weak_points : [], overall })
      const reviewed = await this.deps.sessions.get(session.session_id, session.user_id)
      if (reviewed) await this.updateProfile(reviewed)
      return { session_id: session.session_id, status: 'done' }
    } catch (error) {
      await this.deps.sessions.updateStatus(session.session_id, session.user_id, 'review_failed', { reviewError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
      throw error
    }
  }

  private async updateProfile(session: InterviewSession): Promise<void> {
    if (!this.deps.profile.afterReview) return
    try {
      await this.deps.profile.afterReview({ userId: session.user_id, session })
      await this.deps.sessions.updateMeta(session.session_id, session.user_id, { profile_extract_failed: false })
    } catch { await this.deps.sessions.updateMeta(session.session_id, session.user_id, { profile_extract_failed: true }) }
  }
}
