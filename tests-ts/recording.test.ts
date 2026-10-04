import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  LongTranscriptionService,
  RecordingService,
  type CandidateProfilePort,
  type ChatMessage,
  type PersistentTaskDispatcher,
  type ProviderSettingsRepository,
  type RequestContext,
  type TaskRecord,
  type TextGenerationUseCases,
} from '@techspar/core'
import { BunInterviewSessionRepository } from '@techspar/db'

const directories: string[] = []
async function databasePath(): Promise<string> { const directory = await mkdtemp(join(tmpdir(), 'techspar-recording-')); directories.push(directory); return join(directory, 'techspar.db') }
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })

const context: RequestContext = { requestId: 'recording-test', userId: 'user-a', signal: new AbortController().signal }

class Replies implements TextGenerationUseCases {
  calls: ChatMessage[][] = []
  constructor(private readonly replies: string[]) {}
  async complete(_context: RequestContext, messages: readonly ChatMessage[]): Promise<string> { this.calls.push([...messages]); const reply = this.replies.shift(); if (reply === undefined) throw new Error('Unexpected LLM call'); return reply }
  async *stream(): AsyncIterable<string> { yield '' }
}

function task(taskId: string): TaskRecord { return { task_id: taskId, user_id: 'user-a', type: 'recording_review', status: 'running', payload: { session_id: taskId }, result: null, error: null, attempts: 1, created_at: '', updated_at: '' } }

describe('long recording transcription', () => {
  test('loads per-user credentials and keeps the legacy response payload input', async () => {
    let received = ''
    const settings: ProviderSettingsRepository = {
      async loadProvider() { return { services: { dashscope_api_key: 'ds', tavily_api_key: '', oss_access_key_id: 'ak', oss_access_key_secret: 'secret', oss_bucket: 'bucket', oss_endpoint: 'oss.example.test' } } }, async saveProvider() {},
      async loadTraining() { return { num_questions: 10, divergence: 3 } }, async saveTraining() {}, async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {},
    }
    const service = new LongTranscriptionService(settings, { async transcribe(input) { received = `${input.services.oss_bucket}:${input.suffix}:${input.bytes.length}`; return '转写结果' } })
    expect(await service.transcribe(context, new Uint8Array([1, 2, 3]), '.webm')).toBe('转写结果')
    expect(received).toBe('bucket:.webm:3')
  })
})

describe('recording review', () => {
  const pair = { id: 1, question: '解释事件循环', answer: '任务队列', focus_area: '运行时' }
  const failures: Array<{ name: string; mode: 'dual' | 'solo'; replies: unknown[]; preservesQa?: boolean }> = [
    { name: 'duplicate question IDs', mode: 'dual', replies: [{ qa_pairs: [pair, { ...pair, id: '1' }] }] },
    { name: 'empty question ID', mode: 'dual', replies: [{ qa_pairs: [{ ...pair, id: '' }] }] },
    { name: 'invalid answer', mode: 'dual', replies: [{ qa_pairs: [{ ...pair, answer: {} }] }] },
    { name: 'unknown score ID', mode: 'dual', replies: [{ qa_pairs: [pair] }, { scores: [{ question_id: 2, score: 8 }], overall: { avg_score: 8 } }], preservesQa: true },
    { name: 'duplicate score IDs', mode: 'dual', replies: [{ qa_pairs: [pair] }, { scores: [{ question_id: 1, score: 8 }, { question_id: '1', score: 8 }], overall: { avg_score: 8 } }], preservesQa: true },
    { name: 'out of range score', mode: 'dual', replies: [{ qa_pairs: [pair] }, { scores: [{ question_id: 1, score: 11 }], overall: { avg_score: 8 } }], preservesQa: true },
    { name: 'invalid topics container', mode: 'solo', replies: [{ topics_covered: {}, overall: { avg_score: 8 } }] },
    { name: 'out of range topic score', mode: 'solo', replies: [{ topics_covered: [{ id: 1, topic: '运行时', score: -1 }], overall: { avg_score: 8 } }] },
    { name: 'duplicate topic IDs', mode: 'solo', replies: [{ topics_covered: [{ id: 1, topic: '运行时', score: 8 }, { id: '1', topic: '缓存', score: 8 }], overall: { avg_score: 8 } }] },
    { name: 'invalid nested overall', mode: 'solo', replies: [{ topics_covered: [], overall: { avg_score: 8, thinking_patterns: { new_gaps: [{}] } } }] },
  ]
  for (const failure of failures) test(`fails ${failure.name} without saving a review or updating the profile`, async () => {
    const sessions = new BunInterviewSessionRepository(await databasePath()); sessions.initialize()
    let profileWrites = 0
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return task(input.taskId) }, async get() { return undefined } }
    const profile: CandidateProfilePort = { async summary() { return '' }, async targetRole() { return '' }, async updateTargetRole() {}, async afterReview() { profileWrites++; return {} } }
    const ai = new Replies(failure.replies.map(value => JSON.stringify(value)))
    const service = new RecordingService({ sessions, tasks, ids: { next: () => 'bad' }, ai, profile, transcription: { async transcribe() { return '' } } })
    try {
      await service.analyze(context, { transcript: '面试官：解释事件循环。候选人：任务队列。', recording_mode: failure.mode })
      await expect(service.runAnalysisTask(task('bad'))).rejects.toThrow()
      const stored = await sessions.get('bad', 'user-a')
      expect(stored).toMatchObject({ status: 'review_failed', scores: [], overall: {} })
      expect(stored?.review).toBeNull()
      expect(stored?.review_error).toBeString()
      expect(stored?.questions).toHaveLength(failure.preservesQa ? 1 : 0)
      if (failure.preservesQa) expect(stored?.transcript).toContainEqual(expect.objectContaining({ role: 'user', content: pair.answer }))
      expect(profileWrites).toBe(0)
    } finally { sessions.close() }
  })

  test('fails truncated JSON without changing a recording task into a completed review', async () => {
    const sessions = new BunInterviewSessionRepository(await databasePath()); sessions.initialize()
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return task(input.taskId) }, async get() { return undefined } }
    const profile: CandidateProfilePort = { async summary() { return '' }, async targetRole() { return '' }, async updateTargetRole() {}, async afterReview() { throw new Error('must not update profile') } }
    const service = new RecordingService({ sessions, tasks, ids: { next: () => 'truncated' }, ai: new Replies(['{"qa_pairs":']), profile, transcription: { async transcribe() { return '' } } })
    try {
      await service.analyze(context, { transcript: '合成面试对话', recording_mode: 'dual' })
      await expect(service.runAnalysisTask(task('truncated'))).rejects.toThrow()
      expect(await sessions.get('truncated', 'user-a')).toMatchObject({ status: 'review_failed', questions: [], scores: [], overall: {} })
    } finally { sessions.close() }
  })

  test('creates a durable dual-mode task and writes a compatible review', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const queued: TaskRecord[] = []
    const tasks: PersistentTaskDispatcher = {
      async enqueue(input) { const value = task(input.taskId); queued.push(value); return value },
      async get() { return undefined },
    }
    let profileWrites = 0
    const profile: CandidateProfilePort = {
      async summary() { return '历史画像' }, async targetRole() { return '' }, async updateTargetRole() {},
      async afterReview({ session }) { profileWrites += 1; expect(session.status).toBe('reviewed'); return {} },
    }
    const ai = new Replies([
      JSON.stringify({ qa_pairs: [{ id: 1, question: '解释事件循环', answer: '任务队列与调用栈协作', focus_area: '运行时' }] }),
      JSON.stringify({ scores: [{ question_id: 1, score: 8, assessment: '核心正确', improvement: '补充微任务', key_missing: ['微任务'] }], overall: { avg_score: 8, summary: '整体清晰', new_weak_points: [{ point: '微任务细节', topic: 'js' }], new_strong_points: [] } }),
    ])
    const service = new RecordingService({ sessions, tasks, ids: { next: () => 'recording-1' }, ai, profile, transcription: { async transcribe() { return '' } } })
    expect(await service.analyze(context, { transcript: '面试官：解释事件循环。候选人：任务队列。', recording_mode: 'dual', company: '示例公司' })).toEqual({ session_id: 'recording-1', status: 'pending' })
    expect(queued).toHaveLength(1)
    expect(await sessions.get('recording-1', 'user-a')).toMatchObject({ mode: 'recording', status: 'reviewing', meta: { recording_mode: 'dual', company: '示例公司' } })
    await service.runAnalysisTask(task('recording-1'))
    const reviewed = await sessions.get('recording-1', 'user-a')
    expect(reviewed).toMatchObject({ status: 'reviewed', scores: [{ question_id: 1, score: 8, difficulty: 3 }] })
    expect(reviewed?.review).toContain('任务队列与调用栈协作')
    expect(reviewed?.meta.source_transcript).toBeString()
    expect(profileWrites).toBe(1)
    sessions.close()
  })

  test('supports solo mode without inventing question rows', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const tasks: PersistentTaskDispatcher = { async enqueue(input) { return task(input.taskId) }, async get() { return undefined } }
    const profile: CandidateProfilePort = { async summary() { return '' }, async targetRole() { return '' }, async updateTargetRole() {} }
    const ai = new Replies([JSON.stringify({ topics_covered: [{ id: 1, topic: 'RAG', score: 6, assessment: '方向正确' }], overall: { avg_score: 6, summary: '需要补充评估指标', new_weak_points: [] } })])
    const service = new RecordingService({ sessions, tasks, ids: { next: () => 'recording-2' }, ai, profile, transcription: { async transcribe() { return '' } } })
    await service.analyze(context, { transcript: '我介绍一下 RAG。', recording_mode: 'solo' })
    await service.runAnalysisTask(task('recording-2'))
    expect(await sessions.get('recording-2', 'user-a')).toMatchObject({ status: 'reviewed', questions: [], overall: { avg_score: 6, topics_covered: [{ topic: 'RAG' }] } })
    sessions.close()
  })
})
