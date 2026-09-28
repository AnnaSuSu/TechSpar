import { describe, expect, test } from 'bun:test'
import { ProviderResponseError, type InterviewUseCases, type ProfileUseCases } from '@techspar/core'
import { loadResponseFixture } from './fixture.ts'
import { boundaryApp, jsonHeaders } from './test-app.ts'

describe('HTTP response boundary inventory', () => {
  test('keeps service info response shape', async () => {
    const response = await boundaryApp().request('/api/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ service: 'TechSpar', version: expect.any(String) })
  })

  test('records the current dynamic topic-drill start response', async () => {
    const interview = {
      async start() { return loadResponseFixture('interview-start-topic.json') },
    } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/interview/start', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ mode: 'topic_drill', topic: 'typescript' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      session_id: expect.any(String), mode: 'topic_drill', topic: expect.any(String), questions: expect.any(Array),
    })
  })

  test('records the current profile response shape', async () => {
    const profile = {
      async get() { return loadResponseFixture('profile.json') },
    } as unknown as ProfileUseCases
    const response = await boundaryApp({ profile }).request('/api/profile', { headers: { authorization: jsonHeaders.authorization } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ weak_points: expect.any(Array), stats: expect.any(Object) })
  })

  test('keeps task status responses parseable at the HTTP boundary', async () => {
    const interview = {
      async task() { return loadResponseFixture('task-pending.json') },
    } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/tasks/task-1', {
      headers: { authorization: jsonHeaders.authorization },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'pending', type: 'drill_review' })
  })

  test('preserves the current interview SSE framing', async () => {
    const interview = {
      async *chatStream() {
        yield { token: '你好' }
        yield { done: true, is_finished: false }
      },
    } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/interview/chat/stream', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ session_id: 'session-1', message: '开始' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toContain('data: {"token":"你好"}')
    expect(body).toContain('data: {"done":true,"is_finished":false}')
  })

  test('preserves provider errors at the HTTP boundary', async () => {
    const interview = {
      async start() { throw new ProviderResponseError('模型服务响应无效') },
    } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/interview/start', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ mode: 'topic_drill', topic: 'typescript' }),
    })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ detail: '模型服务响应无效', code: 'provider_response_error' })
  })

  test('returns the existing validation error format', async () => {
    const response = await boundaryApp().request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ detail: expect.any(Array) })
  })

  test('returns JSON 401 for missing authentication', async () => {
    // Register the route so the request reaches the authentication boundary.
    const response = await boundaryApp({ profile: {} as ProfileUseCases }).request('/api/profile')
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ detail: 'Invalid or expired token' })
  })
})
