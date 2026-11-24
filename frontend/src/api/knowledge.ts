import {
  API_BASE,
  apiJson,
  type ApiQueryOptions,
  type ApiResponse,
} from "./client";

export type CoreKnowledgeResponse = ApiResponse<"/api/knowledge/{topic}/core", "get">;
export type CoreKnowledgeFile = CoreKnowledgeResponse[number];
export type HighFreqResponse = ApiResponse<"/api/knowledge/{topic}/high_freq", "get">;
export type UploadKnowledgeDocResponse = ApiResponse<"/api/knowledge/{topic}/upload", "post">;

export async function getCoreKnowledge(
  topic: string,
  { signal }: ApiQueryOptions = {},
): Promise<CoreKnowledgeResponse> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`, { signal });
}

export async function updateCoreKnowledge(
  topic: string,
  filename: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core/{filename}", "put">> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function deleteCoreKnowledge(
  topic: string,
  filename: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core/{filename}", "delete">> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

export async function createCoreKnowledge(
  topic: string,
  filename: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core", "post">> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
}

export async function uploadKnowledgeDoc(
  topic: string,
  file: File
): Promise<UploadKnowledgeDocResponse> {
  const form = new FormData();
  form.append("file", file);
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/upload`, {
    method: "POST",
    body: form,
  });
}

export async function generateKnowledge(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/generate", "post">> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/generate`, {
    method: "POST",
  });
}

export async function getHighFreq(
  topic: string,
  { signal }: ApiQueryOptions = {},
): Promise<HighFreqResponse> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`, { signal });
}

export async function updateHighFreq(
  topic: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/high_freq", "put">> {
  return apiJson(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
