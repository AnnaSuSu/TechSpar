import { afterEach, describe, expect, test } from 'bun:test'
import { type TaskRecord } from '@techspar/core'
import { realServiceHarness } from './real-service-harness.ts'
import { loadResponseFixture } from './fixture.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })
async function setup(replies: unknown[]) {
  const h = await realServiceHarness(replies.map((reply) => JSON.stringify(reply)))
  cleanups.push(h.dispose)
  return h
}
const jd = '负责 TypeScript 服务端架构、数据库优化和高并发系统设计，需要结合真实项目描述技术取舍。'.repeat(2)
const question = { id: 1, question: '解释事件循环', difficulty: 3, focus_area: '运行时' }

describe('phase four model producers at HTTP and persistence boundaries', () => {
  const invalidQuestions = [
    { name: 'duplicate mixed IDs', value: [question, { ...question, id: '1' }] },
    { name: 'out of range difficulty', value: [question, { ...question, id: 2, difficulty: 6 }] },
    { name: 'string difficulty', value: [question, { ...question, id: 2, difficulty: '3' }] },
    { name: 'empty text', value: [question, { ...question, id: 2, question: ' ' }] },
    { name: 'object ID', value: [question, { ...question, id: {} }] },
    { name: 'invalid focus area', value: [question, { ...question, id: 2, focus_area: [] }] },
  ]
  for (const { name, value } of invalidQuestions) test(`rejects ${name} after bounded retry without creating a session`, async () => {
    const h = await setup([{ questions: value }, { questions: value }])
    const response = await h.request('/api/interview/start', 'POST', { mode: 'topic_drill', topic: 'typescript', num_questions: 2 })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'provider_response_error' })
    expect(await h.sessions.get('generated-session-1', 'user-a')).toBeUndefined()
    expect(h.remaining).toEqual([])
  })

  test('maps truncated model JSON to a provider error before creating a session', async () => {
    const h = await realServiceHarness(['{"questions":[{"id":1', '{"questions":[{"id":1'])
    cleanups.push(h.dispose)
    const response = await h.request('/api/interview/start', 'POST', { mode: 'topic_drill', topic: 'typescript', num_questions: 2 })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'provider_response_error' })
    expect(await h.sessions.get('generated-session-1', 'user-a')).toBeUndefined()
  })

  const invalidPreviews: Array<[string, (value: Record<string, any>) => void]> = [
    ['invalid model company', (v) => { v.company = 3 }],
    ['invalid model position', (v) => { v.position = {} }],
    ['missing role summary', (v) => { delete v.role_summary }],
    ['object role summary', (v) => { v.role_summary = { overview: 'bad' } }],
    ['invalid focus area', (v) => { v.focus_areas[0].priority = 3 }],
    ['invalid question group', (v) => { v.likely_question_groups[0].sample_questions = [{}] }],
    ['invalid resume flag', (v) => { v.resume_alignment.resume_used = 'true' }],
    ['invalid evidence', (v) => { v.resume_alignment.matching_evidence = [{}] }],
    ['invalid stories', (v) => { v.resume_alignment.recommended_stories = [{ project: '项目' }] }],
    ['invalid priorities', (v) => { v.prep_priorities = [{ title: '准备' }] }],
    ['legacy blueprint from model', (v) => { v.question_blueprint = [{ legacy_blueprint: true }] }],
    ['invalid blueprint difficulty', (v) => { v.question_blueprint[0].difficulty = 0 }],
  ]
  for (const [name, mutate] of invalidPreviews) test(`rejects JD ${name} before starting training`, async () => {
    const fixture = await loadResponseFixture('interview-job-preview.json') as { preview: Record<string, any> }
    fixture.preview.question_blueprint = [{ category: '技术', focus_area: '运行时', intent: '验证原理', difficulty: 3 }]
    mutate(fixture.preview)
    const h = await setup([fixture.preview, fixture.preview])
    for (const route of ['/api/job-prep/preview', '/api/job-prep/start']) {
      const response = await h.request(route, 'POST', { jd_text: jd, company: '客户端公司', position: '客户端岗位' })
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ code: 'provider_response_error' })
    }
    expect(await h.sessions.get('generated-session-1', 'user-a')).toBeUndefined()
    expect(h.remaining).toEqual([])
  })

  const invalidReviews = [
    { scores: [{ question_id: 999, score: 7 }], overall: { avg_score: 7 } },
    { scores: [{ question_id: 1, score: 7 }, { question_id: '1', score: 7 }], overall: { avg_score: 7 } },
    { scores: [{ question_id: 1, score: 11 }], overall: { avg_score: 7 } },
    { scores: [{ question_id: 1, score: 7, key_missing: [{}] }], overall: { avg_score: 7 } },
    { scores: [{ question_id: 1, score: 7 }], overall: { avg_score: -1 } },
    { scores: [], overall: { avg_score: 7, dimension_scores: { technical_depth: '7' } } },
    { scores: [], overall: { avg_score: 7, new_weak_points: [{ point: {} }] } },
  ]
  for (const mode of ['topic_drill', 'jd_prep'] as const) for (const [index, review] of invalidReviews.entries()) {
    test(`${mode} rejects malformed review ${index} without saving review or updating profile`, async () => {
      const h = await setup([review])
      await h.sessions.create({ sessionId: 'review', userId: 'user-a', mode, topic: 'typescript', questions: [question] })
      let profileWrites = 0
      h.profile.afterReview = async () => { profileWrites++; return {} }
      const task: TaskRecord = { task_id: 'review', user_id: 'user-a', type: 'drill_review', status: 'running', payload: {}, attempts: 1, created_at: '', updated_at: '' }
      await expect(h.interview.runReviewTask(task)).rejects.toThrow()
      const session = await h.sessions.get('review', 'user-a')
      expect(session).toMatchObject({ status: 'review_failed', scores: [], overall: {} })
      expect(session?.review).toBeNull()
      expect(session?.review_error).toBeString()
      expect(profileWrites).toBe(0)
      const response = await h.request('/api/tasks/review')
      expect(await response.json()).toMatchObject({ status: 'error' })
    })
  }

  test('a valid retry is saved once, preserving zero and ten scores and mixed IDs', async () => {
    const h = await setup([{ questions: [question, question] }, { questions: [question, { ...question, id: 'q2', difficulty: 5 }] }, { scores: [{ question_id: 1, score: 0 }, { question_id: 'q2', score: 10 }], overall: { avg_score: 5 } }])
    const response = await h.request('/api/interview/start', 'POST', { mode: 'topic_drill', topic: 'typescript', num_questions: 2 })
    expect(response.status).toBe(200)
    const started = await response.json() as { session_id: string }
    h.profile.afterReview = async () => ({})
    await h.interview.runReviewTask({ task_id: started.session_id, user_id: 'user-a', type: 'drill_review', status: 'running', payload: {}, attempts: 1, created_at: '', updated_at: '' })
    expect(await h.sessions.get(started.session_id, 'user-a')).toMatchObject({ status: 'reviewed', scores: [{ score: 0 }, { score: 10 }] })
    expect(h.remaining).toEqual([])
  })
})
