import { createContext, useContext, useState, useRef, useCallback } from "react";
import { getTaskStatus } from "../api/interview";

const TaskStatusContext = createContext(null);

const POLL_INTERVAL = 3000;

export function TaskStatusProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const timersRef = useRef({});

  const stopPolling = useCallback((taskId) => {
    if (timersRef.current[taskId]) {
      clearInterval(timersRef.current[taskId]);
      delete timersRef.current[taskId];
    }
  }, []);

  const startTask = useCallback((id, type, label) => {
    stopPolling(id);
    setTasks((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      return [...filtered, { id, type, label, status: "pending" }];
    });

    timersRef.current[id] = setInterval(async () => {
      try {
        const data = await getTaskStatus(id);
        if (data.status === "done" || data.status === "error") {
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, status: data.status, result: data.result } : t))
          );
          stopPolling(id);
        }
      } catch {
        // task not ready or network error, keep polling
      }
    }, POLL_INTERVAL);
  }, [stopPolling]);

  const dismissTask = useCallback((id) => {
    stopPolling(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, [stopPolling]);

  return (
    <TaskStatusContext.Provider value={{ tasks, startTask, dismissTask }}>
      {children}
    </TaskStatusContext.Provider>
  );
}

export function useTaskStatus() {
  return useContext(TaskStatusContext);
}
