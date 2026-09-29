import { describe, expect, test } from 'bun:test'
import { applyTaskResponse, getTaskNavigationTarget, type TaskInfo, type TaskStatusResponse } from '../../frontend/src/lib/taskStatus.ts'
import { buildBehaviorSignals, buildVisitDelta, getMasteryScore, type ProfileData } from '../../frontend/src/pages/profile/derive.ts'
import { CandidateProfileResponseSchema, TaskStatusResponseSchema } from '@techspar/contracts'
import { loadResponseFixture } from './fixture.ts'

describe('generated response types at frontend consumers', () => {
  test('maps flat retrospective results into UI state and the correct topic navigation', async () => {
    const wire: TaskStatusResponse = TaskStatusResponseSchema.parse(await loadResponseFixture('task-retrospective.json'))
    const original: TaskInfo = { id: 'retro-task', type: 'retrospective', label: '领域回顾', status: 'pending' }
    const completed = applyTaskResponse(original, wire)
    expect(completed).toEqual({ ...original, status: 'done', result: wire })
    expect(getTaskNavigationTarget(completed)).toBe('/profile/topic/typescript')
    expect(original.status).toBe('pending')
  })

  test('preserves review shortcuts, failures and escaped navigation segments', () => {
    const task: TaskInfo = { id: 'session/id', type: 'drill_review', label: '专项复盘', status: 'pending' }
    expect(getTaskNavigationTarget(applyTaskResponse(task, { status: 'done', type: 'drill_review' }))).toBe('/review/session%2Fid')
    expect(applyTaskResponse(task, { status: 'error', type: 'drill_review', error: null }).status).toBe('error')
    const retrospective: TaskStatusResponse = { status: 'done', type: 'retrospective', topic: 'system/design', topic_name: '系统设计', retrospective: '# 回顾', retrospective_at: '', session_count: 1 }
    expect(getTaskNavigationTarget(applyTaskResponse({ ...task, type: 'retrospective' }, retrospective))).toBe('/profile/topic/system%2Fdesign')
    expect(getTaskNavigationTarget(applyTaskResponse(task, { status: 'done', type: 'extension_task', topic: 'unexpected' }))).toBe('/review/session%2Fid')
  })

  test('derives profile views from generated DTOs, preserving zero and legacy levels', async () => {
    const profile: ProfileData = CandidateProfileResponseSchema.parse(await loadResponseFixture('profile-rich.json'))
    expect(getMasteryScore(profile.topic_mastery.typescript)).toBe(0)
    expect(getMasteryScore(profile.topic_mastery.python)).toBe(60)
    const signals = buildBehaviorSignals(profile)
    expect(signals.activeNegativeCount).toBe(2)
    expect(signals.byNamespace.reasoning?.negative[0]?.description).toBe('缺少实例')
    const delta = buildVisitDelta(profile, new Set(['typescript', 'python']))
    expect(delta?.sessionsDelta).toBe(1)
    expect(delta?.masteryChanges).toEqual([{ topic: 'typescript', from: 10, to: 0, diff: -10 }])
    const empty: ProfileData = CandidateProfileResponseSchema.parse(await loadResponseFixture('profile.json'))
    expect(buildVisitDelta(empty)).toBeNull()
    expect(buildBehaviorSignals(empty).activeNegativeCount).toBe(0)
  })
})
