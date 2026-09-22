import { describe, expect, test } from 'bun:test'
import { ProviderResponseError, type CopilotPrepUseCases, type InterviewUseCases, type JobPrepInput, type PersonalAgentUseCases, type StartInterviewInput } from '@techspar/core'
import { boundaryApp, jsonHeaders as headers } from './contracts/test-app.ts'

describe('legacy nullable HTTP request contracts', () => {
  test('accepts numeric confidence when ending a batch interview', async () => {
    let received: unknown
    const interview = {
      async end(_context: unknown, _sessionId: string, answers: unknown) {
        received = answers
        return { session_id: 'drill-1', status: 'pending' }
      },
    } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/interview/end/drill-1', {
      method: 'POST', headers, body: JSON.stringify({ answers: [{ question_id: 1, answer: '答', confidence: 0 }] }),
    })

    expect(response.status).toBe(200)
    expect(received).toEqual([{ question_id: 1, answer: '答', confidence: 0 }])
  })

  test('accepts topic: null when starting a resume interview', async () => {
    let received: StartInterviewInput | undefined
    const interview = {
      async start(_context: unknown, input: StartInterviewInput) { received = input; return { session_id: 'resume-1', mode: 'resume' } },
    } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/interview/start', {
      method: 'POST', headers, body: JSON.stringify({ mode: 'resume', topic: null, target_role: 'AI 应用开发工程师' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ session_id: 'resume-1', mode: 'resume' })
    expect(received).toMatchObject({ mode: 'resume', target_role: 'AI 应用开发工程师' })
    expect(received?.topic).toBeUndefined()
  })

  test('accepts null company and position for both JD preparation endpoints', async () => {
    let previewInput: JobPrepInput | undefined
    let startInput: JobPrepInput | undefined
    const interview = {
      async previewJob(_context: unknown, input: JobPrepInput) { previewInput = input; return { preview: { role_summary: '后端岗位' } } },
      async startJob(_context: unknown, input: JobPrepInput) { startInput = input; return { session_id: 'job-1', mode: 'jd_prep' } },
    } as unknown as InterviewUseCases
    const app = boundaryApp({ interview })
    const payload = { jd_text: '负责后端系统设计与 TypeScript 服务开发', company: null, position: null, use_resume: true }

    const preview = await app.request('/api/job-prep/preview', { method: 'POST', headers, body: JSON.stringify(payload) })
    const start = await app.request('/api/job-prep/start', { method: 'POST', headers, body: JSON.stringify({ ...payload, preview_data: { role_summary: '后端岗位' } }) })

    expect(preview.status).toBe(200)
    expect(start.status).toBe(200)
    expect(previewInput?.company).toBeUndefined()
    expect(previewInput?.position).toBeUndefined()
    expect(startInput?.company).toBeUndefined()
    expect(startInput?.position).toBeUndefined()
  })

  test('accepts conversation_id: null and returns an assistant message object', async () => {
    let conversationId: string | undefined
    const message = {
      role: 'assistant' as const,
      content: '根据你的记录，建议先复习 GIL。',
      created_at: '2026-08-20T10:00:00.000Z',
      sources: [{ document_id: 'doc-1', filename: 'python-notes.md' }],
    }
    const personalAgent = {
      async chat(_context: unknown, _input: string, value?: string) { conversationId = value; return { conversation_id: 'conversation-1', title: '复习建议', message } },
    } as unknown as PersonalAgentUseCases
    const response = await boundaryApp({ personalAgent }).request('/api/personal-agent/chat', {
      method: 'POST', headers, body: JSON.stringify({ conversation_id: null, message: '我该先复习什么？' }),
    })

    expect(response.status).toBe(200)
    expect(conversationId).toBeUndefined()
    expect(await response.json()).toEqual({ conversation_id: 'conversation-1', title: '复习建议', message })
  })
})

describe('FastAPI-compatible HTTP validation', () => {
  test('keeps provider response failures as a readable 502', async () => {
    const interview = { async start() { throw new ProviderResponseError('模型服务连续返回空内容，请稍后再试。') } } as unknown as InterviewUseCases
    const response = await boundaryApp({ interview }).request('/api/interview/start', {
      method: 'POST', headers, body: JSON.stringify({ mode: 'topic_drill', topic: 'typescript' }),
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ detail: '模型服务连续返回空内容，请稍后再试。', code: 'provider_response_error' })
  })

  test('keeps malformed JSON as a JSON 400 response', async () => {
    const response = await boundaryApp({}).request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ detail: 'Malformed JSON in request body' })
  })

  test('returns FastAPI-style 422 details for schema validation failures', async () => {
    const response = await boundaryApp({}).request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })

    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      detail: [
        { type: 'missing', loc: ['body', 'email'], msg: 'Field required', input: {} },
        { type: 'missing', loc: ['body', 'password'], msg: 'Field required', input: {} },
      ],
    })
  })
})

describe('Copilot preparation form compatibility', () => {
  test('accepts both legacy urlencoded and multipart form requests', async () => {
    const received: Array<{ jd_text: string; company?: string; position?: string }> = []
    const prep = {
      async start(_context: unknown, input: { jd_text: string; company?: string; position?: string }) {
        received.push(input)
        return { prep_id: `prep-${received.length}` }
      },
    } as unknown as CopilotPrepUseCases
    const app = boundaryApp({ copilotPrep: prep })

    const legacy = await app.request('/api/copilot/prep', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ jd_text: '负责支付系统稳定性', company: '示例科技', position: '后端工程师' }),
    })
    const multipartBody = new FormData()
    multipartBody.set('jd_text', '负责实时语音模型接入')
    multipartBody.set('company', '样例智能')
    multipartBody.set('position', 'AI 工程师')
    const multipart = await app.request('/api/copilot/prep', {
      method: 'POST', headers: { authorization: 'Bearer test-token' }, body: multipartBody,
    })

    expect(legacy.status).toBe(200)
    expect(await legacy.json()).toEqual({ prep_id: 'prep-1' })
    expect(multipart.status).toBe(200)
    expect(await multipart.json()).toEqual({ prep_id: 'prep-2' })
    expect(received).toEqual([
      { jd_text: '负责支付系统稳定性', company: '示例科技', position: '后端工程师' },
      { jd_text: '负责实时语音模型接入', company: '样例智能', position: 'AI 工程师' },
    ])
  })
})
