import { describe, expect, test } from 'bun:test'
import type { InterviewUseCases, ProfileUseCases } from '@techspar/core'
import { KNOWN_TASK_TYPES } from '@techspar/contracts'
import { boundaryApp, unavailable } from './test-app.ts'
import { phaseTwoCases } from './phase-two-cases.ts'

type Schema = {
  $ref?: string
  type?: string
  nullable?: boolean
  properties?: Record<string, Schema>
  required?: string[]
  enum?: unknown[]
  pattern?: string
  anyOf?: Schema[]
  oneOf?: Schema[]
  items?: Schema
  additionalProperties?: boolean | Schema
}
type Document = {
  paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Schema }> }> }>>
  components: { schemas: Record<string, Schema> }
}

async function document(): Promise<Document> {
  // Contracts are imported before app construction on purpose. Named schemas
  // must not depend on Hono having patched Zod before they were instantiated.
  const response = await boundaryApp({ interview: unavailable as InterviewUseCases, profile: unavailable as ProfileUseCases }).request('/openapi.json')
  expect(response.status).toBe(200)
  return response.json()
}
function resolve(spec: Document, schema: Schema): Schema {
  return schema.$ref ? resolve(spec, spec.components.schemas[schema.$ref.split('/').at(-1)!]!) : schema
}
function branches(spec: Document, schema: Schema): Schema[] {
  const resolved = resolve(spec, schema)
  const choices = resolved.anyOf ?? resolved.oneOf
  return choices ? choices.flatMap((choice) => branches(spec, choice)) : [resolved]
}

describe('phase two OpenAPI and generated artifact contracts', () => {
  test('documents concrete shapes for all 21 JSON responses and matches the generated artifact', async () => {
    const current = await document()
    const generated = await Bun.file('packages/contracts/openapi.json').json() as Document
    for (const entry of phaseTwoCases) {
      const [method, path] = entry.operation.split(' ') as [string, string]
      const response = current.paths[path]![method.toLowerCase()]!.responses['200']!
      expect(response).toEqual(generated.paths[path]![method.toLowerCase()]!.responses['200']!)
      const schema = response.content['application/json']!.schema
      for (const branch of branches(current, schema)) {
        expect(['object', 'array']).toContain(branch.type!)
        if (branch.type === 'object') {
          expect(Object.keys(branch.properties ?? {}).length, entry.operation).toBeGreaterThan(0)
          expect(branch.required?.length, entry.operation).toBeGreaterThan(0)
        } else expect(branch.items).toBeDefined()
      }
      if (schema.$ref) {
        const name = schema.$ref.split('/').at(-1)!
        expect(current.components.schemas[name]).toEqual(generated.components.schemas[name])
      }
    }
  })

  test('expresses mode-specific required fields and separate profile object families', async () => {
    const spec = await document()
    const starts = branches(spec, spec.components.schemas.InterviewStartResponse!)
    expect(starts.find((item) => item.properties?.mode?.enum?.includes('topic_drill'))?.required).toEqual(expect.arrayContaining(['session_id', 'mode', 'topic', 'questions']))
    expect(starts.find((item) => item.properties?.mode?.enum?.includes('resume'))?.required).toEqual(expect.arrayContaining(['session_id', 'mode', 'target_role', 'job_description', 'message']))
    expect(starts.find((item) => item.properties?.mode?.enum?.includes('resume'))?.required).not.toContain('topic')
    const marker = spec.components.schemas.ProfileViewedResponse!
    expect(marker.required).toEqual(['at', 'total_sessions', 'topic_scores'])
    expect(marker.properties).not.toHaveProperty('weak_points')
    const topicHistory = resolve(spec, spec.components.schemas.ProfileTopicHistoryResponse!)
    expect(resolve(spec, topicHistory.items!).required).toEqual(expect.arrayContaining(['session_id', 'transcript', 'reference_answers', 'user_id', 'created_at', 'updated_at']))
    const profile = spec.components.schemas.CandidateProfileResponse!
    const mastery = resolve(spec, profile.properties!.topic_mastery!.additionalProperties as Schema)
    expect(mastery.properties?.score?.type).toBe('number')
    expect(profile.additionalProperties).toEqual({ nullable: true })
  })

  test('documents task payload requirements and excludes known types from legacy fallback', async () => {
    const spec = await document()
    const tasks = branches(spec, spec.components.schemas.TaskStatusResponse!)
    const done = tasks.filter((item) => item.properties?.status?.enum?.includes('done'))
    const retrospective = done.find((item) => item.properties?.type?.enum?.includes('retrospective'))!
    expect(retrospective.required).toEqual(expect.arrayContaining(['topic', 'topic_name', 'retrospective', 'retrospective_at', 'session_count']))
    expect(retrospective.properties).not.toHaveProperty('result')
    expect(done.find((item) => item.properties?.type?.enum?.includes('copilot_prep'))?.required).toContain('prep_id')
    const review = done.find((item) => item.properties?.type?.enum?.includes('drill_review'))!
    expect(review.required).not.toContain('session_id')
    const legacy = done.find((item) => item.properties?.type?.pattern)!
    const pattern = new RegExp(legacy.properties!.type!.pattern!)
    for (const type of KNOWN_TASK_TYPES) expect(pattern.test(type)).toBe(false)
    expect(pattern.test('extension_task')).toBe(true)
  })
})
