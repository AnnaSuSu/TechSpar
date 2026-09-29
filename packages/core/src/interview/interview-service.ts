import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError, ProviderResponseError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { STRUCTURED_CHAT_OPTIONS } from '../provider/ports.ts'
import type { InterviewUseCases, InterviewDependencies } from './ports.ts'
import type { InterviewDraftResult, InterviewResumeResult, InterviewReviewSubmissionResult, InterviewStartResult, JobPrepPreview, JobPrepStartResult, TaskStatusResult } from './results.ts'
import type {
  InterviewAnswer,
  InterviewMode,
  InterviewQuestion,
  InterviewSession,
  JobPrepInput,
  StartInterviewInput,
  TaskRecord,
} from './model.ts'
import {
  DRILL_EVALUATION_PROMPT,
  DRILL_QUESTION_PROMPT,
  fill,
  JOB_EVALUATION_PROMPT,
  JOB_PREVIEW_PROMPT,
  JOB_QUESTION_PROMPT,
  REFERENCE_ANSWER_PROMPT,
  REVIEW_PROMPT,
} from './prompts.ts'
import { ResumeInterviewEngine } from './resume-state-machine.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Expected JSON object')
  return value as Record<string, unknown>
}

function questions(value: unknown, limit: number): InterviewQuestion[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).questions)
      ? (value as { questions: unknown[] }).questions
      : undefined
  if (!items) throw new SyntaxError('Expected JSON question array')
  return items.slice(0, limit).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const source = item as Record<string, unknown>
    const question = typeof source.question === 'string' ? source.question.trim() : ''
    if (!question) return []
    const difficulty = Number(source.difficulty || 3)
    return [{ ...source, id: source.id as string | number ?? index + 1, question, difficulty: Number.isFinite(difficulty) ? difficulty : 3 } as InterviewQuestion]
  })
}

function topicQuestionMaxTokens(count: number): number {
  return Math.min(8192, Math.max(2048, count * 512))
}

function answerMap(answers: InterviewAnswer[]): Map<string, string> {
  return new Map(answers.map((answer) => [String(answer.question_id), String(answer.answer || '')]))
}

function answerOverride(value: unknown): InterviewAnswer[] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: InterviewAnswer[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
    const source = item as Record<string, unknown>
    if ((typeof source.question_id !== 'string' && typeof source.question_id !== 'number') || typeof source.answer !== 'string') return undefined
    output.push({ ...source, question_id: source.question_id, answer: source.answer } as InterviewAnswer)
  }
  return output
}

function answersFromTranscript(session: InterviewSession): InterviewAnswer[] {
  const output: InterviewAnswer[] = []
  const remaining = new Map<string, InterviewQuestion[]>()
  for (const question of session.questions) {
    const matches = remaining.get(question.question) || []
    matches.push(question)
    remaining.set(question.question, matches)
  }
  let activeQuestion: InterviewQuestion | undefined
  for (const message of session.transcript) {
    if (message.role === 'assistant') {
      activeQuestion = remaining.get(message.content)?.shift()
      continue
    }
    if (activeQuestion) output.push({ question_id: activeQuestion.id, answer: message.content })
    activeQuestion = undefined
  }
  return output
}

function resumeOverall(value: unknown): Record<string, unknown> {
  const source = objectOrEmpty(value)
  const output: Record<string, unknown> = {}
  if (typeof source.avg_score === 'number' && Number.isFinite(source.avg_score)) output.avg_score = source.avg_score
  const dimensions = Object.fromEntries(Object.entries(objectOrEmpty(source.dimension_scores)).filter(([, score]) => typeof score === 'number' && Number.isFinite(score)))
  if (Object.keys(dimensions).length) output.dimension_scores = dimensions
  return output
}

function qaText(items: InterviewQuestion[], answers: InterviewAnswer[]): string {
  const values = answerMap(answers)
  return items.map((question) => {
    const answer = values.get(String(question.id)) || ''
    return `### Q${question.id} | 难度 ${question.difficulty || 3}/5\n**考察点**: ${question.focus_area || ''}\n**题目**: ${question.question}\n**回答**: ${answer || '未作答'}`
  }).join('\n\n')
}

function markdownReview(title: string, session: InterviewSession, result: Record<string, unknown>): string {
  const scores = Array.isArray(result.scores) ? result.scores as Array<Record<string, unknown>> : []
  const overall = objectOrEmpty(result.overall)
  const byId = new Map(scores.map((score) => [String(score.question_id), score]))
  const lines = [`# ${title}`, '', '## 整体表现', String(overall.summary || '暂无总结')]
  if (typeof overall.avg_score === 'number') lines.push('', `平均分：${overall.avg_score}/10`)
  lines.push('', '## 逐题反馈')
  for (const question of session.questions) {
    const score = byId.get(String(question.id)) || {}
    lines.push('', `### Q${question.id} ${question.question}`, `- 得分：${score.score ?? '-'}/10`, `- 点评：${score.assessment || '暂无'}`, `- 改进：${score.improvement || '暂无'}`)
  }
  const weak = Array.isArray(overall.new_weak_points) ? overall.new_weak_points : []
  if (weak.length) lines.push('', '## 需要提升', ...weak.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`))
  return lines.join('\n')
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('；')
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(text).filter(Boolean).join('；')
  return ''
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function joined(value: unknown): string {
  return textList(value).join('；')
}

function normalizeFocusAreas(value: unknown): Array<{ area: string; priority: string; reason: string }> {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = objectOrEmpty(item)
    return {
      area: text(record.area || record.topic || record.name),
      priority: text(record.priority || record.importance),
      reason: text(record.reason) || joined(record.expected_capabilities),
    }
  }).filter((item) => item.area)
}

function normalizePriorities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return item.trim()
    const record = objectOrEmpty(item)
    const topic = text(record.topic || record.title)
    const actions = joined(record.actions)
    return [topic, actions].filter(Boolean).join('：')
  }).filter(Boolean)
}

function normalizeQuestionGroups(value: unknown): Array<{ title: string; reason: string; sample_questions: string[] }> {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = objectOrEmpty(item)
    return {
      title: text(record.title || record.group),
      reason: text(record.reason),
      sample_questions: textList(record.sample_questions || record.questions),
    }
  }).filter((item) => item.title)
}

function normalizeEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return item.trim()
    const record = objectOrEmpty(item)
    const evidence = text(record.evidence || record.description || record.item)
    const relevance = text(record.relevance)
    return relevance ? `${evidence}（${relevance}）` : evidence
  }).filter(Boolean)
}

function normalizeRiskGaps(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return item.trim()
    const record = objectOrEmpty(item)
    return [text(record.gap || record.topic), text(record.reason)].filter(Boolean).join('：')
  }).filter(Boolean)
}

function normalizeStories(value: unknown): Array<{ project: string; reason: string }> {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = objectOrEmpty(item)
    return {
      project: text(record.project || record.story),
      reason: text(record.reason) || joined(record.evidence_to_prepare),
    }
  }).filter((item) => item.project)
}

function userId(context: RequestContext): string {
  if (!context.userId) throw new AuthenticationError()
  return context.userId
}

export class InterviewService implements InterviewUseCases {
  private readonly resumeEngine: ResumeInterviewEngine

  constructor(private readonly deps: InterviewDependencies) {
    this.resumeEngine = new ResumeInterviewEngine(deps.ai, deps.states, deps.profile, deps.maxQuestionsPerPhase)
  }

  async previewJob(context: RequestContext, input: JobPrepInput): Promise<{ preview: JobPrepPreview }> {
    const id = userId(context)
    const jd = input.jd_text.trim()
    if (jd.length < 50) throw new AppError('JD 内容太短，无法分析。', 400)
    const useResume = input.use_resume ?? true
    const resumeContext = useResume ? (await this.deps.resume.text(context)).slice(0, 5000) : ''
    const parsed = object(parseJsonResponse(await this.deps.ai.complete(context, [
      { role: 'system', content: '你是 JD 备面分析引擎。只返回 JSON。' },
      { role: 'user', content: fill(JOB_PREVIEW_PROMPT, { company: input.company || '未提供', position: input.position || '未提供', jd_text: jd.slice(0, 6000), resume_context: resumeContext || '未启用简历联动', user_profile: await this.deps.profile.summary(id) }) },
    ], STRUCTURED_CHAT_OPTIONS)))
    const alignment = objectOrEmpty(parsed.resume_alignment)
    return { preview: {
      company: (input.company || String(parsed.company || '')).trim(),
      position: (input.position || String(parsed.position || '')).trim(),
      role_summary: text(parsed.role_summary),
      focus_areas: normalizeFocusAreas(parsed.focus_areas),
      likely_question_groups: normalizeQuestionGroups(parsed.likely_question_groups),
      resume_alignment: {
        resume_used: Boolean(useResume && resumeContext), fit_assessment: text(alignment.fit_assessment),
        matching_evidence: normalizeEvidence(alignment.matching_evidence),
        risk_gaps: normalizeRiskGaps(alignment.risk_gaps),
        recommended_stories: normalizeStories(alignment.recommended_stories),
      },
      prep_priorities: normalizePriorities(parsed.prep_priorities),
      question_blueprint: Array.isArray(parsed.question_blueprint) ? parsed.question_blueprint : [],
      jd_excerpt: jd.slice(0, 1500),
    } }
  }

  async startJob(context: RequestContext, input: JobPrepInput): Promise<JobPrepStartResult> {
    const id = userId(context)
    const jd = input.jd_text.trim()
    if (jd.length < 50) throw new AppError('JD 内容太短，无法生成训练。', 400)
    const preview = input.preview_data || (await this.previewJob(context, input)).preview
    const resumeContext = (input.use_resume ?? true) ? (await this.deps.resume.text(context)).slice(0, 5000) : ''
    const generated = questions(parseJsonResponse(await this.deps.ai.complete(context, [
      { role: 'system', content: '你是 JD 备面出题引擎。只返回 JSON 对象，题目放在 questions 数组中。' },
      { role: 'user', content: fill(JOB_QUESTION_PROMPT, { preview: JSON.stringify(preview, null, 2).slice(0, 5000), jd_text: jd.slice(0, 5000), resume_context: resumeContext || '未启用简历联动', user_profile: await this.deps.profile.summary(id) }) },
    ], STRUCTURED_CHAT_OPTIONS)), 8)
    if (generated.length < 4) throw new AppError('JD 备面出题失败，生成的问题数量不足。请重试。', 500)
    const sessionId = this.deps.ids.next()
    const meta = { company: String(preview.company || input.company || '').trim(), position: String(preview.position || input.position || '').trim() || 'JD 备面', jd_text: jd, use_resume: input.use_resume ?? true, preview }
    await this.deps.sessions.create({ sessionId, userId: id, mode: 'jd_prep', questions: generated, meta })
    return { session_id: sessionId, mode: 'jd_prep', questions: generated, preview, company: meta.company, position: meta.position, meta }
  }

  async start(context: RequestContext, input: StartInterviewInput): Promise<InterviewStartResult> {
    const id = userId(context)
    const sessionId = this.deps.ids.next()
    if (input.mode === 'topic_drill') {
      const topics = await this.deps.knowledgeStore.loadTopics(id)
      if (!input.topic || !topics[input.topic]) throw new AppError(`Invalid topic. Available: ${JSON.stringify(Object.keys(topics))}`, 400)
      const training = await this.deps.settings.loadTraining(id)
      const count = input.num_questions || training.num_questions
      const divergence = input.divergence || training.divergence
      const [knowledge, highFrequency, recent, profile] = await Promise.all([
        this.deps.knowledge.context(context, input.topic, [`${topics[input.topic]!.name} 核心知识点 面试常见问题`], { charBudget: 8000 }),
        this.deps.knowledgeStore.readHighFrequency(id, input.topic),
        this.deps.sessions.recentQuestions(id, input.topic),
        this.deps.profile.summary(id, input.topic),
      ])
      const messages = [
        { role: 'system', content: '你是专项训练出题引擎。只返回 JSON 对象，题目放在 questions 数组中。' },
        { role: 'user', content: fill(DRILL_QUESTION_PROMPT, { topic_name: topics[input.topic]!.name, num_questions: count, knowledge_context: knowledge, user_profile: profile, high_frequency: highFrequency.slice(0, 4000) || '暂无', recent_questions: recent.map((value) => `- ${value}`).join('\n') || '暂无', divergence }) },
      ] as const
      let generated: InterviewQuestion[] = []
      for (let attempt = 0; attempt < 2 && generated.length !== count; attempt += 1) {
        const text = await this.deps.ai.complete(context, messages, { ...STRUCTURED_CHAT_OPTIONS, maxTokens: topicQuestionMaxTokens(count) })
        try { generated = questions(parseJsonResponse(text), count) } catch { generated = [] }
      }
      if (generated.length !== count) throw new ProviderResponseError('模型返回的专项训练题目不完整，已自动重试，请稍后再试或更换模型。')
      await this.deps.sessions.create({ sessionId, userId: id, mode: 'topic_drill', topic: input.topic, questions: generated })
      return { session_id: sessionId, mode: 'topic_drill', topic: input.topic, questions: generated }
    }
    if (input.mode === 'resume') {
      const targetRole = (input.target_role || await this.deps.profile.targetRole(id)).trim()
      if (!targetRole) throw new AppError('请先填写目标岗位', 400)
      await this.deps.profile.updateTargetRole(id, targetRole)
      const started = await this.resumeEngine.start(context, { sessionId, targetRole, jobDescription: (input.job_description || '').trim(), resumeContext: await this.deps.resume.text(context) })
      await this.deps.sessions.create({ sessionId, userId: id, mode: 'resume', topic: input.topic, meta: { target_role: targetRole, job_description: (input.job_description || '').trim() } })
      try {
        await this.deps.states.save(sessionId, id, started.state)
        await this.deps.sessions.appendMessage(sessionId, id, 'assistant', started.opening)
      } catch (error) {
        await this.deps.sessions.delete(sessionId, id)
        throw error
      }
      return { session_id: sessionId, mode: 'resume', topic: input.topic, target_role: targetRole, job_description: (input.job_description || '').trim(), message: started.opening }
    }
    throw new AppError(`Unsupported mode for this endpoint: ${input.mode}`, 400)
  }

  async chat(context: RequestContext, sessionId: string, message: string) {
    const id = userId(context)
    const state = await this.deps.states.load(sessionId, id)
    if (!state) throw new AppError('Session not found or no recoverable state.', 404)
    if (state.is_finished) return { session_id: sessionId, message: '', is_finished: true }
    await this.deps.sessions.appendMessage(sessionId, id, 'user', message)
    const reply = await this.resumeEngine.turn(context, sessionId, state, message)
    if (reply.message) await this.deps.sessions.appendMessage(sessionId, id, 'assistant', reply.message)
    return { session_id: sessionId, message: reply.message, is_finished: reply.isFinished }
  }

  async *chatStream(context: RequestContext, sessionId: string, message: string): AsyncIterable<{ token?: string; done?: boolean; is_finished?: boolean }> {
    const id = userId(context)
    const state = await this.deps.states.load(sessionId, id)
    if (!state) throw new AppError('Session not found or no recoverable state.', 404)
    if (state.is_finished) { yield { done: true, is_finished: true }; return }
    await this.deps.sessions.appendMessage(sessionId, id, 'user', message)
    let full = ''
    for await (const event of this.resumeEngine.stream(context, sessionId, state, message)) { if (event.token) full += event.token; yield event }
    if (full) await this.deps.sessions.appendMessage(sessionId, id, 'assistant', full)
  }

  private taskType(mode: InterviewMode): string {
    return ({ resume: 'resume_review', topic_drill: 'drill_review', jd_prep: 'jd_review', recording: 'recording_review' } as const)[mode]
  }

  private async dispatch(session: InterviewSession, answersOverride?: InterviewAnswer[]): Promise<InterviewReviewSubmissionResult> {
    await this.deps.sessions.updateStatus(session.session_id, session.user_id, 'reviewing', { clearError: true })
    await this.deps.tasks.enqueue({ taskId: session.session_id, userId: session.user_id, type: this.taskType(session.mode), payload: { session_id: session.session_id, ...(answersOverride !== undefined ? { answers_override: answersOverride } : {}) } })
    return { session_id: session.session_id, mode: session.mode, status: 'pending' }
  }

  async end(context: RequestContext, sessionId: string, answers: InterviewAnswer[]): Promise<InterviewReviewSubmissionResult> {
    const id = userId(context)
    const session = await this.deps.sessions.get(sessionId, id)
    if (!session) throw new AppError('Session not found.', 404)
    if (session.status === 'reviewed') return { session_id: sessionId, mode: session.mode, status: 'done' }
    if (session.status === 'reviewing') return { session_id: sessionId, mode: session.mode, status: 'pending' }
    const batchMode = session.mode === 'topic_drill' || session.mode === 'jd_prep'
    if (batchMode) await this.deps.sessions.saveAnswers(sessionId, id, answers)
    if (session.status === 'ongoing') { await this.deps.sessions.updateStatus(sessionId, id, 'ended'); session.status = 'ended' }
    return this.dispatch(session, batchMode ? answers : undefined)
  }

  async draft(context: RequestContext, sessionId: string, answers: InterviewAnswer[]): Promise<InterviewDraftResult> {
    const id = userId(context)
    const session = await this.deps.sessions.get(sessionId, id)
    if (!session) throw new AppError('Session not found.', 404)
    if (session.mode !== 'topic_drill' && session.mode !== 'jd_prep') throw new AppError('Only batch-mode sessions support drafts.', 400)
    if (session.status !== 'ongoing') return { session_id: sessionId, status: session.status, saved: false }
    await this.deps.sessions.saveAnswers(sessionId, id, answers)
    return { session_id: sessionId, status: 'ongoing', saved: true }
  }

  async generateReview(context: RequestContext, sessionId: string): Promise<InterviewReviewSubmissionResult> {
    const id = userId(context)
    const session = await this.deps.sessions.get(sessionId, id)
    if (!session) throw new AppError('Session not found.', 404)
    if (session.status === 'reviewed' && !session.meta.profile_extract_failed) return { session_id: sessionId, mode: session.mode, status: 'done' }
    if (session.status === 'reviewing') return { session_id: sessionId, mode: session.mode, status: 'pending' }
    if (session.status === 'ongoing') throw new AppError('面试尚未结束，请先结束面试再生成复盘。', 400)
    if (!['ended', 'review_failed', 'reviewed'].includes(session.status)) throw new AppError(`当前状态 ${session.status} 不支持重新生成复盘。`, 400)
    return this.dispatch(session)
  }

  async runReviewTask(task: TaskRecord): Promise<Record<string, unknown> | undefined> {
    const session = await this.deps.sessions.get(task.task_id, task.user_id)
    if (!session) throw new Error('Session not found.')
    const context: RequestContext = { requestId: `task:${task.task_id}`, userId: task.user_id, signal: new AbortController().signal }
    try {
      if (session.mode === 'resume') {
        const state = await this.deps.states.load(session.session_id, session.user_id)
        if (!state) throw new Error('会话状态已失效，无法恢复')
        const transcript = state.messages.map((message) => `${message.role === 'user' ? '**候选人**' : '**面试官**'}: ${message.content}`).join('\n\n')
        const evaluations = state.eval_history.map((evaluation) => `- [${evaluation.phase || ''}] ${evaluation.score ?? '?'}/10 — ${evaluation.brief || ''}${evaluation.evidence ? `（原话：${evaluation.evidence}）` : ''}`).join('\n')
        const review = await this.deps.ai.complete(context, [{ role: 'system', content: fill(REVIEW_PROMPT, { mode: session.mode, topic: session.topic || '', transcript, evaluations, resume_context: state.resume_context }) }, { role: 'user', content: '请生成复盘报告。' }])
        await this.deps.sessions.saveReview({ sessionId: session.session_id, userId: session.user_id, review })
      } else if (session.mode === 'topic_drill' || session.mode === 'jd_prep') {
        const answers = answerOverride(task.payload.answers_override) ?? answersFromTranscript(session)
        let parsed: Record<string, unknown>
        if (session.mode === 'topic_drill') {
          const topics = await this.deps.knowledgeStore.loadTopics(session.user_id)
          const topicName = topics[session.topic || '']?.name || session.topic || ''
          const references = await this.deps.knowledge.context(context, session.topic || '', session.questions.map((question) => question.question), { topK: 2, charBudget: 8000 })
          parsed = object(parseJsonResponse(await this.deps.ai.complete(context, [{ role: 'system', content: '你是训练评估引擎。只返回 JSON。' }, { role: 'user', content: fill(DRILL_EVALUATION_PROMPT, { topic_name: topicName, qa_pairs: qaText(session.questions, answers), references }) }], STRUCTURED_CHAT_OPTIONS)))
        } else {
          parsed = object(parseJsonResponse(await this.deps.ai.complete(context, [{ role: 'system', content: '你是 JD 备面评估引擎。只返回 JSON。' }, { role: 'user', content: fill(JOB_EVALUATION_PROMPT, { preview: JSON.stringify(session.meta.preview || {}, null, 2).slice(0, 5000), qa_pairs: qaText(session.questions, answers) }) }], STRUCTURED_CHAT_OPTIONS)))
        }
        const scores = Array.isArray(parsed.scores) ? parsed.scores as Array<Record<string, unknown>> : []
        const difficulty = new Map(session.questions.map((question) => [String(question.id), question.difficulty || 3]))
        for (const score of scores) if (score.difficulty === undefined) score.difficulty = difficulty.get(String(score.question_id)) || 3
        const overall = objectOrEmpty(parsed.overall)
        await this.deps.sessions.saveReview({ sessionId: session.session_id, userId: session.user_id, review: markdownReview(session.mode === 'topic_drill' ? '专项训练复盘' : 'JD 定向备面复盘', session, parsed), scores, weakPoints: Array.isArray(overall.new_weak_points) ? overall.new_weak_points : [], overall })
      } else {
        throw new Error(`Unsupported review mode: ${session.mode}`)
      }
      const reviewed = await this.deps.sessions.get(session.session_id, session.user_id)
      if (reviewed && this.deps.profile.afterReview) {
        try {
          const extraction = await this.deps.profile.afterReview({ userId: session.user_id, session: reviewed })
          const metrics = session.mode === 'resume' ? resumeOverall(extraction) : {}
          if (Object.keys(metrics).length) await this.deps.sessions.saveReview({ sessionId: reviewed.session_id, userId: reviewed.user_id, review: reviewed.review || '', scores: reviewed.scores, weakPoints: reviewed.weak_points, overall: { ...reviewed.overall, ...metrics } })
          await this.deps.sessions.updateMeta(session.session_id, session.user_id, { profile_extract_failed: false })
        }
        catch { await this.deps.sessions.updateMeta(session.session_id, session.user_id, { profile_extract_failed: true }) }
      }
      return { session_id: session.session_id, status: 'done' }
    } catch (error) {
      await this.deps.sessions.updateStatus(session.session_id, session.user_id, 'review_failed', { reviewError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })
      throw error
    }
  }

  async referenceAnswer(context: RequestContext, sessionId: string, questionId: string | number) {
    const id = userId(context)
    const session = await this.deps.sessions.get(sessionId, id)
    if (!session) throw new AppError('Session not found.', 404)
    const key = String(questionId)
    if (session.reference_answers[key]) return { reference_answer: session.reference_answers[key], cached: true }
    const question = session.questions.find((item) => String(item.id) === key)
    if (!question) throw new AppError('Question not found in session.', 404)
    if (!session.topic) throw new AppError('Session missing topic or question text.', 400)
    const topics = await this.deps.knowledgeStore.loadTopics(id)
    const references = await this.deps.knowledge.context(context, session.topic, [question.question], { topK: 3, charBudget: 5000 })
    const answer = (await this.deps.ai.complete(context, [{ role: 'user', content: fill(REFERENCE_ANSWER_PROMPT, { topic_name: topics[session.topic]?.name || session.topic, question: question.question, knowledge_context: references || '（暂无参考材料）' }) }])).trim()
    await this.deps.sessions.saveReferenceAnswer(sessionId, id, key, answer)
    return { reference_answer: answer, cached: false }
  }

  async resume(context: RequestContext, sessionId: string): Promise<InterviewResumeResult> {
    const id = userId(context)
    await this.deps.sessions.expireStaleReviewing(id)
    const session = await this.deps.sessions.get(sessionId, id)
    if (!session) throw new AppError('Session not found.', 404)
    const state = session.mode === 'resume' ? await this.deps.states.load(sessionId, id) : undefined
    return { session_id: sessionId, mode: session.mode, topic: session.topic, status: session.status, review_error: session.review_error, transcript: session.transcript, questions: session.questions, target_role: String(session.meta.target_role || ''), job_description: String(session.meta.job_description || ''), meta: session.meta, can_continue: Boolean(state && !state.is_finished), is_finished: Boolean(state?.is_finished), has_review: Boolean(session.review) }
  }

  async review(context: RequestContext, sessionId: string): Promise<InterviewSession> {
    const session = await this.deps.sessions.get(sessionId, userId(context))
    if (!session) throw new AppError('Session not found.', 404)
    if (!session.review) throw new AppError('Interview not yet reviewed.', 400)
    return session
  }

  async history(context: RequestContext, input: { limit?: number; offset?: number; mode?: InterviewMode; topic?: string }) {
    const id = userId(context)
    await this.deps.sessions.expireStaleReviewing(id)
    return this.deps.sessions.list({ userId: id, limit: Math.min(100, Math.max(1, input.limit ?? 20)), offset: Math.max(0, input.offset ?? 0), mode: input.mode, topic: input.topic })
  }

  async delete(context: RequestContext, sessionId: string) {
    if (!(await this.deps.sessions.delete(sessionId, userId(context)))) throw new AppError('Session not found.', 404)
    return { ok: true as const }
  }

  topics(context: RequestContext) { return this.deps.sessions.topics(userId(context)) }

  async task(context: RequestContext, taskId: string): Promise<TaskStatusResult> {
    const id = userId(context)
    const [task, session] = await Promise.all([this.deps.tasks.get(taskId, id), this.deps.sessions.get(taskId, id)])
    if (!task && !session) throw new AppError('Task not found.', 404)
    if (session?.status === 'reviewed') return { status: 'done', type: task?.type || this.taskType(session.mode) }
    if (session?.status === 'review_failed') return { status: 'error', type: task?.type || this.taskType(session.mode), error: session.review_error }
    if (!task) return { status: 'pending', type: session ? this.taskType(session.mode) : 'review' }
    return { status: task.status === 'pending' || task.status === 'running' ? 'pending' : task.status, type: task.type, ...(task.error ? { error: task.error } : {}), ...(task.result || {}) }
  }
}
