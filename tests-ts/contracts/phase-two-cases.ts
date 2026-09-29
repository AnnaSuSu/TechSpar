import * as contracts from '@techspar/contracts'
import { responseInventory } from './response-inventory.ts'
import { loadResponseFixture } from './fixture.ts'

export type ResponseCase = {
  operation: string
  service: 'interview' | 'profile'
  useCase: string
  schema: { parse(value: unknown): unknown }
  body?: unknown
}

export const phaseTwoCases: ResponseCase[] = [
  { operation: 'POST /api/job-prep/preview', service: 'interview', useCase: 'previewJob', schema: contracts.JobPrepPreviewResponseSchema, body: { jd_text: '合成测试岗位描述。'.repeat(10) } },
  { operation: 'POST /api/job-prep/start', service: 'interview', useCase: 'startJob', schema: contracts.JobPrepStartResponseSchema, body: { jd_text: '合成测试岗位描述。'.repeat(10) } },
  { operation: 'POST /api/interview/start', service: 'interview', useCase: 'start', schema: contracts.InterviewStartResponseSchema, body: { mode: 'topic_drill', topic: 'typescript' } },
  { operation: 'POST /api/interview/chat', service: 'interview', useCase: 'chat', schema: contracts.InterviewChatResponseSchema, body: { session_id: 'topic-session-1', message: '合成回答' } },
  { operation: 'POST /api/interview/end/{session_id}', service: 'interview', useCase: 'end', schema: contracts.InterviewReviewSubmissionResponseSchema },
  { operation: 'POST /api/interview/draft/{session_id}', service: 'interview', useCase: 'draft', schema: contracts.InterviewDraftResponseSchema, body: { answers: [] } },
  { operation: 'POST /api/interview/review/{session_id}/generate', service: 'interview', useCase: 'generateReview', schema: contracts.InterviewReviewSubmissionResponseSchema },
  { operation: 'GET /api/interview/session/{session_id}/resume', service: 'interview', useCase: 'resume', schema: contracts.InterviewResumeResponseSchema },
  { operation: 'POST /api/interview/reference-answer', service: 'interview', useCase: 'referenceAnswer', schema: contracts.ReferenceAnswerResponseSchema.strict(), body: { session_id: 'topic-session-1', question_id: 1 } },
  { operation: 'GET /api/interview/review/{session_id}', service: 'interview', useCase: 'review', schema: contracts.InterviewSessionResponseSchema },
  { operation: 'GET /api/tasks/{task_id}', service: 'interview', useCase: 'task', schema: contracts.TaskStatusResponseSchema },
  { operation: 'GET /api/interview/history', service: 'interview', useCase: 'history', schema: contracts.InterviewHistoryResponseSchema },
  { operation: 'DELETE /api/interview/session/{session_id}', service: 'interview', useCase: 'delete', schema: contracts.OkSchema.strict() },
  { operation: 'GET /api/interview/topics', service: 'interview', useCase: 'topics', schema: contracts.InterviewTopicsSchema },
  { operation: 'GET /api/profile', service: 'profile', useCase: 'get', schema: contracts.CandidateProfileResponseSchema },
  { operation: 'POST /api/profile/infer-target-role', service: 'profile', useCase: 'inferTargetRole', schema: contracts.TargetRoleSchema.strict() },
  { operation: 'POST /api/profile/viewed', service: 'profile', useCase: 'viewed', schema: contracts.ProfileViewedResponseSchema },
  { operation: 'POST /api/profile/pattern/feedback', service: 'profile', useCase: 'feedback', schema: contracts.ProfilePatternFeedbackResponseSchema, body: { point: '缺少边界讨论', verdict: 'accurate' } },
  { operation: 'GET /api/profile/due-reviews', service: 'profile', useCase: 'dueReviews', schema: contracts.ProfileDueReviewsResponseSchema },
  { operation: 'GET /api/profile/topic/{topic}/history', service: 'profile', useCase: 'topicHistory', schema: contracts.ProfileTopicHistoryResponseSchema },
  { operation: 'POST /api/profile/topic/{topic}/retrospective', service: 'profile', useCase: 'retrospective', schema: contracts.RetrospectiveTaskSchema.strict() },
]

export function caseRequest(entry: ResponseCase): { path: string; method: string } {
  const [method, path] = entry.operation.split(' ') as [string, string]
  return { method, path: path.replace('{session_id}', 'topic-session-1').replace('{task_id}', 'task-1').replace('{topic}', 'typescript') }
}

export async function caseFixture(entry: ResponseCase): Promise<unknown> {
  const fixture = responseInventory.find((item) => item.operation === entry.operation)?.fixture
  if (!fixture) throw new Error('Missing fixture for ' + entry.operation)
  return loadResponseFixture(fixture)
}
