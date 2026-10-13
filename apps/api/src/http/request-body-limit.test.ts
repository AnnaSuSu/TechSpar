import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { requestBodyLimit } from './request-body-limit.ts'

test('request body limit rejects oversized JSON before the route handler', async () => {
  const app = new Hono()
  app.use('/api/*', (c, next) => requestBodyLimit(c.req.path)(c, next))
  app.post('/api/auth/login', (c) => c.text('handled'))
  const response = await app.request('/api/auth/login', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })
  expect(response.status).toBe(413)
})

test('upload routes receive route-specific size limits', async () => {
  const app = new Hono()
  app.use('/api/*', (c, next) => requestBodyLimit(c.req.path)(c, next))
  app.post('/api/data/import', (c) => c.text('handled'))
  const response = await app.request('/api/data/import', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })
  expect(response.status).toBe(200)
})
