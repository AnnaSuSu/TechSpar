import {
  API_BASE,
  apiJson,
  type ApiRequestBody,
  type ApiResponse,
} from "./client";

export async function transcribeRecording(
  audioBlob: Blob & { name?: string },
  mode: NonNullable<
    ApiRequestBody<
      "/api/recording/transcribe",
      "post",
      "multipart/form-data"
    >["mode"]
  > = "dual"
): Promise<ApiResponse<"/api/recording/transcribe", "post">> {
  const form = new FormData();
  form.append("file", audioBlob, audioBlob.name || "recording.webm");
  form.append("mode", mode);
  return apiJson(`${API_BASE}/recording/transcribe`, {
    method: "POST",
    body: form,
  });
}

export async function analyzeRecording(
  transcript: ApiRequestBody<"/api/recording/analyze", "post">["transcript"],
  recordingMode: NonNullable<
    ApiRequestBody<"/api/recording/analyze", "post">["recording_mode"]
  >,
  company?: ApiRequestBody<"/api/recording/analyze", "post">["company"],
  position?: ApiRequestBody<"/api/recording/analyze", "post">["position"]
): Promise<ApiResponse<"/api/recording/analyze", "post">> {
  const body: ApiRequestBody<"/api/recording/analyze", "post"> = {
    transcript,
    recording_mode: recordingMode,
  };
  if (company) body.company = company;
  if (position) body.position = position;
  return apiJson(`${API_BASE}/recording/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
