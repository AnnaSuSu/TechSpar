import {
  API_BASE,
  apiJson,
  type ApiQueryOptions,
  type ApiResponse,
} from "./client";

export type TopicsResponse = ApiResponse<"/api/topics", "get">;
export type TopicInfo = TopicsResponse[string];
export type CreateTopicResponse = ApiResponse<"/api/topics", "post">;

export async function getTopics(
  { signal }: ApiQueryOptions = {},
): Promise<TopicsResponse> {
  return apiJson(`${API_BASE}/topics`, { signal });
}

export async function createTopic(
  name: string,
  icon = "📝"
): Promise<CreateTopicResponse> {
  return apiJson(`${API_BASE}/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon }),
  });
}

export async function deleteTopic(
  key: string
): Promise<ApiResponse<"/api/topics/{key}", "delete">> {
  return apiJson(`${API_BASE}/topics/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

export async function getInterviewTopics(
  { signal }: ApiQueryOptions = {},
): Promise<ApiResponse<"/api/interview/topics", "get">> {
  return apiJson(`${API_BASE}/interview/topics`, { signal });
}
