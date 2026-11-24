import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PersonalAgentService, defaultProfile, type AgentMessage, type ChatMessage,
  type ProfileUseCases, type RequestContext, type TextGenerationUseCases,
} from '@techspar/core'
import { BunPersonalAgentRepository } from '@techspar/db'
import { boundaryApp, jsonHeaders, unavailable } from './contracts/test-app.ts'
import { dependencyStub } from './contracts/real-service-harness.ts'

class ControlledAi implements TextGenerationUseCases {
  requests: Array<{ messages: ChatMessage[]; resolve: (value: string) => void; reject: (reason: Error) => void }> = []
  private changed = Promise.withResolvers<void>()

  complete(_context: RequestContext, messages: readonly ChatMessage[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.requests.push({ messages: [...messages], resolve, reject })
      this.changed.resolve()
      this.changed = Promise.withResolvers<void>()
    })
  }

  async waitForCalls(count: number): Promise<void> {
    while (this.requests.length < count) await this.changed.promise
  }

  async *stream(): AsyncIterable<string> { throw new Error('unexpected streaming call') }
}

describe('personal Agent conversation persistence', () => {
  let root: string
  let path: string
  let repository: BunPersonalAgentRepository
  let repositories: BunPersonalAgentRepository[]
  let service: PersonalAgentService
  let ai: ControlledAi
  const context: RequestContext = { requestId: 'chat-test', userId: 'user-a', signal: new AbortController().signal }
  const history: AgentMessage[] = [
    { role: 'user', content: '初始问题', created_at: '2026-01-01T00:00:00.000Z' },
    { role: 'assistant', content: '初始回答', created_at: '2026-01-01T00:00:00.000Z', sources: [] },
  ]

  function openRepository() {
    const value = new BunPersonalAgentRepository(path)
    value.initialize()
    repositories.push(value)
    return value
  }

  function agent(value = repository) {
    return new PersonalAgentService({ repository: value, ai,
      profile: dependencyStub<ProfileUseCases>({ async get() { return defaultProfile() }, async dueReviews() { return [] } }),
      files: unavailable as never, extractor: unavailable as never,
      embeddings: { async embed(_request, texts) { return texts.map(() => Float32Array.from([1, 0])) },
        async signature() { return 'synthetic' }, reset() {} },
      ids: { next: () => 'unused' },
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-agent-concurrency-'))
    path = join(root, 'agent.db')
    repositories = []
    repository = openRepository()
    ai = new ControlledAi()
    service = agent()
    await repository.createConversation({ conversationId: 'conversation-a', userId: 'user-a', title: '合成会话' })
    await repository.saveConversation('conversation-a', 'user-a', structuredClone(history))
  })

  afterEach(async () => {
    for (const value of repositories) value.close()
    await rm(root, { recursive: true, force: true })
  })

  test.each(['forward', 'reverse'])('preserves concurrent turns across SQLite connections (%s)', async direction => {
    const other = agent(openRepository())
    const pending = [service.chat(context, '问题一', 'conversation-a'), other.chat(context, '问题二', 'conversation-a')]
    await ai.waitForCalls(2)
    const order = direction === 'reverse' ? [1, 0] : [0, 1]
    for (const index of order) {
      ai.requests[index]!.resolve(`回答${index + 1}`)
      expect((await pending[index])!.message.content).toBe(`回答${index + 1}`)
    }
    const stored = await service.conversation(context, 'conversation-a')
    const turns = ['问题一', '问题二']
    expect(stored.messages.map(message => message.content)).toEqual([
      '初始问题', '初始回答', ...order.flatMap(index => [turns[index], `回答${index + 1}`]),
    ])
    expect(stored.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(ai.requests.map(request => request.messages.at(-1)!.content)).toEqual(turns)
  })

  test('includes a turn committed while another response is still being generated', async () => {
    const pending = service.chat(context, '较慢的问题', 'conversation-a')
    await ai.waitForCalls(1)
    const external = openRepository()
    const committed: AgentMessage[] = [
      { role: 'user', content: '已提交的问题', created_at: history[0]!.created_at },
      { role: 'assistant', content: '已提交的回答', created_at: history[0]!.created_at, sources: [] },
    ]
    await external.saveConversation('conversation-a', 'user-a', [...history, ...committed])
    ai.requests[0]!.resolve('较慢的回答')
    await pending
    expect((await service.conversation(context, 'conversation-a')).messages.map(message => message.content)).toEqual([
      '初始问题', '初始回答', '已提交的问题', '已提交的回答', '较慢的问题', '较慢的回答',
    ])
  })

  test('returns HTTP 404 when the conversation is deleted during generation', async () => {
    const app = boundaryApp({ personalAgent: service })
    const pending = app.request('/api/personal-agent/chat', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ message: '正在生成的问题', conversation_id: 'conversation-a' }) })
    await ai.waitForCalls(1)
    expect(await repository.deleteConversation('conversation-a', 'user-a')).toBeTrue()
    ai.requests[0]!.resolve('不应报告为已保存的回答')
    const response = await pending
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: '对话不存在' })
    expect(await repository.getConversation('conversation-a', 'user-a')).toBeUndefined()
  })

  test('rejects another user without calling the model or changing the conversation', async () => {
    await expect(service.chat({ ...context, userId: 'user-b' }, '其他用户的问题', 'conversation-a')).rejects.toMatchObject({ status: 404 })
    expect(ai.requests).toHaveLength(0)
    expect((await repository.getConversation('conversation-a', 'user-a'))!.messages).toEqual(history)
  })

  test('keeps history unchanged when model generation fails', async () => {
    const pending = service.chat(context, '失败的问题', 'conversation-a')
    await ai.waitForCalls(1)
    ai.requests[0]!.reject(new Error('model unavailable'))
    await expect(pending).rejects.toThrow('model unavailable')
    expect((await service.conversation(context, 'conversation-a')).messages).toEqual(history)
  })

  test('does not append a partial turn for an empty model response', async () => {
    const pending = service.chat(context, '空回答的问题', 'conversation-a')
    await ai.waitForCalls(1)
    ai.requests[0]!.resolve('  ')
    await expect(pending).rejects.toMatchObject({ status: 500, message: '模型没有返回内容' })
    expect((await service.conversation(context, 'conversation-a')).messages).toEqual(history)
  })

  test('persists a new conversation before a successful HTTP response and survives reopening', async () => {
    const app = boundaryApp({ personalAgent: service })
    const pending = app.request('/api/personal-agent/chat', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ message: '新的会话问题' }) })
    await ai.waitForCalls(1)
    ai.requests[0]!.resolve('新的会话回答')
    const response = await pending
    expect(response.status).toBe(200)
    const result = await response.json() as { conversation_id: string; message: AgentMessage }
    expect(result.message).toMatchObject({ role: 'assistant', content: '新的会话回答', sources: [] })
    const reopened = openRepository()
    const stored = await reopened.getConversation(result.conversation_id, 'user-a')
    expect(stored!.messages.map(message => message.content)).toEqual(['新的会话问题', '新的会话回答'])
    expect(stored!.messages[1]).toEqual(result.message)
    expect(await reopened.getConversation(result.conversation_id, 'user-b')).toBeUndefined()
  })
})
