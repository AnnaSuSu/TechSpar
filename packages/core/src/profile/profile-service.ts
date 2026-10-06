import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { enumValue, finiteNumber, objectArray, record, requiredText, textValue, StructuredOutputError } from '../kernel/structured-output.ts'
import { STRUCTURED_CHAT_OPTIONS } from '../provider/ports.ts'
import type { CandidateProfilePort } from '../interview/ports.ts'
import type { InterviewSession, TaskRecord } from '../interview/model.ts'
import { fill } from '../interview/prompts.ts'
import { defaultProfile, type CandidateProfile, type PendingProfileMemory, type ProfileViewMarker, type RetrospectiveResult, type WeakPoint } from './model.ts'
import type { ProfileDependencies, ProfileMemoryEntry, ProfileMemorySearchResult, ProfileUseCases } from './ports.ts'

const INFER_ROLE_PROMPT = `根据以下简历内容，推断候选人最可能应聘的岗位名称。给出一个具体岗位，12 个汉字以内；学生可带实习生或校招后缀。只返回岗位名称，不要解释。\n\n{resume}`
const EXTRACT_PROMPT = `你是面试教练分析引擎。根据本次面试记录提取结构化洞察。不要把表达习惯混入知识弱点，不得编造记录中没有的事实。\n\n模式：{mode}\n领域：{topic}\n对话：\n{transcript}\n\n逐题评分：\n{scores}\n\n现有行为信号（尽量复用 ID）：\n{existing_behavior_signals}\n\n复盘：\n{review}\n\n只返回 JSON：{"session_summary":"摘要","weak_points":[{"point":"具体知识薄弱点","topic":"领域"}],"strong_points":[{"point":"具体知识强项","topic":"领域"}],"behavior_signals":[{"action":"ADD|UPDATE|IMPROVE|NOOP","id":"reasoning.example","namespace":"reasoning","polarity":"negative","description":"行为描述","snippet":"本次新证据","evidence_snippet":"改善证据"}],"topic_mastery":{"notes":"掌握情况"},"avg_score":7,"dimension_scores":{"technical_depth":7,"project_articulation":7,"communication":7,"problem_solving":7}}。仅 resume 模式返回四维 dimension_scores，其他模式省略。avg_score 为有效维度的平均分，保留一位小数。行为信号按 action 提供内容：ADD 必须有非空 description 和 snippet；UPDATE 必须有非空 snippet；IMPROVE 必须有非空 evidence_snippet；NOOP 不应用变更。各 action 不适用的文本字段可以省略或填空字符串，但不能使用 null、对象或数组。`
const RETROSPECTIVE_PROMPT = `你是面试教练，请基于「{topic_name}」的多次训练历史生成一份适合窄卡片阅读的 Markdown 回顾。总结整体诊断、逐题得分与依据、进步趋势、稳定强项、反复薄弱点，并给出下一轮训练计划。每个判断必须能在历史中找到依据，不得编造训练记录之外的事实。

当前掌握度：{mastery}

训练历史：
{history}

## 输出要求

- 只输出 Markdown 正文，不要解释生成过程，不要包裹在代码块中。
- 禁止使用 Markdown 表格，不要输出任何由「|」分隔的表格行。当前页面适合窄卡片，表格会降低可读性。
- 只使用当前页面稳定支持的基础 Markdown：标题（#、##、###）、粗体、斜体、无序列表（-）、引用（>）、行内代码、代码块和分割线。
- 不要使用 GFM 表格、任务清单、删除线、HTML、JSX、Mermaid 或数学公式。
- 一级标题只用于报告标题；下面固定使用以下四个二级标题，标题文字必须完全一致：

## 总体诊断

用 2-4 句说明当前掌握度、最近表现和最核心的问题；随后分别用粗体标签「稳定强项」和「反复薄弱点」列出有历史证据支持的内容。必要时使用无序列表，但不要使用有序列表。

## 逐题复盘

先写一句「逐题得分与依据」，然后每道题使用一个独立的粗体行，不要再使用三级或更深标题。格式如下：

**Q1 · 题目或考查点 · 7/10**

- **考查点：** [知识点]
- **关键依据：** [基于回答的具体判断，1-2句话]
- **遗漏与改进：** [最重要的遗漏和下一步改进]

题目较多时，每道题保持简洁；不要把多道题合并到同一段。没有作答的题目明确写「未作答」，不要推测原因。

## 进步趋势

用简短段落或无序列表说明与历史记录相比的变化。只有在至少两次训练记录能够支持时，才描述“进步”“退步”或“稳定”。

## 下一轮训练计划

用 3-5 条无序列表给出按优先级排列的练习动作，每条都要对应前面的薄弱点或遗漏点。

如果历史中没有足够证据支持某个部分，明确写「暂无足够记录」，不要用泛泛的夸奖或推测代替。`
const CONSOLIDATION_PROMPT = `你是面试教练的模式识别引擎。仅从下列活跃薄弱点中归纳跨至少两个领域、比原观察更抽象、可被后续证据证伪的稳定规律。宁可返回空数组，不要编造。\n\n{weak_points}\n\n只返回 JSON：{"patterns":[{"statement":"40字以内的规律","supporting_wp_indices":[0,2],"topic":"cross_cutting","confidence":0.8}]}`

const BEHAVIOR_NAMESPACES = new Set(['reasoning', 'narrative', 'communication', 'metacognition'])
const BEHAVIOR_ID = /^([a-z_]+)\.([a-z][a-z0-9_]*)$/
const WEAK_POINT_SIMILARITY = 0.75
const REVIEW_SIMILARITY = 0.6
const MEMORY_HALF_LIFE_DAYS = 14
const MEMORY_DECAY_WEIGHT = 0.3
const MEMORY_CANDIDATE_COUNT = 20
const MEMORY_ITEM_CHARS = 600
const MEMORY_CONTEXT_CHARS = 2000
const CONSOLIDATION_MIN_ACTIVE = 5
const CONSOLIDATION_COOLDOWN_MS = 24 * 60 * 60 * 1000

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }

function validateProfileObservation(value: unknown, path: string, weak: boolean): void {
  const item = record(value, path)
  requiredText(item.point, `${path}.point`)
  if (item.topic !== undefined) requiredText(item.topic, `${path}.topic`)
  if (item.score !== undefined) finiteNumber(item.score, `${path}.score`, 0, 10)
  if (item.confidence !== undefined) finiteNumber(item.confidence, `${path}.confidence`, 0, 1)
  // These known persisted fields survive observation spreads. Check them before
  // any write, while preserving genuinely unknown provider extensions.
  for (const field of ['first_seen', 'last_seen', 'improved_at', 'archived_at', 'archived_reason', 'source', 'axis']) {
    if (item[field] !== undefined) textValue(item[field], `${path}.${field}`)
  }
  if (item.times_seen !== undefined) finiteNumber(item.times_seen, `${path}.times_seen`)
  for (const field of ['improved', 'archived', ...(weak ? ['user_acknowledged'] : [])]) {
    if (item[field] !== undefined && typeof item[field] !== 'boolean') throw new StructuredOutputError('expected a boolean', `${path}.${field}`)
  }
  if (item.history !== undefined) {
    objectArray(item.history, `${path}.history`).forEach((event, index) => {
      for (const field of ['date', 'event', 'evidence']) if (event[field] !== undefined) textValue(event[field], `${path}.history[${index}].${field}`)
      if (event.score !== undefined) finiteNumber(event.score, `${path}.history[${index}].score`, 0, 10)
    })
  }
  if (weak && item.sr !== undefined) {
    const sr = record(item.sr, `${path}.sr`)
    for (const field of ['interval_days', 'ease_factor', 'repetitions', 'last_score']) if (sr[field] !== undefined) finiteNumber(sr[field], `${path}.sr.${field}`)
    if (sr.next_review !== undefined) textValue(sr.next_review, `${path}.sr.next_review`)
  }
  if (weak && item.consolidates !== undefined) {
    if (!Array.isArray(item.consolidates)) throw new StructuredOutputError('expected an array', `${path}.consolidates`)
    item.consolidates.forEach((point, index) => textValue(point, `${path}.consolidates[${index}]`))
  }
}

function validateProfileExtraction(value: unknown): Record<string, unknown> {
  const source = record(value)
  requiredText(source.session_summary, 'session_summary')
  for (const field of ['weak_points', 'strong_points', 'behavior_signals']) if (!Array.isArray(source[field])) throw new StructuredOutputError('expected an array', field)
  const weakPoints = source.weak_points as unknown[]
  const strongPoints = source.strong_points as unknown[]
  for (const [name, items] of [['weak_points', weakPoints], ['strong_points', strongPoints] ] as const) {
    items.forEach((raw, index) => validateProfileObservation(raw, `${name}[${index}]`, name === 'weak_points'))
  }
  const behaviorSignals = source.behavior_signals as unknown[]
  const behaviorIds = new Set<string>()
  behaviorSignals.forEach((raw, index) => {
    const item = record(raw, `behavior_signals[${index}]`)
    const action = enumValue(item.action, ['ADD', 'UPDATE', 'IMPROVE', 'NOOP'] as const, `behavior_signals[${index}].action`)
    const signalId = requiredText(item.id, `behavior_signals[${index}].id`)
    if (behaviorIds.has(signalId)) throw new StructuredOutputError('IDs must be unique', `behavior_signals[${index}].id`)
    behaviorIds.add(signalId)
    const match = signalId.match(BEHAVIOR_ID)
    if (!match || !BEHAVIOR_NAMESPACES.has(match[1]!)) throw new StructuredOutputError('invalid behavior signal id', `behavior_signals[${index}].id`)
    if (item.namespace !== undefined) {
      requiredText(item.namespace, `behavior_signals[${index}].namespace`)
      if (item.namespace !== match[1]) throw new StructuredOutputError('namespace must match id', `behavior_signals[${index}].namespace`)
    } else item.namespace = match[1]
    if (item.polarity !== undefined) enumValue(item.polarity, ['positive', 'negative'] as const, `behavior_signals[${index}].polarity`)
    for (const field of ['description', 'snippet', 'evidence_snippet']) if (item[field] !== undefined) textValue(item[field], `behavior_signals[${index}].${field}`)
    if (action === 'ADD') requiredText(item.description, `behavior_signals[${index}].description`)
    if (action === 'ADD' || action === 'UPDATE') requiredText(item.snippet, `behavior_signals[${index}].snippet`)
    if (action === 'IMPROVE') requiredText(item.evidence_snippet, `behavior_signals[${index}].evidence_snippet`)
  })
  if (source.avg_score !== undefined) finiteNumber(source.avg_score, 'avg_score', 0, 10)
  if (source.dimension_scores !== undefined) {
    const dimensions = record(source.dimension_scores, 'dimension_scores')
    for (const [key, value] of Object.entries(dimensions)) finiteNumber(value, `dimension_scores.${key}`, 0, 10)
  }
  if (source.topic_mastery !== undefined) {
    const mastery = record(source.topic_mastery, 'topic_mastery')
    for (const [topic, raw] of Object.entries(mastery)) {
      // The extraction prompt permits a compact top-level { notes } object
      // when no per-topic mastery details are available.
      if (topic === 'notes' && typeof raw === 'string') continue
      const item = record(raw, `topic_mastery.${topic}`)
      if (item.score !== undefined) finiteNumber(item.score, `topic_mastery.${topic}.score`, 0, 100)
      if (item.coverage !== undefined) finiteNumber(item.coverage, `topic_mastery.${topic}.coverage`, 0, 1)
      if (item.notes !== undefined) requiredText(item.notes, `topic_mastery.${topic}.notes`)
    }
  }
  return source
}

function validateConsolidation(value: unknown, active: readonly WeakPoint[]): Array<Record<string, unknown>> {
  const source = record(value)
  if (!Array.isArray(source.patterns)) throw new StructuredOutputError('expected an array', 'patterns')
  return source.patterns.map((raw, index) => {
    const item = record(raw, `patterns[${index}]`)
    const statement = requiredText(item.statement, `patterns[${index}].statement`)
    if (statement.length > 80) throw new StructuredOutputError('must be at most 80 characters', `patterns[${index}].statement`)
    if (!Array.isArray(item.supporting_wp_indices)) throw new StructuredOutputError('expected an array', `patterns[${index}].supporting_wp_indices`)
    const indexes = item.supporting_wp_indices.map((rawIndex, itemIndex) => {
      if (!Number.isInteger(rawIndex) || (rawIndex as number) < 0 || (rawIndex as number) >= active.length) throw new StructuredOutputError('invalid weak point index', `patterns[${index}].supporting_wp_indices[${itemIndex}]`)
      return rawIndex as number
    })
    if (new Set(indexes).size !== indexes.length || indexes.length < 2) throw new StructuredOutputError('must contain at least two unique weak point indexes', `patterns[${index}].supporting_wp_indices`)
    if (new Set(indexes.map((itemIndex) => active[itemIndex]?.topic).filter(Boolean)).size < 2) throw new StructuredOutputError('must span at least two topics', `patterns[${index}].supporting_wp_indices`)
    if (item.topic !== undefined) requiredText(item.topic, `patterns[${index}].topic`)
    if (item.confidence !== undefined) finiteNumber(item.confidence, `patterns[${index}].confidence`, 0, 1)
    return item
  })
}

function sessionMemory(extraction: Record<string, unknown>, session: InterviewSession, createdAt: string): PendingProfileMemory {
  const weak = (Array.isArray(extraction.weak_points) ? extraction.weak_points : []).map(object).filter(item => text(item.point))
  const strong = (Array.isArray(extraction.strong_points) ? extraction.strong_points : []).map(object).filter(item => text(item.point))
  const summary = text(extraction.session_summary)
  const insight = [summary, weak.length ? `薄弱点：${weak.map(item => text(item.point)).join('、')}` : '', strong.length ? `强项：${strong.map(item => text(item.point)).join('、')}` : ''].filter(Boolean).join('\n').slice(0, 2000)
  const entries: PendingProfileMemory['entries'] = []
  if (summary) entries.push({ chunkType: 'session_summary', content: summary, topic: session.topic || undefined, metadata: { mode: session.mode } })
  if (insight) entries.push({ chunkType: 'insight', content: insight, topic: session.topic || undefined, metadata: { mode: session.mode } })
  for (const item of weak) entries.push({ chunkType: 'weak_point', content: text(item.point), topic: text(item.topic) || session.topic || undefined, metadata: { source: text(item.source) || 'observed' } })
  return { createdAt, entries }
}

function trimExtractions(profile: CandidateProfile): void {
  const extractions = object(profile.session_extractions)
  const completed = Object.keys(extractions).filter(key => !profile._pending_memory?.[key])
  for (const stale of completed.slice(0, -100)) delete extractions[stale]
}

function normalized(value: string): string { return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '') }

function cosine(left: Float32Array | undefined, right: Float32Array | undefined): number {
  if (!left || !right || left.length !== right.length || !left.length) return -1
  let dot = 0; let leftNorm = 0; let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) { const a = left[index]!; const b = right[index]!; dot += a * b; leftNorm += a * a; rightNorm += b * b }
  return leftNorm > 1e-12 && rightNorm > 1e-12 ? dot / Math.sqrt(leftNorm * rightNorm) : -1
}

function bestTextMatch(query: string, candidates: readonly string[], vectors: Map<string, Float32Array>, threshold: number): number | undefined {
  const key = normalized(query)
  const exact = candidates.findIndex((candidate) => normalized(candidate) === key)
  if (exact >= 0) return exact
  const queryVector = vectors.get(query)
  let best: number | undefined; let score = threshold
  candidates.forEach((candidate, index) => { const similarity = cosine(queryVector, vectors.get(candidate)); if (similarity >= score) { score = similarity; best = index } })
  return best
}

function history(point: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(point.history)) point.history = []
  return point.history as Array<Record<string, unknown>>
}

function markImproved(point: WeakPoint, now: string, evidence: string): void {
  if (point.improved) return
  point.improved = true; point.improved_at = now
  history(point).push({ date: now, event: 'improved', ...(evidence ? { evidence } : {}) })
}

function markRegressed(point: WeakPoint, now: string, evidence: string): void {
  if (!point.improved) return
  point.improved = false
  history(point).push({ date: now, event: 'regressed', ...(evidence ? { evidence } : {}) })
}

function reviewWeakPoint(point: WeakPoint, score: number, now: string, evidence: string): void {
  point.sr = sm2Update(object(point.sr), score, new Date(now))
  history(point).push({ date: now, event: 'reviewed', score, ...(evidence ? { evidence } : {}) })
}

function behaviorSummary(profile: CandidateProfile): string {
  const entries = Object.entries(profile.behavior_signals)
  if (!entries.length) return '暂无'
  return entries.slice(0, 20).map(([key, value]) => `- ${key} [${value.improved ? '已改善' : value.polarity || 'negative'}] 出现 ${value.times_seen || 1} 次：${value.description || ''}`).join('\n')
}

function hydrate(value: CandidateProfile): CandidateProfile {
  const base = defaultProfile()
  return {
    ...base, ...value,
    topic_mastery: value.topic_mastery || {}, weak_points: value.weak_points || [], strong_points: value.strong_points || [], behavior_signals: value.behavior_signals || {},
    communication: { ...base.communication, ...(value.communication || {}) },
    thinking_patterns: { ...base.thinking_patterns, ...(value.thinking_patterns || {}) },
    stats: { ...base.stats, ...(value.stats || {}), score_history: value.stats?.score_history || [] },
  }
}

function prepare(profile: CandidateProfile): void {
  const base = defaultProfile()
  profile.weak_points ||= []; profile.strong_points ||= []; profile.behavior_signals ||= {}; profile.topic_mastery ||= {}
  profile.stats = { ...base.stats, ...(profile.stats || {}), score_history: profile.stats?.score_history || [] }
}

function salience(point: WeakPoint): number {
  const seen = String(point.last_seen || point.first_seen || '')
  const age = seen ? Math.max(0, (Date.now() - new Date(seen).getTime()) / 86_400_000) : 0
  return (0.5 ** (age / 30)) * (1 + Math.min(Math.log2(Number(point.times_seen || 1)), 2))
}

export function sm2Update(state: Record<string, unknown>, score: number, today = new Date()): Record<string, unknown> {
  const quality = score <= 2 ? 0 : score <= 4 ? 2 : score <= 5 ? 3 : score <= 7 ? 4 : 5
  let ease = Number(state.ease_factor || 2.5)
  let repetitions = Number(state.repetitions || 0)
  let interval: number
  if (quality >= 3) { interval = repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.trunc(Number(state.interval_days || 1) * ease); repetitions += 1 }
  else { interval = 1; repetitions = 0 }
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
  const next = new Date(today.getTime()); next.setUTCDate(next.getUTCDate() + interval)
  return { interval_days: interval, ease_factor: Math.round(ease * 100) / 100, repetitions, next_review: next.toISOString().slice(0, 10), last_score: score }
}

type ScoredObservation = { text: string; score: number; evidence: string }

function scoredObservations(session: InterviewSession): ScoredObservation[] {
  const questions = new Map(session.questions.map((question) => [String(question.id), question]))
  return session.scores.flatMap((raw) => {
    const score = number(raw.score); if (score === undefined) return []
    const question = questions.get(String(raw.question_id))
    const weak = typeof raw.weak_point === 'string' ? raw.weak_point : text(object(raw.weak_point).point)
    const point = text(weak) || text(question?.focus_area) || text(question?.question)
    if (!point) return []
    return [{ text: point, score, evidence: `${question?.question || point} (${score}/10)` }]
  })
}

function scoreForText(point: string, observations: readonly ScoredObservation[], vectors: Map<string, Float32Array>, fallback: number): number {
  const match = bestTextMatch(point, observations.map((item) => item.text), vectors, REVIEW_SIMILARITY)
  return match === undefined ? fallback : observations[match]!.score
}

function applyBehaviorOps(profile: CandidateProfile, rawOps: unknown[], sessionId: string, now: string): void {
  for (const raw of rawOps) {
    const op = object(raw); const action = text(op.action).toUpperCase()
    if (!action || action === 'NOOP') continue
    const signalId = text(op.id); const match = signalId.match(BEHAVIOR_ID)
    if (!match || !BEHAVIOR_NAMESPACES.has(match[1]!)) continue
    const current = profile.behavior_signals[signalId]
    if (action === 'ADD' && !current) {
      const snippet = text(op.snippet)
      profile.behavior_signals[signalId] = {
        namespace: match[1], polarity: op.polarity === 'positive' ? 'positive' : 'negative', description: text(op.description),
        first_seen: now, last_seen: now, times_seen: 1, improved: false,
        examples: snippet ? [{ session_id: sessionId, date: now, snippet }] : [],
      }
      continue
    }
    if ((action === 'ADD' || action === 'UPDATE') && current) {
      const snippet = text(op.snippet)
      current.times_seen = Number(current.times_seen || 0) + 1; current.last_seen = now
      if (current.improved) { current.improved = false; history(current).push({ date: now, event: 'regressed', ...(snippet ? { evidence: snippet } : {}) }) }
      if (snippet) {
        const examples = Array.isArray(current.examples) ? current.examples as Array<Record<string, unknown>> : []
        examples.push({ session_id: sessionId, date: now, snippet }); current.examples = examples.slice(-5)
      }
      continue
    }
    if (action === 'IMPROVE' && current) {
      current.improved = true; current.improved_at = now
      history(current).push({ date: now, event: 'improved', evidence: text(op.evidence_snippet) })
    }
  }
}

function sessionScore(session: InterviewSession): { score?: number; coverage: number } {
  const values = session.scores.flatMap((raw) => {
    const score = number(raw.score); if (score === undefined) return []
    const difficulty = Math.max(1, number(raw.difficulty) || 1)
    return [{ score, difficulty }]
  })
  const coverage = session.questions.length ? Math.min(1, values.length / session.questions.length) : 1
  if (!values.length) return { coverage }
  const weight = values.reduce((sum, value) => sum + value.difficulty, 0)
  return { score: Math.round(values.reduce((sum, value) => sum + value.score * value.difficulty, 0) / weight * 100) / 10, coverage }
}

function updateMastery(profile: CandidateProfile, session: InterviewSession, extraction: Record<string, unknown>, now: string): void {
  if (!session.topic) return
  const rawMastery = object(extraction.topic_mastery)
  const mastery = Object.keys(object(rawMastery[session.topic])).length ? object(rawMastery[session.topic]) : rawMastery
  const actual = sessionScore(session)
  const score = number(mastery.score) ?? actual.score
  const current = profile.topic_mastery[session.topic] ||= {}
  if (score !== undefined) {
    const count = Math.max(0, Number(current.session_count || 0))
    const previous = number(current.score) ?? Number(current.level || 0) * 20
    const coverage = Math.min(1, Math.max(0.1, number(mastery.coverage) ?? actual.coverage))
    const weight = Math.max(0.15, 1 / (count + 1)) * coverage
    current.score = Math.round((previous * (1 - weight) + score * weight) * 10) / 10
    current.session_count = count + 1
    delete current.level
  }
  if (text(mastery.notes)) current.notes = text(mastery.notes)
  current.last_assessed = now
}

function roundedAverage(values: number[]): number | undefined {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : undefined
}

function updateStats(profile: CandidateProfile, session: InterviewSession, extraction: Record<string, unknown>, now: string): void {
  const stats = profile.stats
  stats.total_sessions = Number(stats.total_sessions || 0) + 1
  const countKey = ({ resume: 'resume_sessions', topic_drill: 'drill_sessions', jd_prep: 'job_prep_sessions', recording: 'recording_sessions' } as const)[session.mode]
  stats[countKey] = Number(stats[countKey] || 0) + 1
  const scoredAnswers = session.scores.filter((raw) => number(raw.score) !== undefined).length
  const answerCount = scoredAnswers || session.transcript.filter((message) => message.role === 'user' && message.content.trim()).length
  stats.total_answers = Number(stats.total_answers || 0) + answerCount

  const overall = object(session.overall)
  const numericScores = session.scores.map((raw) => number(raw.score)).filter((value): value is number => value !== undefined)
  const avg = number(overall.avg_score) ?? number(extraction.avg_score) ?? roundedAverage(numericScores)
  if (avg === undefined) return
  const storedDimensions = object(overall.dimension_scores)
  const dimensions = Object.fromEntries(Object.entries(Object.keys(storedDimensions).length ? storedDimensions : object(extraction.dimension_scores)).filter(([, value]) => number(value) !== undefined))
  const entry = { date: now.slice(0, 10), mode: session.mode, topic: session.topic, avg_score: avg, session_id: session.session_id, ...(Object.keys(dimensions).length ? { dimension_scores: dimensions } : {}) }
  stats.score_history.push(entry)

  const windows: Record<string, [string, number]> = { topic_drill: ['drill_avg_score', 20], resume: ['resume_avg_score', 10], jd_prep: ['job_prep_avg_score', 10], recording: ['recording_avg_score', 20] }
  for (const [mode, [key, window]] of Object.entries(windows)) {
    const value = roundedAverage(stats.score_history.filter((item) => item.mode === mode).map((item) => number(item.avg_score)).filter((item): item is number => item !== undefined).slice(-window))
    if (value !== undefined) stats[key] = value
  }
  stats.avg_score = roundedAverage(stats.score_history.map((item) => number(item.avg_score)).filter((item): item is number => item !== undefined).slice(-30)) || 0
  const recentDimensions = stats.score_history.filter((item) => Object.keys(object(item.dimension_scores)).length).slice(-5)
  if (recentDimensions.length) {
    const keys = new Set(recentDimensions.flatMap((item) => Object.keys(object(item.dimension_scores))))
    stats.dimension_scores = Object.fromEntries([...keys].flatMap((key) => {
      const value = roundedAverage(recentDimensions.map((item) => number(object(item.dimension_scores)[key])).filter((item): item is number => item !== undefined))
      return value === undefined ? [] : [[key, value]]
    }))
  }
}

export class ProfileService implements ProfileUseCases, CandidateProfilePort {
  constructor(private readonly deps: ProfileDependencies) {}

  private async profile(userId: string): Promise<CandidateProfile> { return hydrate(await this.deps.repository.load(userId)) }

  private context(userId: string, operation: string): RequestContext {
    return { requestId: `profile:${operation}:${userId}`, userId, signal: new AbortController().signal }
  }

  private async vectorsFor(userId: string, values: readonly string[], operation: string): Promise<Map<string, Float32Array>> {
    const texts = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    if (!texts.length) return new Map()
    try {
      const vectors = await this.deps.embeddings.embed(this.context(userId, operation), texts)
      return new Map(texts.flatMap((value, index) => vectors[index] ? [[value, vectors[index]!]] : []))
    } catch { return new Map() }
  }

  async semanticHistory(userId: string, topic: string, query = `${topic} 面试薄弱点 常见错误`, topK = 3): Promise<ProfileMemorySearchResult[]> {
    try {
      const rows = await this.deps.vectors.listProfileMemories({ userId, chunkTypes: ['session_summary', 'insight'] })
      if (!rows.length) return []
      const queryVector = (await this.deps.embeddings.embed(this.context(userId, 'memory-search'), [query]))[0]
      if (!queryVector) return []
      const now = Date.now()
      const ranked = rows.map((row) => {
        const timestamp = Date.parse(row.createdAt)
        const age = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 86_400_000) : 0
        const decay = MEMORY_DECAY_WEIGHT * (0.5 ** (age / MEMORY_HALF_LIFE_DAYS)) + (1 - MEMORY_DECAY_WEIGHT)
        return { chunkType: row.chunkType, content: row.content, ...(row.topic ? { topic: row.topic } : {}), ...(row.sessionId ? { sessionId: row.sessionId } : {}), createdAt: row.createdAt, score: cosine(queryVector, row.embedding) * decay }
      }).filter((row) => Number.isFinite(row.score) && row.score > 0 && row.content.trim()).sort((left, right) => right.score - left.score).slice(0, MEMORY_CANDIDATE_COUNT)
      const sessions = new Map<string, ProfileMemorySearchResult>()
      const candidates: ProfileMemorySearchResult[] = []
      for (const row of ranked) {
        const existing = row.sessionId ? sessions.get(row.sessionId) : undefined
        if (existing) {
          // An insight already contains its session summary. Keep that richer
          // representation at the session's best decayed relevance score.
          if (row.chunkType === 'insight' && existing.chunkType !== 'insight') {
            Object.assign(existing, row, { score: existing.score })
          }
        } else {
          const candidate = { ...row }
          candidates.push(candidate)
          if (row.sessionId) sessions.set(row.sessionId, candidate)
        }
      }
      const seen = new Set<string>()
      return candidates.filter((row) => {
        const content = row.content.trim()
        if (seen.has(content)) return false
        seen.add(content)
        return true
      }).slice(0, Math.max(1, topK))
    } catch { return [] }
  }

  private async appendMemories(userId: string, entries: Array<Omit<ProfileMemoryEntry, 'embedding' | 'createdAt'>>, now: string): Promise<void> {
    const vectors = await this.vectorsFor(userId, entries.map((entry) => entry.content), 'memory-write')
    const stored = entries.flatMap((entry) => {
      const embedding = vectors.get(entry.content)
      return embedding ? [{ ...entry, embedding, createdAt: now }] : []
    })
    if (!stored.length) return
    try { await this.deps.vectors.appendProfileMemories({ userId, entries: stored }) } catch { /* profile.json remains the source of truth */ }
  }

  private async projectSessionMemory(userId: string, sessionId: string, pending: PendingProfileMemory | undefined): Promise<void> {
    if (!pending) return
    // Unlike optional semantic matching, this write must succeed as a whole or remain retryable.
    const vectors = pending.entries.length ? await this.deps.embeddings.embed(this.context(userId, 'memory-write'), pending.entries.map(entry => entry.content)) : []
    const dimension = vectors[0]?.length || 0
    if (vectors.length !== pending.entries.length || vectors.some(vector => !dimension || vector.length !== dimension || !vector.every(Number.isFinite))) {
      throw new Error('Invalid memory embeddings')
    }
    await this.deps.vectors.replaceSessionMemories({
      userId, sessionId,
      entries: pending.entries.map((entry, index) => ({ ...entry, sessionId, embedding: vectors[index]!, createdAt: pending.createdAt })),
    })
    // A crash before this acknowledgement is safe: the next attempt replaces the same session.
    await this.deps.repository.update(userId, profile => {
      delete profile._pending_memory?.[sessionId]
      if (!Object.keys(profile._pending_memory || {}).length) delete profile._pending_memory
      // Keep a just-recovered session in the recent completed cache, even if it failed long ago.
      const extractions = object(profile.session_extractions)
      if (Object.hasOwn(extractions, sessionId)) {
        const extraction = extractions[sessionId]
        delete extractions[sessionId]
        extractions[sessionId] = extraction
      }
      trimExtractions(profile)
    })
  }

  async get(context: RequestContext): Promise<CandidateProfile> {
    const userId = id(context)
    const profile = await this.profile(userId)
    const { _pending_memory: _, ...publicProfile } = profile
    return { ...publicProfile, due_reviews: (await this.dueReviews(context)).map((point) => ({ point: point.point, topic: point.topic, next_review: object(point.sr).next_review })) }
  }

  async targetRole(userId: string): Promise<string> { return (await this.profile(userId)).target_role || '' }
  async updateTargetRole(userId: string, role: string): Promise<void> {
    const value = role.trim(); if (!value) return
    await this.deps.repository.update(userId, (profile) => { profile.target_role = value })
  }

  async addPredictedWeakPoints(input: { userId: string; topic: string; points: string[] }): Promise<void> {
    const now = new Date().toISOString()
    await this.deps.repository.update(input.userId, (profile) => {
      for (const raw of input.points) {
        const point = raw.trim(); if (!point) continue
        const existing = profile.weak_points.find((item) => item.point === point && item.topic === input.topic && !item.archived)
        if (existing) { existing.last_seen = now; existing.times_seen = Number(existing.times_seen || 1) + 1 }
        else profile.weak_points.push({ point, topic: input.topic, source: 'predicted', first_seen: now, last_seen: now, times_seen: 1, improved: false })
      }
    })
  }

  async summary(userId: string, topic?: string, memoryQuery?: string): Promise<string> {
    const profile = await this.profile(userId)
    const parts: string[] = []
    const weak = profile.weak_points.filter((point) => point.source !== 'consolidated' && !point.improved && !point.archived && point.axis !== 'performance' && (!topic || point.topic === topic)).sort((a, b) => salience(b) - salience(a)).slice(0, topic ? 10 : 6)
    if (weak.length) parts.push(`已知知识薄弱点：${weak.map((point) => point.point).join('、')}`)
    const consolidated = profile.weak_points.filter((point) => point.source === 'consolidated' && !point.improved && !point.archived).sort((a, b) => Number(b.confidence || 0.7) - Number(a.confidence || 0.7)).slice(0, 3)
    if (consolidated.length) parts.push(`跨会话规律：\n${consolidated.map((point) => `- ${point.point}`).join('\n')}`)
    const strong = [...profile.strong_points].sort((a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || ''))).slice(0, 5)
    if (strong.length) parts.push(`知识强项：${strong.map((point) => point.point).join('、')}`)
    const behaviors = Object.entries(profile.behavior_signals).filter(([, value]) => !value.improved && (value.polarity || 'negative') === 'negative').sort(([, left], [, right]) => salience(right as WeakPoint) - salience(left as WeakPoint)).slice(0, 6)
    if (behaviors.length) parts.push(`行为模式短板：\n${behaviors.map(([key, value]) => `- ${key}: ${value.description || ''}`).join('\n')}`)
    if (profile.stats.total_sessions) parts.push(`已完成 ${profile.stats.total_sessions} 次模拟面试`)
    if (topic) {
      const mastery = profile.topic_mastery[topic]
      if (mastery) parts.push(`${topic} 掌握度：${mastery.score ?? Number(mastery.level || 0) * 20}/100 — ${mastery.notes || ''}`)
      const today = new Date().toISOString().slice(0, 10)
      const due = profile.weak_points.filter((point) => point.topic === topic && point.source !== 'consolidated' && !point.improved && !point.archived && point.axis !== 'performance' && String(object(point.sr).next_review || '2000-01-01') <= today).sort((left, right) => Number(object(left.sr).ease_factor || 2.5) - Number(object(right.sr).ease_factor || 2.5)).slice(0, 5)
      if (due.length) parts.push(`本轮到期复习：${due.map((point) => point.point).join('、')}`)
      const query = [
        `检索有助于本轮专项训练的历史表现。训练主题：${topic}`,
        memoryQuery?.trim().slice(0, 1500),
        due.length ? `优先复习：${due.map((point) => point.point).join('、').slice(0, 400)}` : '',
        weak.length ? `当前薄弱点：${weak.map((point) => point.point).join('、').slice(0, 400)}` : '',
      ].filter(Boolean).join('\n')
      const insights = await this.semanticHistory(userId, topic, query)
      if (insights.length) {
        const history = insights.map((item) => `- [${item.topic || '未分类'} · ${item.createdAt.slice(0, 10)}] ${item.content.slice(0, MEMORY_ITEM_CHARS)}`).join('\n').slice(0, MEMORY_CONTEXT_CHARS)
        parts.push(`历史语义洞察（历史表现，以当前画像的改善和纠正状态为准）：\n${history}`)
      }
    }
    return parts.join('\n') || '新用户，暂无历史数据'
  }

  async inferTargetRole(context: RequestContext) {
    const resume = await this.deps.resume.text(context)
    if (!resume) throw new AppError('请先上传简历', 400)
    const role = (await this.deps.ai.complete(context, [{ role: 'system', content: '你是岗位推断引擎。只返回岗位名称，不要其他内容。' }, { role: 'user', content: fill(INFER_ROLE_PROMPT, { resume }) }])).trim().replace(/^["「]|["」]$/g, '').trim()
    if (!role) throw new AppError('推断失败，请手动填写', 500)
    return { target_role: role }
  }

  async viewed(context: RequestContext): Promise<ProfileViewMarker> {
    return this.deps.repository.update(id(context), (profile) => {
      const marker = { at: new Date().toISOString(), total_sessions: Number(profile.stats?.total_sessions || 0), topic_scores: Object.fromEntries(Object.entries(profile.topic_mastery || {}).map(([topic, mastery]) => [topic, Number(mastery.score ?? Number(mastery.level || 0) * 20)])) }
      profile.view_marker = marker
      return marker
    })
  }

  async feedback(context: RequestContext, point: string, verdict: string): Promise<WeakPoint> {
    if (!point.trim() || !['accurate', 'inaccurate', 'acknowledged'].includes(verdict)) throw new AppError('需要 point 和 verdict (accurate|inaccurate|acknowledged)', 400)
    const updated = await this.deps.repository.update(id(context), (profile) => {
      const target = profile.weak_points.find((item) => item.source === 'consolidated' && item.point === point && !item.archived)
      if (!target) return undefined
      const now = new Date().toISOString(); target.user_acknowledged = true
      const confidence = Number(target.confidence || 0.7)
      const history = Array.isArray(target.history) ? target.history : []
      target.history = history
      if (verdict === 'accurate') { target.confidence = Math.round(Math.min(1, confidence + 0.1) * 100) / 100; history.push({ date: now, event: 'user_confirmed' }) }
      if (verdict === 'inaccurate') { target.confidence = Math.round(Math.max(0, confidence - 0.3) * 100) / 100; history.push({ date: now, event: 'user_refuted' }); if (target.confidence < 0.5) Object.assign(target, { archived: true, archived_at: now, archived_reason: 'user_refuted' }) }
      return { ...target }
    })
    if (!updated) throw new AppError('未找到该规律', 404)
    return updated
  }

  async dueReviews(context: RequestContext, topic?: string): Promise<WeakPoint[]> {
    const today = new Date().toISOString().slice(0, 10)
    return (await this.profile(id(context))).weak_points.filter((point) => !point.improved && !point.archived && point.source !== 'consolidated' && point.axis !== 'performance' && (!topic || point.topic === topic) && String(object(point.sr).next_review || '2000-01-01') <= today).sort((a, b) => Number(object(a.sr).ease_factor || 2.5) - Number(object(b.sr).ease_factor || 2.5))
  }

  async topicHistory(context: RequestContext, topic: string) { return this.deps.sessions.reviewedByTopic(id(context), topic) }

  async retrospective(context: RequestContext, topic: string) {
    const userId = id(context)
    if (!(await this.deps.sessions.reviewedByTopic(userId, topic)).length) throw new AppError('该领域暂无训练记录', 400)
    const taskId = `retro_${topic}_${userId.slice(0, 8)}`
    const existing = await this.deps.tasks.get(taskId, userId)
    if (!existing || !['pending', 'running'].includes(existing.status)) await this.deps.tasks.enqueue({ taskId, userId, type: 'retrospective', payload: { topic } })
    return { task_id: taskId, status: 'pending' as const }
  }

  async runRetrospectiveTask(task: TaskRecord): Promise<RetrospectiveResult> {
    const topic = String(task.payload.topic || '')
    const sessions = await this.deps.sessions.reviewedByTopic(task.user_id, topic)
    if (!sessions.length) throw new Error('该领域暂无训练记录')
    const profile = await this.profile(task.user_id)
    const topics = await this.deps.knowledgeStore.loadTopics(task.user_id)
    const topicName = topics[topic]?.name || topic
    const history = sessions.map((session) => `### ${session.created_at.slice(0, 10)}\n${session.review || ''}\n评分：${JSON.stringify(session.scores)}`).join('\n\n')
    const mastery = profile.topic_mastery[topic] || {}
    const context: RequestContext = { requestId: `task:${task.task_id}`, userId: task.user_id, signal: new AbortController().signal }
    const retrospective = (await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试教练。用 Markdown 生成回顾报告。' }, { role: 'user', content: fill(RETROSPECTIVE_PROMPT, { topic_name: topicName, mastery: `${mastery.score ?? Number(mastery.level || 0) * 20}/100 — ${mastery.notes || ''}`, history }) }])).trim()
    const at = new Date().toISOString()
    await this.deps.repository.update(task.user_id, (value) => { (value.topic_mastery[topic] ||= {}).retrospective = retrospective; value.topic_mastery[topic]!.retrospective_at = at })
    return { topic, topic_name: topicName, retrospective, retrospective_at: at, session_count: sessions.length }
  }

  private async consolidate(userId: string, now: string): Promise<void> {
    const profile = await this.profile(userId)
    const active = profile.weak_points.filter((point) => (point.source || 'observed') === 'observed' && point.axis !== 'performance' && !point.improved && !point.archived)
    if (active.length < CONSOLIDATION_MIN_ACTIVE || new Set(active.map((point) => point.topic).filter(Boolean)).size < 2) return
    const last = Date.parse(profile.last_consolidation_at || '')
    if (Number.isFinite(last) && Date.now() - last < CONSOLIDATION_COOLDOWN_MS) return
    const formatted = active.map((point, index) => `[${index}] ${point.point} (领域: ${point.topic || '未知'}, 观察 ${point.times_seen || 1} 次)`).join('\n')
    let patterns: Array<Record<string, unknown>>
    try {
      const parsed = parseJsonResponse(await this.deps.ai.complete(this.context(userId, 'consolidation'), [
        { role: 'system', content: '你是模式识别引擎。只返回 JSON。' },
        { role: 'user', content: fill(CONSOLIDATION_PROMPT, { weak_points: formatted }) },
      ], STRUCTURED_CHAT_OPTIONS))
      patterns = validateConsolidation(parsed, active)
    } catch { return }

    const created = await this.deps.repository.update(userId, (current) => {
      prepare(current)
      const inside = current.weak_points.filter((point) => (point.source || 'observed') === 'observed' && point.axis !== 'performance' && !point.improved && !point.archived)
      const output: WeakPoint[] = []
      for (const raw of patterns) {
        const pattern = object(raw); const statement = text(pattern.statement)
        const indexes = Array.isArray(pattern.supporting_wp_indices) ? [...new Set(pattern.supporting_wp_indices.filter((value): value is number => Number.isInteger(value) && value >= 0))] : []
        if (!statement || statement.length > 80 || indexes.length < 2 || indexes.some((index) => index >= inside.length)) continue
        if (indexes.some((index) => inside[index]?.point !== active[index]?.point)) continue
        const supporting = indexes.map((index) => inside[index]!)
        if (new Set(supporting.map((point) => point.topic).filter(Boolean)).size < 2) continue
        if (current.weak_points.some((point) => point.source === 'consolidated' && point.point === statement && !point.archived)) continue
        const confidence = Math.min(1, Math.max(0, number(pattern.confidence) ?? 0.7))
        const consolidated: WeakPoint = {
          point: statement, topic: text(pattern.topic) || 'cross_cutting', source: 'consolidated', first_seen: now, last_seen: now,
          times_seen: supporting.reduce((sum, point) => sum + Number(point.times_seen || 1), 0), improved: false, archived: false,
          consolidates: supporting.map((point) => point.point), confidence, user_acknowledged: false,
        }
        current.weak_points.push(consolidated); output.push(consolidated)
        for (const point of supporting) {
          point.archived = true; point.archived_at = now; point.archived_reason = 'superseded_by_consolidation'
          history(point).push({ date: now, event: 'archived', reason: `superseded by consolidation: ${statement}` })
        }
      }
      current.last_consolidation_at = now
      return output
    })
    if (created.length) await this.appendMemories(userId, created.map((point) => ({ chunkType: 'weak_point', content: point.point, topic: point.topic, metadata: { source: 'consolidated' } })), now)
  }

  async afterReview(input: { userId: string; session: InterviewSession }): Promise<Record<string, unknown>> {
    const before = await this.profile(input.userId)
    const cached = object(object(before.session_extractions)[input.session.session_id])
    if (Object.hasOwn(object(before.session_extractions), input.session.session_id)) {
      await this.projectSessionMemory(input.userId, input.session.session_id, before._pending_memory?.[input.session.session_id])
      return cached
    }
    const transcript = input.session.transcript.map((message) => `${message.role === 'user' ? '候选人' : '面试官'}: ${message.content}`).join('\n')
    const context = this.context(input.userId, input.session.session_id)
    let extraction: Record<string, unknown> | undefined
    for (let attempt = 0; attempt < 2 && !extraction; attempt += 1) {
      try {
        const parsed = parseJsonResponse(await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试分析引擎。只返回 JSON。' }, { role: 'user', content: fill(EXTRACT_PROMPT, { mode: input.session.mode, topic: input.session.topic || '综合', transcript, scores: JSON.stringify(input.session.scores), existing_behavior_signals: behaviorSummary(before), review: input.session.review || '' }) }], STRUCTURED_CHAT_OPTIONS))
        extraction = validateProfileExtraction(parsed)
      }
      catch { /* retry once */ }
    }
    if (!extraction) throw new Error('画像提取失败')
    const now = new Date().toISOString()
    const weak = (Array.isArray(extraction.weak_points) ? extraction.weak_points : []).map(object).filter((item) => text(item.point))
    const strong = (Array.isArray(extraction.strong_points) ? extraction.strong_points : []).map(object).filter((item) => text(item.point))
    const observations = scoredObservations(input.session)
    const embeddingTexts = [
      ...before.weak_points.map((point) => point.point), ...before.strong_points.map((point) => point.point),
      ...weak.map((item) => text(item.point)), ...strong.map((item) => text(item.point)), ...observations.map((item) => item.text),
    ]
    const vectors = await this.vectorsFor(input.userId, embeddingTexts, 'profile-update')
    const overallScore = number(object(input.session.overall).avg_score) ?? number(extraction.avg_score) ?? roundedAverage(input.session.scores.map((score) => number(score.score)).filter((score): score is number => score !== undefined)) ?? 5

    const applied = await this.deps.repository.update(input.userId, (profile) => {
      // The initial load happens before LLM/embedding I/O; recheck under the repository lock.
      const existing = object(object(profile.session_extractions)[input.session.session_id])
      if (Object.hasOwn(object(profile.session_extractions), input.session.session_id)) return { extraction: existing, pending: profile._pending_memory?.[input.session.session_id], fresh: false }
      prepare(profile)
      const reviewed = new Set<WeakPoint>()
      for (const item of weak) {
        const point = text(item.point); const topic = text(item.topic) || input.session.topic || ''
        const candidates = profile.weak_points.filter((value) => value.source !== 'consolidated' && value.axis !== 'performance')
        const match = bestTextMatch(point, candidates.map((value) => value.point), vectors, WEAK_POINT_SIMILARITY)
        const score = number(item.score) ?? scoreForText(point, observations, vectors, overallScore)
        if (match !== undefined) {
          const existing = candidates[match]!
          if (existing.archived) { existing.archived = false; delete existing.archived_at; delete existing.archived_reason; history(existing).push({ date: now, event: 'unarchived' }) }
          markRegressed(existing, now, point)
          existing.last_seen = now; existing.times_seen = Number(existing.times_seen || 1) + 1
          reviewWeakPoint(existing, score, now, point); reviewed.add(existing)
        } else {
          const created: WeakPoint = { ...item, point, topic, source: text(item.source) || 'observed', first_seen: now, last_seen: now, times_seen: 1, improved: false, sr: sm2Update({}, score, new Date(now)), history: [{ date: now, event: 'reviewed', score, evidence: point }] }
          profile.weak_points.push(created); reviewed.add(created)
        }
      }

      for (const observation of observations) {
        const candidates = profile.weak_points.filter((point) => point.source !== 'consolidated' && point.axis !== 'performance' && (!input.session.topic || point.topic === input.session.topic))
        const match = bestTextMatch(observation.text, candidates.map((point) => point.point), vectors, REVIEW_SIMILARITY)
        if (match === undefined) continue
        const point = candidates[match]!
        if (!reviewed.has(point)) {
          if (observation.score < 5) { markRegressed(point, now, observation.evidence); point.last_seen = now; point.times_seen = Number(point.times_seen || 1) + 1 }
          reviewWeakPoint(point, observation.score, now, observation.evidence); reviewed.add(point)
        }
        if (observation.score >= 8) markImproved(point, now, observation.evidence)
        else if (observation.score < 5) markRegressed(point, now, observation.evidence)
      }

      for (const item of strong) {
        const point = text(item.point); const topic = text(item.topic) || input.session.topic || ''
        const candidates = profile.weak_points.filter((value) => value.source !== 'consolidated' && !value.archived && (!topic || value.topic === topic))
        const weakMatch = bestTextMatch(point, candidates.map((value) => value.point), vectors, REVIEW_SIMILARITY)
        if (weakMatch !== undefined) markImproved(candidates[weakMatch]!, now, point)
        const strongMatch = bestTextMatch(point, profile.strong_points.map((value) => value.point), vectors, 0.8)
        if (strongMatch === undefined) profile.strong_points.push({ ...item, point, topic, first_seen: now })
      }

      applyBehaviorOps(profile, Array.isArray(extraction!.behavior_signals) ? extraction!.behavior_signals : [], input.session.session_id, now)
      updateMastery(profile, input.session, extraction!, now)
      updateStats(profile, input.session, extraction!, now)
      const extractions = object(profile.session_extractions)
      extractions[input.session.session_id] = extraction!
      profile.session_extractions = extractions
      const pending = sessionMemory(extraction!, input.session, now)
      profile._pending_memory ||= {}
      profile._pending_memory[input.session.session_id] = pending
      trimExtractions(profile)
      profile.updated_at = now
      return { extraction: extraction!, pending, fresh: true }
    })

    await this.projectSessionMemory(input.userId, input.session.session_id, applied.pending)
    if (applied.fresh) await this.consolidate(input.userId, now)
    return applied.extraction
  }
}
