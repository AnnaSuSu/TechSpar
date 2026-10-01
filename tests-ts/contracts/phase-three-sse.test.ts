import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ProviderResponseError, SettingsOperationsService, defaultProfile, type InterviewUseCases, type RequestContext, type SettingsOperationsUseCases } from '@techspar/core'
import { InterviewStreamEventSchema, IndexRebuildEventSchema } from '@techspar/contracts/events'
import { ResponseContractError } from '../../apps/api/src/http/response.ts'
import { boundaryApp, jsonHeaders, unavailable } from './test-app.ts'
import { dependencyStub, realServiceHarness } from './real-service-harness.ts'
import { loadTextFixture } from './fixture.ts'

type SettingsDeps = ConstructorParameters<typeof SettingsOperationsService>[0]
const disposers: Array<() => Promise<void>> = []
afterEach(async () => { while (disposers.length) await disposers.pop()!() })
const chatPath = '/api/interview/chat/stream'
const indexPath = '/api/settings/rebuild-index'
const chatBody = JSON.stringify({ session_id: 'session-1', message: '开始' })
const post = { method: 'POST', headers: jsonHeaders, body: chatBody }

export function parseFrames(body: string): unknown[] {
  expect<unknown>(body).toEndWith('\n\n')
  return body.trim().split('\n\n').map((frame) => { expect<unknown>(frame).toStartWith('data: '); return JSON.parse(frame.slice(6)) })
}

function appFor(path: string, events: (context: RequestContext) => AsyncIterable<unknown>) {
  return path === chatPath
    ? boundaryApp({ interview: { chatStream: events } as unknown as InterviewUseCases })
    : boundaryApp({ settingsOperations: { rebuildIndex: events } as unknown as SettingsOperationsUseCases })
}

describe('phase three real SSE transport boundaries', () => {
  for (const path of [chatPath, indexPath]) {
    const progress = path === chatPath ? { token: '你好' } : { completed: 0, total: 1, label: '合成步骤', status: 'running' }
    const failure = (message: string) => path === chatPath ? { error: message } : { fatal: true, error: message }
    const completion = path === chatPath ? { done: true, is_finished: false } : { done: true, rebuilt: { weak_points: true, personal_documents: false, topics: [] }, last_rebuild_at: '' }

    test(`${path} rejects invalid service output before it reaches the wire`, async () => {
      const logger = spyOn(console, 'error').mockImplementation(() => {})
      let finalized = false
      try {
        const response = await appFor(path, async function* () {
          try { yield progress; yield { private_content: 'PRIVATE-MODEL', done: false }; yield completion }
          finally { finalized = true }
        }).request(path, post)
        expect<unknown>(response.status).toBe(200)
        expect<unknown>(response.headers.get('content-type')).toContain('text/event-stream')
        const body = await response.text()
        expect<unknown>(parseFrames(body)).toEqual([progress, failure('Internal Server Error')])
        expect<unknown>(body).not.toContain('PRIVATE-MODEL')
        expect<unknown>(finalized).toBeTrue()
        expect<unknown>(logger).toHaveBeenCalledTimes(1)
        const error = logger.mock.calls[0]![0]
        expect<unknown>(error).toBeInstanceOf(ResponseContractError)
        expect<unknown>(JSON.stringify(error)).not.toContain('PRIVATE-MODEL')
        expect<unknown>(JSON.stringify(error)).not.toContain('private_content')
      } finally { logger.mockRestore() }
    })

    test(`${path} preserves service errors both before and after a token/progress event`, async () => {
      for (const started of [false, true]) {
        const response = await appFor(path, async function* () {
          if (started) yield progress
          throw new ProviderResponseError('合成服务错误')
        }).request(path, post)
        expect<unknown>(parseFrames(await response.text())).toEqual([...(started ? [progress] : []), failure('合成服务错误')])
      }
    })

    test(`${path} requires one terminal event and finishes producer work before releasing it`, async () => {
      let persisted = false
      const response = await appFor(path, async function* () { yield completion; persisted = true }).request(path, post)
      expect<unknown>(parseFrames(await response.text())).toEqual([completion])
      expect<unknown>(persisted).toBeTrue()
      const logger = spyOn(console, 'error').mockImplementation(() => {})
      try {
        for (const events of [[progress], [completion, progress], [completion, completion]]) {
          const invalid = await appFor(path, async function* () { yield* events }).request(path, post)
          const body = parseFrames(await invalid.text())
          expect<unknown>(body.at(-1)).toEqual(failure('Internal Server Error'))
          expect<unknown>(body).not.toContainEqual(completion)
        }
      } finally { logger.mockRestore() }
      const failed = await appFor(path, async function* () { yield completion; throw new Error('保存失败') }).request(path, post)
      expect<unknown>(parseFrames(await failed.text())).toEqual([failure('保存失败')])
    })

    test(`${path} propagates cancellation and closes the producer without more output`, async () => {
      const aborted = Promise.withResolvers<void>()
      const finalized = Promise.withResolvers<void>()
      const response = await appFor(path, async function* (context) {
        try {
          yield progress
          if (!context.signal.aborted) await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => { aborted.resolve(); resolve() }, { once: true }))
          else aborted.resolve()
          yield completion
        } finally { finalized.resolve() }
      }).request(path, post)
      const reader = response.body!.getReader()
      await reader.read()
      await reader.cancel()
      await Promise.all([aborted.promise, finalized.promise])
    })
  }

  test('keeps authentication and request validation outside the stream', async () => {
    const app = boundaryApp({ interview: unavailable as InterviewUseCases, settingsOperations: unavailable as SettingsOperationsUseCases })
    for (const path of [chatPath, indexPath]) {
      const response = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chatBody })
      expect<unknown>(response.status).toBe(401)
      expect<unknown>(response.headers.get('content-type')).toContain('application/json')
    }
    const invalid = await app.request(chatPath, { ...post, body: '{}' })
    expect<unknown>(invalid.status).toBe(422)
  })

  test('real Interview service produces the fixture and commits transcript before done', async () => {
    const h = await realServiceHarness(['初始问题'])
    disposers.push(h.dispose)
    h.ai.stream = async function* () { yield '你好' }
    const start = await h.request('/api/interview/start', 'POST', { mode: 'resume', target_role: '后端工程师' })
    const { session_id: id } = await start.json() as { session_id: string }
    const response = await h.request(chatPath, 'POST', { session_id: id, message: '开始' })
    const events = parseFrames(await response.text())
    expect<unknown>(events).toEqual(parseFrames(await loadTextFixture('sse/interview-chat-stream.txt')))
    for (const event of events) expect<unknown>(InterviewStreamEventSchema.parse(event)).toEqual(event)
    const stored = await h.sessions.get(id, 'user-a')
    expect<unknown>(stored?.transcript.at(-1)).toMatchObject({ role: 'assistant', content: '你好' })
    expect<unknown>(await h.sessions.get(id, 'user-b')).toBeUndefined()
    const state = (await h.states.load(id, 'user-a'))!
    await h.states.save(id, 'user-a', { ...state, is_finished: true })
    const finished = await h.request(chatPath, 'POST', { session_id: id, message: '继续' })
    expect<unknown>(parseFrames(await finished.text())).toEqual([{ done: true, is_finished: true }])
  })

  test('real Interview persistence failure cannot be reported as successful completion', async () => {
    const h = await realServiceHarness(['初始问题'])
    disposers.push(h.dispose)
    h.ai.stream = async function* () { yield '你好' }
    const { session_id: id } = await (await h.request('/api/interview/start', 'POST', { mode: 'resume', target_role: '后端工程师' })).json() as { session_id: string }
    const append = h.sessions.appendMessage.bind(h.sessions)
    h.sessions.appendMessage = async (...args) => { if (args[2] === 'assistant') throw new Error('保存失败'); return append(...args) }
    const response = await h.request(chatPath, 'POST', { session_id: id, message: '开始' })
    expect<unknown>(parseFrames(await response.text())).toEqual([{ token: '你好' }, { error: '保存失败' }])
  })

  test('real rebuild service continues after a failed step and reports fatal setup failures', async () => {
    let saved = ''
    let fatal = false
    const service = new SettingsOperationsService({
      chats: unavailable as never, embeddingDrivers: unavailable as never,
      embeddings: { async embed() { return [] } },
      index: { async invalidateUser() {}, resetEmbeddingClient() {}, async rebuildTopic() { throw new Error('主题失败') } },
      vectors: dependencyStub<SettingsDeps['vectors']>({ async replaceChunks() {} }),
      knowledge: dependencyStub<SettingsDeps['knowledge']>({ async loadTopics() { if (fatal) throw new Error('目录失败'); return { typescript: { name: 'TypeScript', icon: '', dir: '' } } } }),
      personal: dependencyStub<SettingsDeps['personal']>({ async hasDocuments() { return false } }),
      profile: dependencyStub<SettingsDeps['profile']>({ async get() { return defaultProfile() } }),
      settings: dependencyStub<SettingsDeps['settings']>({ async saveLastReindexAt(_id: string, value: string) { saved = value } }),
    })
    const app = boundaryApp({ settingsOperations: service })
    const events = parseFrames(await (await app.request(indexPath, post)).text())
    expect<unknown>(events).toContainEqual({ completed: 3, total: 3, label: '知识库 · TypeScript', status: 'error', error: '主题失败' })
    expect<unknown>(events.at(-1)).toEqual({ done: true, rebuilt: { weak_points: true, personal_documents: false, topics: [] }, last_rebuild_at: saved })
    expect<unknown>(saved).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    for (const event of events) expect<unknown>(IndexRebuildEventSchema.parse(event)).toEqual(event)
    fatal = true
    expect<unknown>(parseFrames(await (await app.request(indexPath, post)).text())).toEqual([{ fatal: true, error: '目录失败' }])
  })
})
