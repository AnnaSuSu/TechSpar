import { describe, expect, test } from 'bun:test'
import { CopilotServerEventSchema, CopilotServerEventTypeSchema, InterviewStreamEventSchema, IndexRebuildEventSchema } from '@techspar/contracts/events'
import type { CopilotServerEvent, IndexRebuildEvent, InterviewStreamEvent } from '@techspar/core'
import { loadTextFixture } from './fixture.ts'

async function copilotFixtures(name = 'events'): Promise<unknown[]> {
  return JSON.parse(await loadTextFixture(`copilot/${name}.json`))
}

describe('phase three event contracts', () => {
  test('covers all 13 WS events and preserves complete fixture payloads', async () => {
    const events = await copilotFixtures()
    const parsed = events.map((event) => CopilotServerEventSchema.parse(event))
    expect<unknown>(parsed).toEqual(events)
    expect<unknown>(parsed.map((event) => event.type).sort()).toEqual([...CopilotServerEventTypeSchema.options].sort())
    const core: CopilotServerEvent[] = parsed
    const wire: typeof parsed = core
    expect<unknown>(wire).toEqual(events)
    for (const event of parsed) {
      expect<unknown>(CopilotServerEventSchema.safeParse({ ...event, type: 'unknown_event' }).success).toBeFalse()
      const { type: _, ...missingType } = event
      expect<unknown>(CopilotServerEventSchema.safeParse(missingType).success).toBeFalse()
      if (event.type !== 'monitor_update' && event.type !== 'hr_profile_update') {
        expect<unknown>(CopilotServerEventSchema.safeParse({ ...event, extra: true }).success).toBeFalse()
        for (const key of Object.keys(event).filter((key) => key !== 'type')) {
          if (key === 'role') continue
          const missing = { ...event } as Record<string, unknown>
          delete missing[key]
          expect<unknown>(CopilotServerEventSchema.safeParse(missing).success, `${event.type}.${key}`).toBeFalse()
        }
      }
    }
  })

  test('preserves explicit compatibility islands without accepting wrong known fields', async () => {
    const events = await copilotFixtures('compatibility-events')
    expect<unknown>(events.map((event) => CopilotServerEventSchema.parse(event))).toEqual(events)
    for (const event of [
      { type: 'asr_final', text: 'x', role: 'system' }, { type: 'progress', message: 'x', progress: 0.5 },
      { type: 'answer_meta', first_token_ms: '1' }, { type: 'answer_done', total_ms: 1, chunk_count: -1 },
      { type: 'hr_profile_update', style: {} }, { type: 'hr_profile_update', advice: null },
      { type: 'monitor_update', uncovered_topics: 'topic' }, { type: 'monitor_update', covered_topics: [123] },
      { type: 'error', text: 'wrong field' },
    ]) expect<unknown>(CopilotServerEventSchema.safeParse(event).success).toBeFalse()
    const update = (await copilotFixtures()).find((event) => (event as { type: string }).type === 'copilot_update') as object
    for (const patch of [{ confidence: NaN }, { confidence: Infinity }, { recommended_points: [1] }, { children: [{}] }, { prep_hint: { safe_talking_points: [] } }]) {
      expect<unknown>(CopilotServerEventSchema.safeParse({ ...update, ...patch }).success).toBeFalse()
    }
  })

  test('expresses exclusive Interview stream branches without coercion or defaults', () => {
    const core: InterviewStreamEvent[] = [{ token: '' }, { done: true, is_finished: false }, { done: true, is_finished: true }]
    const events = [...core, { error: '' }]
    expect<unknown>(events.map((event) => InterviewStreamEventSchema.parse(event))).toEqual(events)
    for (const event of [{}, { token: 1 }, { done: false }, { done: true }, { is_finished: true }, { token: 'x', done: true, is_finished: false }, { error: 'x', token: 'x' }]) {
      expect<unknown>(InterviewStreamEventSchema.safeParse(event).success).toBeFalse()
    }
  })

  test('keeps index step failures separate from terminal failures and completion', () => {
    const core: IndexRebuildEvent[] = [
      { completed: 0, total: 1, label: '', status: 'running' }, { completed: 1, total: 1, label: '', status: 'done' },
      { completed: 1, total: 1, label: '', status: 'error', error: 'step failed' },
      { done: true, rebuilt: { weak_points: false, personal_documents: false, topics: [] }, last_rebuild_at: '2026-01-01T00:00:00' },
      { fatal: true, error: 'failed' },
    ]
    expect<unknown>(core.map((event) => IndexRebuildEventSchema.parse(event))).toEqual(core)
    for (const event of [{}, { fatal: false, error: 'x' }, { fatal: true }, { done: true }, { ...core[0], completed: '0' }, { ...core[0], total: -1 }, { ...core[0], status: 'error' }, { ...core[0], error: 'not an error step' }, { ...core[4], done: true }]) {
      expect<unknown>(IndexRebuildEventSchema.safeParse(event).success).toBeFalse()
    }
  })
})
