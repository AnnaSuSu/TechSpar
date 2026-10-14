import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultProfile, type CandidateProfile, type InterviewSession } from '@techspar/core'
import { FileCandidateProfileRepository } from '@techspar/platform'
import { CandidateProfileResponseSchema, InterviewResumeResponseSchema, InterviewSessionResponseSchema, ProfileDueReviewsResponseSchema } from '@techspar/contracts'
import { loadResponseFixture } from './fixture.ts'
import { realServiceHarness } from './real-service-harness.ts'

const harnesses: Awaited<ReturnType<typeof realServiceHarness>>[] = []
const directories: string[] = []
async function setup(replies: string[] = [], repository?: FileCandidateProfileRepository) {
  const h = await realServiceHarness(replies, repository)
  harnesses.push(h)
  return h
}
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function json(response: Response, status = 200) {
  expect(response.status).toBe(status)
  return response.json()
}

describe('legacy stored data through the real HTTP boundary', () => {
  test('reads old recording profiles with null topics without rewriting the JSON file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'techspar-legacy-profile-'))
    directories.push(directory)
    const profileDirectory = join(directory, 'users', 'user-a', 'profile')
    await mkdir(profileDirectory, { recursive: true })
    // The old recording fallback saved topic=None; SR initialization saved last_score=None.
    const weak = { point: '合成旧录音薄弱点', topic: null, source: 'observed', sr: { next_review: '2000-01-01', last_score: null }, legacy_extension: { kept: true } }
    const strong = { point: '合成旧强项', topic: null }
    const pattern = { point: '合成旧跨领域规律', topic: null, source: 'consolidated', confidence: 0.7 }
    const legacyProfile: CandidateProfile = { ...defaultProfile(), weak_points: [weak, pattern], strong_points: [strong] }
    const stored = JSON.stringify(legacyProfile)
    const path = join(profileDirectory, 'profile.json')
    await writeFile(path, stored)
    const h = await setup([], new FileCandidateProfileRepository(directory))

    const profile = await json(await h.request('/api/profile'))
    expect(CandidateProfileResponseSchema.parse(profile)).toEqual(profile)
    expect(profile.weak_points).toEqual([weak, pattern])
    expect(profile.strong_points).toEqual([strong])
    expect(profile.due_reviews).toEqual([{ point: weak.point, topic: null, next_review: '2000-01-01' }])
    const due = await json(await h.request('/api/profile/due-reviews'))
    expect(ProfileDueReviewsResponseSchema.parse(due)).toEqual([weak])
    expect(await json(await h.request('/api/profile/due-reviews?topic=typescript'))).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(stored)

    const feedback = await json(await h.request('/api/profile/pattern/feedback', 'POST', { point: pattern.point, verdict: 'accurate' }))
    expect(feedback).toMatchObject({ topic: null, user_acknowledged: true, confidence: 0.8 })
  })

  const legacyQuestions = [
    { name: 'nullable metadata', stored: { difficulty: 3, focus_area: null, category: null, intent: null }, expected: { difficulty: 3 } },
    { name: 'numeric string difficulty', stored: { difficulty: '3', focus_area: '合成考点' }, expected: { difficulty: 3, focus_area: '合成考点' } },
    { name: 'null difficulty', stored: { difficulty: null }, expected: {} },
    { name: 'zero difficulty', stored: { difficulty: 0, focus_area: '', category: '', intent: '' }, expected: { difficulty: 0, focus_area: '', category: '', intent: '' } },
  ]
  for (const entry of legacyQuestions) {
    test('reads ' + entry.name + ' across review, resume and topic history without rewriting SQLite', async () => {
      const h = await setup()
      const base = await loadResponseFixture('interview-review.json') as InterviewSession
      const common = { id: 'legacy-q1', question: '合成历史题目', legacy_extension: { kept: true } }
      const questions = [{ ...common, ...entry.stored }]
      await h.seedSession({ ...base, questions: questions as unknown as InterviewSession['questions'] })
      const stored = h.storedQuestions(base.session_id)
      expect(JSON.parse(stored!)).toEqual(questions)
      const expected = [{ ...common, ...entry.expected }]

      const review = await json(await h.request('/api/interview/review/' + base.session_id))
      expect(InterviewSessionResponseSchema.parse(review)).toEqual({ ...base, questions: expected })
      const resume = await json(await h.request('/api/interview/session/' + base.session_id + '/resume'))
      expect(InterviewResumeResponseSchema.parse(resume).questions).toEqual(expected)
      expect(await json(await h.request('/api/profile/topic/typescript/history'))).toEqual([{ ...base, questions: expected }])
      expect((await json(await h.request('/api/interview/history'))).items).toHaveLength(1)
      expect(h.storedQuestions(base.session_id)).toBe(stored)
      expect(h.remaining).toEqual([])
    })
  }

  test('keeps malformed legacy values visible to response validation', async () => {
    const h = await setup()
    const base = await loadResponseFixture('interview-review.json') as InterviewSession
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const [index, invalid] of [{ difficulty: 'not-a-number' }, { difficulty: '' }, { difficulty: 'Infinity' }, { difficulty: true }, { focus_area: 42 }].entries()) {
        const sessionId = 'invalid-legacy-' + index
        const questions = [{ id: 1, question: '合成损坏数据', ...invalid }]
        await h.seedSession({ ...base, session_id: sessionId, questions: questions as unknown as InterviewSession['questions'] })
        const stored = h.storedQuestions(sessionId)
        expect(await json(await h.request('/api/interview/review/' + sessionId), 500)).toEqual({ detail: 'Internal Server Error' })
        expect(h.storedQuestions(sessionId)).toBe(stored)
      }
    } finally { log.mockRestore() }
  })

  test('still rejects null metadata and string difficulty from newly generated questions before persistence', async () => {
    for (const invalid of [{ focus_area: null }, { difficulty: '3' }]) {
      const output = JSON.stringify({ questions: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, question: '合成新题目 ' + index, difficulty: 3, ...invalid })) })
      const h = await setup([output, output])
      await json(await h.request('/api/interview/start', 'POST', { mode: 'topic_drill', topic: 'typescript', num_questions: 5 }), 502)
      expect(h.storedQuestions('generated-session-1')).toBeUndefined()
      expect((await json(await h.request('/api/interview/history'))).total).toBe(0)
      expect(h.remaining).toEqual([])
    }
  })
})
