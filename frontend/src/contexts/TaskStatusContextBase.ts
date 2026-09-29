import { createContext } from "react";
import type { TaskInfo } from "../lib/taskStatus";
export type { TaskInfo } from "../lib/taskStatus";

export interface TaskStatusContextValue {
  tasks: TaskInfo[];
  startTask: (id: string, type: string, label: string) => void;
  dismissTask: (id: string) => void;
  creatingSessionMode: string | null;
  setCreatingSessionMode: (mode: string | null) => void;
}

const TaskStatusContext = createContext<TaskStatusContextValue | null>(null);

export default TaskStatusContext;
