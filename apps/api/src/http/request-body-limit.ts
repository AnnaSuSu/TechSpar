import { bodyLimit } from 'hono/body-limit'
import type { MiddlewareHandler } from 'hono'

const MB = 1024 * 1024
const JSON_BODY_LIMIT = 1 * MB
const FILE_BODY_LIMIT = 21 * MB
const AUDIO_BODY_LIMIT = 101 * MB
const ARCHIVE_BODY_LIMIT = 501 * MB

export function requestBodyLimit(path: string): MiddlewareHandler {
  let maxSize = JSON_BODY_LIMIT
  if (path === '/api/data/import') maxSize = ARCHIVE_BODY_LIMIT
  else if (['/api/resume/upload', '/api/personal-agent/documents', '/api/voiceprint/enroll'].includes(path)) maxSize = FILE_BODY_LIMIT
  else if (path === '/api/transcribe' || path === '/api/recording/transcribe') maxSize = AUDIO_BODY_LIMIT
  else if (/^\/api\/knowledge\/[^/]+\/upload$/.test(path)) maxSize = FILE_BODY_LIMIT
  return bodyLimit({ maxSize, onError: (c) => c.json({ detail: 'Request body too large' }, 413) })
}
