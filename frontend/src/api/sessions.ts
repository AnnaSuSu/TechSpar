import {
  API_BASE,
  apiJson,
  authFetch,
  readErrorMessage,
  type ApiQueryOptions,
  type ApiRequestBody,
  type ApiResponse,
} from "./client";
import { consumeInterviewStream, type ChatStreamCallbacks } from "./events";

export type StartInterviewResponse = ApiResponse<"/api/interview/start", "post">;
export type InterviewHistoryResponse = ApiResponse<"/api/interview/history", "get">;
export type InterviewHistoryItem = InterviewHistoryResponse["items"][number];

type StartInterviewBody = ApiRequestBody<"/api/interview/start", "post">;
type InterviewMode = StartInterviewBody["mode"];
type JobPrepPreviewBody = ApiRequestBody<"/api/job-prep/preview", "post">;
type JobPrepStartBody = ApiRequestBody<"/api/job-prep/start", "post">;
type EndInterviewBody = ApiRequestBody<
  "/api/interview/end/{session_id}",
  "post"
>;
type DraftInterviewBody = ApiRequestBody<
  "/api/interview/draft/{session_id}",
  "post"
>;
type InterviewAnswers = NonNullable<EndInterviewBody["answers"]>;

interface StartInterviewOptions {
  numQuestions?: StartInterviewBody["num_questions"];
  divergence?: StartInterviewBody["divergence"];
  targetRole?: StartInterviewBody["target_role"];
  jobDescription?: StartInterviewBody["job_description"];
}

export async function transcribeAudio(
  audioBlob: Blob,
  signal?: AbortSignal,
): Promise<ApiResponse<"/api/transcribe", "post">> {
  const form = new FormData();
  const extension = audioBlob.type.startsWith("audio/ogg") ? "ogg"
    : audioBlob.type.startsWith("audio/mp4") ? "m4a" : "webm";
  form.append("file", audioBlob, `recording.${extension}`);
  return apiJson(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
    signal,
  });
}

export async function startInterview(
  mode: InterviewMode,
  topic: StartInterviewBody["topic"] = null,
  { numQuestions, divergence, targetRole, jobDescription }: StartInterviewOptions = {}
): Promise<StartInterviewResponse> {
  const body: StartInterviewBody = { mode, topic };
  if (numQuestions != null) body.num_questions = numQuestions;
  if (divergence != null) body.divergence = divergence;
  if (targetRole != null) body.target_role = targetRole;
  if (jobDescription != null) body.job_description = jobDescription;
  return apiJson(`${API_BASE}/interview/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function previewJobPrep(
  payload: JobPrepPreviewBody,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/job-prep/preview", "post">> {
  return apiJson(`${API_BASE}/job-prep/preview`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function startJobPrep(
  payload: JobPrepStartBody
): Promise<ApiResponse<"/api/job-prep/start", "post">> {
  return apiJson(`${API_BASE}/job-prep/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<ApiResponse<"/api/interview/chat", "post">> {
  return apiJson(`${API_BASE}/interview/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
}

export async function sendMessageStream(
  sessionId: string,
  message: string,
  { onToken, onDone, onError }: ChatStreamCallbacks
): Promise<void> {
  const res = await authFetch(`${API_BASE}/interview/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));

  await consumeInterviewStream(res, { onToken, onDone, onError });
}

export async function endInterview(
  sessionId: string,
  answers: InterviewAnswers | null = null
): Promise<ApiResponse<"/api/interview/end/{session_id}", "post">> {
  const options: RequestInit = { method: "POST" };
  if (answers) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ answers });
  }
  return apiJson(`${API_BASE}/interview/end/${sessionId}`, options);
}

export async function saveDraftAnswers(
  sessionId: string,
  answers: NonNullable<DraftInterviewBody["answers"]>
): Promise<ApiResponse<"/api/interview/draft/{session_id}", "post">> {
  return apiJson(`${API_BASE}/interview/draft/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

export async function getReview(
  sessionId: string,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/interview/review/{session_id}", "get">> {
  return apiJson(`${API_BASE}/interview/review/${sessionId}`, { signal });
}

export async function retryReview(
  sessionId: string
): Promise<ApiResponse<"/api/interview/review/{session_id}/generate", "post">> {
  return apiJson(`${API_BASE}/interview/review/${sessionId}/generate`, {
    method: "POST",
  });
}

export async function getResumableSession(
  sessionId: string,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/interview/session/{session_id}/resume", "get">> {
  return apiJson(`${API_BASE}/interview/session/${sessionId}/resume`, { signal });
}

export async function getTaskStatus(
  taskId: string,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/tasks/{task_id}", "get">> {
  return apiJson(`${API_BASE}/tasks/${taskId}`, { signal });
}

export async function getReferenceAnswer(
  sessionId: string,
  questionId: ApiRequestBody<
    "/api/interview/reference-answer",
    "post"
  >["question_id"],
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/interview/reference-answer", "post">> {
  return apiJson(`${API_BASE}/interview/reference-answer`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, question_id: questionId }),
  });
}

export async function getHistory(
  limit = 20,
  offset = 0,
  mode: InterviewMode | null = null,
  topic: string | null = null,
  { signal }: ApiQueryOptions = {},
): Promise<InterviewHistoryResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (mode) params.set("mode", mode);
  if (topic) params.set("topic", topic);
  return apiJson(`${API_BASE}/interview/history?${params}`, { signal });
}

export async function deleteSession(
  sessionId: string
): Promise<ApiResponse<"/api/interview/session/{session_id}", "delete">> {
  return apiJson(`${API_BASE}/interview/session/${sessionId}`, {
    method: "DELETE",
  });
}
