export type ResponseTransport = 'json' | 'binary' | 'sse' | 'websocket'

export type ResponseInventoryEntry = {
  operation: string
  routeFile: string
  status: number
  contentType: string
  transport: ResponseTransport
  fixture?: string
  dynamic: boolean
  requiredKeys?: readonly string[]
  nullableKeys?: readonly string[]
  notes?: string
}

/**
 * Current response facts. This is intentionally separate from contracts/src:
 * phase one records behavior before phase two introduces strict DTO schemas.
 */
export const responseInventory: readonly ResponseInventoryEntry[] = [
  { operation: 'GET /api/', routeFile: 'apps/api/src/routes/auth.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'service-info.json', dynamic: false, requiredKeys: ['service', 'version'] },
  { operation: 'POST /api/auth/password', routeFile: 'apps/api/src/routes/auth.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'change-password.json', dynamic: false, requiredKeys: ['status'] },
  { operation: 'GET /api/auth/config', routeFile: 'apps/api/src/routes/auth.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'auth-config.json', dynamic: false, requiredKeys: ['allow_registration'] },
  { operation: 'POST /api/auth/login', routeFile: 'apps/api/src/routes/auth.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'auth-response.json', dynamic: false, requiredKeys: ['token', 'user'] },
  { operation: 'POST /api/auth/register', routeFile: 'apps/api/src/routes/auth.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'auth-response.json', dynamic: false, requiredKeys: ['token', 'user'] },
  { operation: 'GET /api/settings', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'settings-view.json', dynamic: false },
  { operation: 'PUT /api/settings', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'settings-update.json', dynamic: false, requiredKeys: ['ok', 'embedding_changed'] },
  { operation: 'GET /api/usage/quota', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'quota-status.json', dynamic: false },
  { operation: 'POST /api/settings/test-llm', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'settings-probe.json', dynamic: false },
  { operation: 'POST /api/settings/test-embedding', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'settings-probe.json', dynamic: false },
  { operation: 'POST /api/settings/rebuild-index', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'text/event-stream', transport: 'sse', fixture: 'sse/rebuild-index-stream.txt', dynamic: true },
  { operation: 'GET /api/topics', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'topics.json', dynamic: false },
  { operation: 'POST /api/topics', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'topic-created.json', dynamic: false },
  { operation: 'DELETE /api/topics/{key}', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'GET /api/knowledge/{topic}/core', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'knowledge-files.json', dynamic: false },
  { operation: 'POST /api/knowledge/{topic}/core', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'knowledge-created.json', dynamic: false },
  { operation: 'PUT /api/knowledge/{topic}/core/{filename}', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'DELETE /api/knowledge/{topic}/core/{filename}', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'POST /api/knowledge/{topic}/upload', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'knowledge-created.json', dynamic: false },
  { operation: 'POST /api/knowledge/{topic}/generate', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'knowledge-generated.json', dynamic: false },
  { operation: 'GET /api/knowledge/{topic}/high_freq', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'knowledge-content.json', dynamic: false },
  { operation: 'PUT /api/knowledge/{topic}/high_freq', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'GET /api/graph/{topic}', routeFile: 'apps/api/src/routes/knowledge.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'question-graph.json', dynamic: true },
  { operation: 'GET /api/resume/status', routeFile: 'apps/api/src/routes/resume.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'resume-status-empty.json', dynamic: false },
  { operation: 'GET /api/resume/file', routeFile: 'apps/api/src/routes/resume.ts', status: 200, contentType: 'application/pdf', transport: 'binary', dynamic: false },
  { operation: 'DELETE /api/resume', routeFile: 'apps/api/src/routes/resume.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'POST /api/resume/parse', routeFile: 'apps/api/src/routes/resume.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'resume-parsed.json', dynamic: true },
  { operation: 'POST /api/resume/upload', routeFile: 'apps/api/src/routes/resume.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'resume-uploaded.json', dynamic: false },
  { operation: 'POST /api/transcribe', routeFile: 'apps/api/src/routes/resume.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'transcription.json', dynamic: false },
  { operation: 'POST /api/job-prep/preview', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-job-preview.json', dynamic: true },
  { operation: 'POST /api/job-prep/start', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-start-jd.json', dynamic: true },
  { operation: 'POST /api/interview/start', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-start-topic.json', dynamic: true },
  { operation: 'POST /api/interview/chat', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-chat.json', dynamic: true },
  { operation: 'POST /api/interview/chat/stream', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'text/event-stream', transport: 'sse', fixture: 'sse/interview-chat-stream.txt', dynamic: true },
  { operation: 'POST /api/interview/end/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-end-pending.json', dynamic: true },
  { operation: 'POST /api/interview/draft/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-draft.json', dynamic: true },
  { operation: 'POST /api/interview/review/{session_id}/generate', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-review-pending.json', dynamic: true },
  { operation: 'GET /api/interview/session/{session_id}/resume', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-resume.json', dynamic: true },
  { operation: 'POST /api/interview/reference-answer', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'reference-answer.json', dynamic: false },
  { operation: 'GET /api/interview/review/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-review.json', dynamic: true },
  { operation: 'GET /api/tasks/{task_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'task-pending.json', dynamic: false },
  { operation: 'GET /api/interview/history', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-history.json', dynamic: true },
  { operation: 'DELETE /api/interview/session/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'GET /api/interview/topics', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-topics.json', dynamic: false },
  { operation: 'GET /api/profile', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'profile.json', dynamic: true },
  { operation: 'POST /api/profile/infer-target-role', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'target-role.json', dynamic: false },
  { operation: 'POST /api/profile/viewed', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'profile.json', dynamic: true },
  { operation: 'POST /api/profile/pattern/feedback', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'profile-feedback.json', dynamic: true },
  { operation: 'GET /api/profile/due-reviews', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'due-reviews.json', dynamic: true },
  { operation: 'GET /api/profile/topic/{topic}/history', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'topic-history.json', dynamic: true },
  { operation: 'POST /api/profile/topic/{topic}/retrospective', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'retrospective-pending.json', dynamic: false },
  { operation: 'GET /api/personal-agent/documents', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'personal-documents.json', dynamic: true },
  { operation: 'POST /api/personal-agent/documents', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'personal-document.json', dynamic: true },
  { operation: 'DELETE /api/personal-agent/documents/{document_id}', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'GET /api/personal-agent/conversations', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'personal-conversations.json', dynamic: true },
  { operation: 'GET /api/personal-agent/conversations/{conversation_id}', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'personal-conversation.json', dynamic: true },
  { operation: 'DELETE /api/personal-agent/conversations/{conversation_id}', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'POST /api/personal-agent/chat', routeFile: 'apps/api/src/routes/personal-agent.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'personal-agent-chat.json', dynamic: false },
  { operation: 'POST /api/recording/transcribe', routeFile: 'apps/api/src/routes/recording.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'recording-transcription.json', dynamic: false },
  { operation: 'POST /api/recording/analyze', routeFile: 'apps/api/src/routes/recording.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'recording-analyze-pending.json', dynamic: false },
  { operation: 'GET /api/data/export', routeFile: 'apps/api/src/routes/data-migration.ts', status: 200, contentType: 'application/gzip', transport: 'binary', dynamic: false },
  { operation: 'GET /api/data/export/personal', routeFile: 'apps/api/src/routes/data-migration.ts', status: 200, contentType: 'application/gzip', transport: 'binary', dynamic: false },
  { operation: 'POST /api/data/import', routeFile: 'apps/api/src/routes/data-migration.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'data-import.json', dynamic: true },
  { operation: 'POST /api/copilot/prep', routeFile: 'apps/api/src/routes/copilot.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'copilot-prep-created.json', dynamic: false },
  { operation: 'GET /api/copilot/preps', routeFile: 'apps/api/src/routes/copilot.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'copilot-preps.json', dynamic: false },
  { operation: 'GET /api/copilot/prep/{prep_id}', routeFile: 'apps/api/src/routes/copilot.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'copilot-prep-status.json', dynamic: true },
  { operation: 'GET /api/copilot/prep/{prep_id}/tree', routeFile: 'apps/api/src/routes/copilot.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'copilot-tree.json', dynamic: true },
  { operation: 'DELETE /api/copilot/prep/{prep_id}', routeFile: 'apps/api/src/routes/copilot.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'GET /api/voiceprint/status', routeFile: 'apps/api/src/routes/voiceprint.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'voiceprint-status.json', dynamic: false },
  { operation: 'PUT /api/voiceprint/credentials', routeFile: 'apps/api/src/routes/voiceprint.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'POST /api/voiceprint/enroll', routeFile: 'apps/api/src/routes/voiceprint.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'voiceprint-enrolled.json', dynamic: false },
  { operation: 'DELETE /api/voiceprint/enroll', routeFile: 'apps/api/src/routes/voiceprint.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false },
  { operation: 'WS /ws/copilot/{session_id}', routeFile: 'apps/api/src/routes/copilot.ts', status: 101, contentType: 'application/json', transport: 'websocket', fixture: 'copilot/events.json', dynamic: true, notes: 'WebSocket is not represented as an OpenAPI HTTP operation.' },
]

export const inventoryOperations = responseInventory
  .filter((entry) => entry.transport !== 'websocket')
  .map((entry) => entry.operation)
  .sort()
