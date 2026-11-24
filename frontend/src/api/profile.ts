import {
  API_BASE,
  apiJson,
  type ApiQueryOptions,
  type ApiRequestBody,
  type ApiResponse,
} from "./client";

export type ProfileResponse = ApiResponse<"/api/profile", "get">;
export type InferTargetRoleResponse = ApiResponse<"/api/profile/infer-target-role", "post">;

export async function getProfile(
  { signal }: ApiQueryOptions = {},
): Promise<ProfileResponse> {
  return apiJson(`${API_BASE}/profile`, { signal });
}

export async function inferTargetRole(
  { signal }: ApiQueryOptions = {},
): Promise<InferTargetRoleResponse> {
  return apiJson(`${API_BASE}/profile/infer-target-role`, {
    signal,
    method: "POST",
  });
}

export async function markProfileViewed(): Promise<
  ApiResponse<"/api/profile/viewed", "post">
> {
  return apiJson(`${API_BASE}/profile/viewed`, { method: "POST" });
}

export async function sendPatternFeedback(
  point: ApiRequestBody<
    "/api/profile/pattern/feedback",
    "post"
  >["point"],
  verdict: ApiRequestBody<
    "/api/profile/pattern/feedback",
    "post"
  >["verdict"]
): Promise<ApiResponse<"/api/profile/pattern/feedback", "post">> {
  return apiJson(`${API_BASE}/profile/pattern/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ point, verdict }),
  });
}

export async function getTopicRetrospective(
  topic: string,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/profile/topic/{topic}/retrospective", "post">> {
  return apiJson(`${API_BASE}/profile/topic/${topic}/retrospective`, {
    signal,
    method: "POST",
  });
}

export async function getTopicHistory(
  topic: string,
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/profile/topic/{topic}/history", "get">> {
  return apiJson(`${API_BASE}/profile/topic/${topic}/history`, { signal });
}
