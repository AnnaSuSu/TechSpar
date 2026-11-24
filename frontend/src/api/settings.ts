import {
  API_BASE,
  apiJson,
  authFetch,
  readErrorMessage,
  type ApiQueryOptions,
  type ApiRequestBody,
  type ApiResponse,
} from "./client";
import { consumeIndexRebuildStream, type RebuildIndexCallbacks } from "./events";

export type SettingsResponse = ApiResponse<"/api/settings", "get">;
export type ChangePasswordResponse = ApiResponse<"/api/auth/password", "post">;

type LLMConnectionPayload = ApiRequestBody<"/api/settings/test-llm", "post">;

export async function getSettings(
  { signal }: ApiQueryOptions = {},
): Promise<SettingsResponse> {
  return apiJson(`${API_BASE}/settings`, { signal });
}

export async function updateSettings(
  payload: ApiRequestBody<"/api/settings", "put">
): Promise<ApiResponse<"/api/settings", "put">> {
  return apiJson(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function testLLMConnection(
  payload: LLMConnectionPayload,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/settings/test-llm", "post">> {
  return apiJson(`${API_BASE}/settings/test-llm`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function testEmbeddingConnection(
  payload: ApiRequestBody<"/api/settings/test-embedding", "post">,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/settings/test-embedding", "post">> {
  return apiJson(`${API_BASE}/settings/test-embedding`, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function rebuildEmbeddingIndex({
  onProgress,
  onDone,
  onError,
}: RebuildIndexCallbacks = {}): Promise<void> {
  const res = await authFetch(`${API_BASE}/settings/rebuild-index`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));

  await consumeIndexRebuildStream(res, { onProgress, onDone, onError });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResponse> {
  const body: ApiRequestBody<"/api/auth/password", "post"> = {
    current_password: currentPassword,
    new_password: newPassword,
  };
  return apiJson(`${API_BASE}/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
