import { describe, expect, test } from 'bun:test'
import { createApp, type AppDependencies } from '../../apps/api/src/app.ts'
import { inventoryOperations } from './response-inventory.ts'

type Operation = {
  parameters?: unknown[]
  requestBody?: { required?: boolean; content?: Record<string, unknown> }
  responses?: Record<string, unknown>
  security?: Array<Record<string, string[]>>
}
type Spec = {
  components?: { securitySchemes?: Record<string, unknown> }
  paths: Record<string, Record<string, unknown>>
}

const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head'])

function operationEntries(spec: Spec): Array<[string, Operation]> {
  return Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item)
    .filter(([method, value]) => HTTP.has(method) && value && typeof value === 'object')
    .map(([method, value]) => [`${method.toUpperCase()} ${path}`, value as Operation] as [string, Operation]))
}

function operations(spec: Spec): string[] {
  return operationEntries(spec).map(([operation]) => operation).sort()
}

async function loadSpecs(): Promise<{ baseline: Spec; current: Spec }> {
  const baseline = await Bun.file('tests-ts/contracts/fastapi-openapi.json').json() as Spec
  const unavailable = new Proxy({}, { get() { return () => Promise.reject(new Error('not called while generating OpenAPI')) } })
  const deps = {
    auth: unavailable, registration: { allowRegistration: false }, settings: unavailable, settingsOperations: unavailable, quota: unavailable, tokens: unavailable,
    knowledge: unavailable, resume: unavailable, interview: unavailable, profile: unavailable, personalAgent: unavailable, migration: unavailable, recording: unavailable,
    copilotPrep: unavailable, copilotRealtime: unavailable, voiceprint: unavailable,
  } as unknown as AppDependencies
  const response = await createApp(deps).request('/openapi.json')
  expect(response.status).toBe(200)
  return { baseline, current: await response.json() as Spec }
}

describe('FastAPI to Hono OpenAPI parity', () => {
  test('keeps every legacy HTTP method and path', async () => {
    const { baseline, current } = await loadSpecs()
    const legacy = operations(baseline)
    expect(legacy).toHaveLength(71)
    expect(operations(current)).toEqual(expect.arrayContaining(legacy))
    expect(operations(current)).toContain('POST /api/auth/password')
  })

  test('keeps bearer security, required bodies, and validation responses', async () => {
    const { baseline, current } = await loadSpecs()
    expect(current.components?.securitySchemes?.HTTPBearer).toEqual(baseline.components?.securitySchemes?.HTTPBearer)

    const currentOperations = new Map(operationEntries(current))
    for (const [key, legacy] of operationEntries(baseline)) {
      const migrated = currentOperations.get(key)
      expect(migrated, `${key} is missing`).toBeDefined()
      expect(migrated?.security || [], `${key} security`).toEqual(legacy.security || [])
      expect(Boolean(migrated?.requestBody?.required), `${key} request body required`).toBe(Boolean(legacy.requestBody?.required))
      expect(Boolean(migrated?.responses?.['422']), `${key} 422 response`).toBe(Boolean(legacy.responses?.['422']))
      if (legacy.responses?.['422']) {
        expect(migrated?.responses?.['422']).toMatchObject({
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HTTPValidationError' } } },
        })
      }
    }

    const migrated = operationEntries(baseline).map(([key]) => currentOperations.get(key)!)
    expect(migrated.filter((operation) => operation.security?.length).length).toBe(67)
    expect(migrated.filter((operation) => operation.requestBody?.required).length).toBe(28)
    expect(migrated.filter((operation) => operation.responses?.['422']).length).toBe(51)
  })

  test('documents both Copilot preparation form encodings', async () => {
    const { current } = await loadSpecs()
    const prep = new Map(operationEntries(current)).get('POST /api/copilot/prep')
    expect(Object.keys(prep?.requestBody?.content || {}).sort()).toEqual([
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ])
  })

  test('keeps every generated HTTP operation in the response inventory', async () => {
    const { current } = await loadSpecs()
    expect(inventoryOperations).toEqual(operations(current))
  })
})
