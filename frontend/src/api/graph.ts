import {
  API_BASE,
  apiJson,
  type ApiQueryOptions,
  type ApiResponse,
} from "./client";

export type GraphResponse = ApiResponse<"/api/graph/{topic}", "get">;

export async function getGraphData(
  topic: string,
  { signal }: ApiQueryOptions = {},
): Promise<GraphResponse> {
  return apiJson(`${API_BASE}/graph/${topic}`, { signal });
}
