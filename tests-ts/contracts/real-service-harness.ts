import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import {
  defaultProfile, InterviewService, ProfileService,
  type CandidateProfile, type CandidateProfileRepository, type InterviewDependencies, type InterviewSession,
  type ProfileDependencies, type TaskRecord, type TextGenerationUseCases,
} from '@techspar/core'
import { BunInterviewSessionRepository, BunResumeInterviewStateRepository, BunTaskRepository } from '@techspar/db'
import { boundaryApp, jsonHeaders, unavailable } from './test-app.ts'

export function dependencyStub<T extends object>(methods: Partial<T>): T {
  return new Proxy(methods, {
    get(target, key, receiver) {
      return Reflect.has(target, key) ? Reflect.get(target, key, receiver) : Reflect.get(unavailable, key)
    },
  }) as T
}

export class MemoryProfileRepository implements CandidateProfileRepository {
  private readonly values = new Map<string, CandidateProfile>()
  async load(userId: string) { return structuredClone(this.values.get(userId) ?? defaultProfile()) }
  async save(userId: string, value: CandidateProfile) { this.values.set(userId, structuredClone(value)) }
  async update<T>(userId: string, mutate: (value: CandidateProfile) => T | Promise<T>): Promise<T> {
    const value = await this.load(userId)
    const result = await mutate(value)
    await this.save(userId, value)
    return result
  }
}

export async function realServiceHarness(replies: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-response-contract-'))
  const path = join(directory, 'contracts.db')
  const sessions = new BunInterviewSessionRepository(path)
  const states = new BunResumeInterviewStateRepository(path)
  const tasks = new BunTaskRepository(path)
  sessions.initialize(); states.initialize(); tasks.initialize()
  const sqlite = new Database(path)
  const repository = new MemoryProfileRepository()
  const remaining = [...replies]
  const ai: TextGenerationUseCases = {
    async complete() {
      const reply = remaining.shift()
      if (reply === undefined) throw new Error('Unexpected LLM call in HTTP contract test')
      return reply
    },
    async *stream() { throw new Error('Streaming is outside phase two'); yield '' },
  }
  const dispatcher = { enqueue: tasks.upsert.bind(tasks), get: tasks.get.bind(tasks) }
  const knowledgeStore = dependencyStub<InterviewDependencies['knowledgeStore']>({
    async loadTopics() { return { typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } } },
    async readHighFrequency() { return '' },
  })
  const resume = dependencyStub<InterviewDependencies['resume']>({ async text() { return '合成测试简历：后端服务项目。' } })
  const profile = new ProfileService({
    repository, sessions, tasks: dispatcher, ai, resume, knowledgeStore,
    embeddings: unavailable as ProfileDependencies['embeddings'], vectors: unavailable as ProfileDependencies['vectors'],
  })
  let nextId = 0
  const interview = new InterviewService({
    sessions, states, tasks: dispatcher, ai, resume, profile, knowledgeStore,
    ids: { next() { nextId += 1; return 'generated-session-' + nextId } },
    knowledge: dependencyStub<InterviewDependencies['knowledge']>({ async context() { return '合成知识资料' } }),
    settings: dependencyStub<InterviewDependencies['settings']>({ async loadTraining() { return { num_questions: 5, divergence: 3 } } }),
  })
  const app = boundaryApp({ interview, profile })
  const request = (url: string, method = 'GET', body?: unknown, token = jsonHeaders.authorization) =>
    app.request(url, { method, headers: { authorization: token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

  async function seedSession(session: InterviewSession) {
    await sessions.create({ sessionId: session.session_id, userId: session.user_id, mode: session.mode, topic: session.topic ?? undefined, questions: session.questions, meta: session.meta })
    // Simulate imported legacy JSON through the real SQLite reader, including
    // fields that the append-message port does not manufacture itself.
    sqlite.query('UPDATE sessions SET transcript=$transcript, scores=$scores, weak_points=$weak, overall=$overall, reference_answers=$answers, review=$review, status=$status, review_error=$error, created_at=$created, updated_at=$updated WHERE session_id=$id AND user_id=$user')
      .run({ $transcript: JSON.stringify(session.transcript), $scores: JSON.stringify(session.scores), $weak: JSON.stringify(session.weak_points), $overall: JSON.stringify(session.overall), $answers: JSON.stringify(session.reference_answers), $review: session.review ?? null, $status: session.status, $error: session.review_error ?? null, $created: session.created_at, $updated: session.updated_at, $id: session.session_id, $user: session.user_id })
  }

  async function seedTask(type: string, status: TaskRecord['status'], result: Record<string, unknown> = {}, error = 'synthetic task failure', taskId = 'task-1') {
    await tasks.upsert({ taskId, userId: 'user-a', type, payload: {} })
    if (status !== 'pending') {
      const owner = 'contract-worker'
      await tasks.claim(taskId, 'user-a', { owner, durationMs: 60_000 })
      if (status === 'done') await tasks.complete(taskId, 'user-a', owner, result)
      if (status === 'error') await tasks.fail(taskId, 'user-a', owner, error)
    }
  }

  return {
    app, request, interview, profile, repository, sessions, states, tasks, ai, remaining, seedSession, seedTask,
    async dispose() { sqlite.close(); sessions.close(); states.close(); tasks.close(); await rm(directory, { recursive: true, force: true }) },
  }
}
