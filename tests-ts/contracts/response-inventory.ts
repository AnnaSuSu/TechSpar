export type ResponseTransport = 'json' | 'binary' | 'sse' | 'websocket'

export type ResponseInventoryEntry = {
  operation: string
  routeFile: string
  status: number
  contentType: string
  transport: ResponseTransport
  fixture?: string
  dynamic: boolean
  responseSchema?: string
  requiredKeys?: readonly string[]
  nullableKeys?: readonly string[]
  notes?: string
}

/**
 * Current response facts. This is intentionally separate from contracts/src:
 * Phase one captured behavior; phase two names the scoped DTOs. Compatibility
 * slots remain explicit in notes even when the root is no longer dynamic.
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
  { operation: 'POST /api/settings/rebuild-index', routeFile: 'apps/api/src/routes/settings.ts', status: 200, contentType: 'text/event-stream', transport: 'sse', fixture: 'sse/rebuild-index-stream.txt', dynamic: false, responseSchema: 'IndexRebuildEventSchema', notes: 'Validated JSON data frames; step errors are nonterminal.' },
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
  { operation: 'POST /api/job-prep/preview', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-job-preview.json', dynamic: false, responseSchema: 'JobPrepPreviewResponseSchema', notes: 'question_blueprint elements remain provider-owned until phase four.' },
  { operation: 'POST /api/job-prep/start', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-start-jd.json', dynamic: false, responseSchema: 'JobPrepStartResponseSchema', notes: 'preview and meta.preview preserve caller-supplied preview_data; question extensions are retained.' },
  { operation: 'POST /api/interview/start', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-start-topic.json', dynamic: false, responseSchema: 'InterviewStartResponseSchema', notes: 'Mode-specific DTO; resume topic can be omitted or null; question extensions are retained.' },
  { operation: 'POST /api/interview/chat', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-chat.json', dynamic: false, responseSchema: 'InterviewChatResponseSchema' },
  { operation: 'POST /api/interview/chat/stream', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'text/event-stream', transport: 'sse', fixture: 'sse/interview-chat-stream.txt', dynamic: false, responseSchema: 'InterviewStreamEventSchema', notes: 'Validated token/done/error frames; completion follows persistence.' },
  { operation: 'POST /api/interview/end/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-end-pending.json', dynamic: false, responseSchema: 'InterviewReviewSubmissionResponseSchema' },
  { operation: 'POST /api/interview/draft/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-draft.json', dynamic: false, responseSchema: 'InterviewDraftResponseSchema' },
  { operation: 'POST /api/interview/review/{session_id}/generate', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-review-pending.json', dynamic: false, responseSchema: 'InterviewReviewSubmissionResponseSchema' },
  { operation: 'GET /api/interview/session/{session_id}/resume', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-resume.json', dynamic: false, responseSchema: 'InterviewResumeResponseSchema', notes: 'Persisted meta and message/question extensions are preserved.' },
  { operation: 'POST /api/interview/reference-answer', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'reference-answer.json', dynamic: false, responseSchema: 'ReferenceAnswerResponseSchema' },
  { operation: 'GET /api/interview/review/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-review.json', dynamic: false, responseSchema: 'InterviewSessionResponseSchema', notes: 'Full session; raw review content/meta and legacy JSON extensions are preserved.' },
  { operation: 'GET /api/tasks/{task_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'task-pending.json', dynamic: false, responseSchema: 'TaskStatusResponseSchema', notes: 'Flat results; known done payloads validated; reviewed sessions may omit session_id. Retry payloads and unknown task types remain compatible.' },
  { operation: 'GET /api/interview/history', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-history.json', dynamic: false, responseSchema: 'InterviewHistoryResponseSchema', notes: 'Summary projection excludes source_transcript; other meta remains compatible.' },
  { operation: 'DELETE /api/interview/session/{session_id}', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'ok.json', dynamic: false, responseSchema: 'OkSchema' },
  { operation: 'GET /api/interview/topics', routeFile: 'apps/api/src/routes/interview.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'interview-topics.json', dynamic: false, responseSchema: 'InterviewTopicsSchema' },
  { operation: 'GET /api/profile', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'profile.json', dynamic: false, responseSchema: 'CandidateProfileResponseSchema', notes: 'Named required fields with explicit stored extension/cache compatibility; due_reviews contains summaries.' },
  { operation: 'POST /api/profile/infer-target-role', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'target-role.json', dynamic: false, responseSchema: 'TargetRoleSchema' },
  { operation: 'POST /api/profile/viewed', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'profile-viewed.json', dynamic: false, responseSchema: 'ProfileViewedResponseSchema', requiredKeys: ['at', 'total_sessions', 'topic_scores'] },
  { operation: 'POST /api/profile/pattern/feedback', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'profile-feedback.json', dynamic: false, responseSchema: 'ProfilePatternFeedbackResponseSchema', notes: 'Returns the complete updated weak point, preserving stored extensions.' },
  { operation: 'GET /api/profile/due-reviews', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'due-reviews.json', dynamic: false, responseSchema: 'ProfileDueReviewsResponseSchema', notes: 'Full weak points, including predicted items without sr.' },
  { operation: 'GET /api/profile/topic/{topic}/history', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'topic-history.json', dynamic: false, responseSchema: 'ProfileTopicHistoryResponseSchema', notes: 'Full InterviewSession array, not profile objects or session summaries.' },
  { operation: 'POST /api/profile/topic/{topic}/retrospective', routeFile: 'apps/api/src/routes/profile.ts', status: 200, contentType: 'application/json', transport: 'json', fixture: 'retrospective-pending.json', dynamic: false, responseSchema: 'RetrospectiveTaskSchema' },
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
  { operation: 'WS /ws/copilot/{session_id}', routeFile: 'apps/api/src/routes/copilot.ts', status: 101, contentType: 'application/json', transport: 'websocket', fixture: 'copilot/events.json', dynamic: false, responseSchema: 'CopilotServerEventSchema', notes: '13 validated event branches; model update fields remain optional and retain extensions until phase four. WebSocket is documented as a component, not an HTTP operation.' },
]

export const inventoryOperations = responseInventory
  .filter((entry) => entry.transport !== 'websocket')
  .map((entry) => entry.operation)
  .sort()
