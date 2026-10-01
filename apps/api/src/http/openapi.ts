import { z } from 'zod'
import { CopilotServerEventSchema, InterviewStreamEventSchema, IndexRebuildEventSchema } from '@techspar/contracts/events'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { SERVICE_VERSION } from '../version.ts'

type OpenApiOperation = {
  parameters?: unknown[]
  requestBody?: { required?: boolean; [key: string]: unknown }
  responses?: Record<string, unknown>
  security?: Array<Record<string, string[]>>
}

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, unknown>
    [key: string]: unknown
  }
  paths?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head'])
const PUBLIC_OPERATIONS = new Set([
  'GET /api/',
  'GET /api/auth/config',
  'POST /api/auth/login',
  'POST /api/auth/register',
])
const OPTIONAL_BODY_OPERATIONS = new Set(['POST /api/interview/end/{session_id}'])

const VALIDATION_ERROR_SCHEMA = {
  type: 'object',
  title: 'ValidationError',
  properties: {
    loc: { type: 'array', title: 'Location', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
    msg: { type: 'string', title: 'Message' },
    type: { type: 'string', title: 'Error Type' },
    input: { title: 'Input' },
    ctx: { type: 'object', title: 'Context' },
  },
  required: ['loc', 'msg', 'type'],
}

const HTTP_VALIDATION_ERROR_SCHEMA = {
  type: 'object',
  title: 'HTTPValidationError',
  properties: {
    detail: { type: 'array', title: 'Detail', items: { $ref: '#/components/schemas/ValidationError' } },
  },
}

export function completeOpenApiDocument(document: OpenApiDocument): OpenApiDocument {
  const components = document.components ||= {}
  const schemas = components.schemas ||= {}
  const securitySchemes = components.securitySchemes ||= {}
  // Native JSON Schema conversion also works when browser contracts were
  // instantiated before Hono installed its Zod extensions. No registry mutation.
  for (const [name, schema] of Object.entries({ CopilotServerEvent: CopilotServerEventSchema, InterviewStreamEvent: InterviewStreamEventSchema, IndexRebuildEvent: IndexRebuildEventSchema })) {
    schemas[name] = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  }
  schemas.ValidationError = VALIDATION_ERROR_SCHEMA
  schemas.HTTPValidationError = HTTP_VALIDATION_ERROR_SCHEMA
  securitySchemes.HTTPBearer = { type: 'http', scheme: 'bearer' }

  for (const [path, pathItem] of Object.entries(document.paths || {})) {
    for (const [method, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !value || typeof value !== 'object') continue
      const operation = value as OpenApiOperation
      const key = `${method.toUpperCase()} ${path}`
      if (!PUBLIC_OPERATIONS.has(key)) operation.security = [{ HTTPBearer: [] }]
      if (operation.requestBody && !OPTIONAL_BODY_OPERATIONS.has(key)) operation.requestBody.required = true
      if (operation.requestBody || operation.parameters?.length) {
        const responses = operation.responses ||= {}
        responses['422'] = {
          description: 'Validation Error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HTTPValidationError' } } },
        }
      }
    }
  }
  return document
}

export function createOpenApiDocument(app: OpenAPIHono): OpenApiDocument {
  const document = app.getOpenAPIDocument({ openapi: '3.1.0', info: { title: 'TechSpar', version: SERVICE_VERSION } })
  return completeOpenApiDocument(document as unknown as OpenApiDocument)
}
