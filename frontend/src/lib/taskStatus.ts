import type { ApiResponse } from "../api/client";

export type TaskStatusResponse = ApiResponse<"/api/tasks/{task_id}", "get">;

export interface TaskInfo {
  id: string;
  type: string;
  label: string;
  status: TaskStatusResponse["status"];
  result?: TaskStatusResponse;
}

/** The HTTP result is flat; result is only a UI storage convention. */
export function applyTaskResponse(task: TaskInfo, response: TaskStatusResponse): TaskInfo {
  return { ...task, status: response.status, result: response };
}

export function getTaskNavigationTarget(task: TaskInfo): string {
  const response = task.result;
  if (
    task.type === "retrospective" && response?.status === "done" &&
    response.type === "retrospective" && "topic" in response && typeof response.topic === "string"
  ) {
    return "/profile/topic/" + encodeURIComponent(response.topic);
  }
  return "/review/" + encodeURIComponent(task.id);
}
