import {
  API_BASE,
  apiBlob,
  apiJson,
  type ApiQueryOptions,
  type ApiResponse,
} from "./client";

export type ResumeStatusResponse = ApiResponse<"/api/resume/status", "get">;

export async function getResumeStatus(
  { signal }: ApiQueryOptions = {},
): Promise<ResumeStatusResponse> {
  return apiJson(`${API_BASE}/resume/status`, { signal });
}

export async function uploadResume(
  file: File
): Promise<ApiResponse<"/api/resume/upload", "post">> {
  const form = new FormData();
  form.append("file", file);
  return apiJson(`${API_BASE}/resume/upload`, {
    method: "POST",
    body: form,
  });
}

export async function getResumePdfBlob(
  { signal }: ApiQueryOptions = {},
): Promise<Blob> {
  return apiBlob(`${API_BASE}/resume/file`, { signal });
}

export async function deleteUploadedResume(): Promise<
  ApiResponse<"/api/resume", "delete">
> {
  return apiJson(`${API_BASE}/resume`, { method: "DELETE" });
}

export async function parseUploadedResume(): Promise<
  ApiResponse<"/api/resume/parse", "post">
> {
  return apiJson(`${API_BASE}/resume/parse`, { method: "POST" });
}
