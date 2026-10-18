import { expect, test } from 'bun:test'
import type { LlmSettings, SettingsView } from '@techspar/core'
import { SettingsViewSchema } from '@techspar/contracts'
import { boundaryApp, jsonHeaders } from './test-app.ts'

test('validates reasoning effort before forwarding the current form to the LLM probe', async () => {
  const submitted: LlmSettings[] = []
  const app = boundaryApp({
    settingsOperations: {
      async testLlm(_context, value) { submitted.push(value); return { ok: true } },
      async testEmbedding() { throw new Error('not used') },
      async *rebuildIndex() { throw new Error('not used') },
    },
  })
  const form = { api_base: 'https://provider.test/v1', api_key: 'synthetic', model: 'test-model' }
  for (const effort of ['', 'none', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const response = await app.request('/api/settings/test-llm', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...form, reasoning_effort: effort }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(submitted.at(-1)?.reasoning_effort).toBe(effort)
  }
  const invalid = await app.request('/api/settings/test-llm', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...form, reasoning_effort: 'unsupported' }),
  })
  expect(invalid.status).toBe(422)
  expect(submitted).toHaveLength(7)

  const legacy = await app.request('/api/settings/test-llm', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(form),
  })
  expect(legacy.status).toBe(200)
  expect(submitted.at(-1)?.reasoning_effort).toBeUndefined()
})

test('keeps reasoning effort in settings update and read contracts', async () => {
  let stored: SettingsView = SettingsViewSchema.parse({ llm: {}, training: { num_questions: 10, divergence: 3 } })
  const app = boundaryApp({
    settings: {
      async get() { return stored },
      async update(_context, value) { stored = value; return { ok: true, embedding_changed: false } },
      async llmSource() { return 'user' },
    },
  })
  const update = await app.request('/api/settings', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ...stored, llm: { ...stored.llm, reasoning_effort: 'xhigh' } }),
  })
  expect(update.status).toBe(200)
  expect(stored.llm.reasoning_effort).toBe('xhigh')
  const read = await app.request('/api/settings', { headers: jsonHeaders })
  expect(read.status).toBe(200)
  expect((await read.json()).llm.reasoning_effort).toBe('xhigh')
  const invalid = await app.request('/api/settings', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ...stored, llm: { ...stored.llm, reasoning_effort: 'unsupported' } }),
  })
  expect(invalid.status).toBe(422)
  expect(stored.llm.reasoning_effort).toBe('xhigh')
})
