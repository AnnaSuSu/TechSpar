import { describe, expect, test } from 'bun:test'
import type { InterviewUseCases, SettingsOperationsUseCases } from '@techspar/core'
import { boundaryApp, unavailable } from './test-app.ts'
import { responseInventory } from './response-inventory.ts'

type Schema = { type?: string; $ref?: string; required?: string[]; anyOf?: Schema[]; oneOf?: Schema[]; additionalProperties?: unknown; properties?: Record<string, Schema>; enum?: unknown[]; const?: unknown }
type Document = { components: { schemas: Record<string, Schema> }; paths: Record<string, { post: { responses: { '200': { content: { 'text/event-stream': { schema: Schema; 'x-event-schema': { $ref: string } } } } } } }> }

describe('stream event documentation and generated contracts', () => {
  test('publishes named event schemas while preserving SSE wire framing and HTTP operation inventory', async () => {
    const app = boundaryApp({ interview: unavailable as InterviewUseCases, settingsOperations: unavailable as SettingsOperationsUseCases })
    const current = await (await app.request('/openapi.json')).json() as Document
    const generated = await Bun.file('packages/contracts/openapi.json').json() as Document
    for (const [path, name] of [['/api/interview/chat/stream', 'InterviewStreamEvent'], ['/api/settings/rebuild-index', 'IndexRebuildEvent']]) {
      const content = current.paths[path!]!.post.responses['200'].content['text/event-stream']
      expect(content.schema.type).toBe('string')
      expect(content['x-event-schema']).toEqual({ $ref: `#/components/schemas/${name}` })
      expect(current.components.schemas[name!]).toEqual(generated.components.schemas[name!])
      const inventory = responseInventory.find((entry) => entry.operation === `POST ${path}`)!
      expect(inventory.dynamic).toBeFalse()
      expect(inventory.responseSchema).toBe(`${name}Schema`)
    }
    expect(Object.keys(current.paths).some((path) => path.startsWith('/ws/'))).toBeFalse()
    const ws = current.components.schemas.CopilotServerEvent!
    expect(ws).toEqual(generated.components.schemas.CopilotServerEvent!)
    const branches = ws.oneOf ?? ws.anyOf ?? []
    expect(branches).toHaveLength(13)
    for (const branch of branches) {
      const type = branch.properties!.type!.const ?? branch.properties!.type!.enum?.[0]
      expect(branch.required).toContain('type')
      if (type === 'monitor_update' || type === 'hr_profile_update') expect(branch.additionalProperties).not.toBe(false)
      else expect(branch.additionalProperties).toBe(false)
      if (type === 'started') expect(branch.required).toContain('session_id')
      if (type === 'answer_done') expect(branch.required).toEqual(['type', 'total_ms', 'chunk_count'])
    }
    // Repeated generation must not accumulate registry entries or alter output.
    expect(await (await app.request('/openapi.json')).json()).toEqual(current)
  })
})
