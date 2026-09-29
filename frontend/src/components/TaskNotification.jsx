import { getTaskNavigationTarget } from "../lib/taskStatus";
import { useNavigate } from "react-router-dom";
import { X, Loader2, FileText, AlertCircle } from "lucide-react";
import useTaskStatus from "../hooks/useTaskStatus";

export default function TaskNotification() {
  const { tasks, dismissTask } = useTaskStatus();
  const navigate = useNavigate();

  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg min-w-[240px] animate-fade-in-up"
        >
          {task.status === "pending" && (
            <>
              <Loader2 size={18} className="animate-spin text-primary shrink-0" />
              <span className="text-[14px] text-foreground">{task.label}...</span>
            </>
          )}

          {task.status === "done" && (
            <>
              <FileText size={18} className="text-primary shrink-0" />
              <button
                className="text-[14px] text-primary font-medium hover:underline cursor-pointer"
                onClick={() => {
                  navigate(getTaskNavigationTarget(task));
                  dismissTask(task.id);
                }}
              >
                {task.label}完成，点击查看
              </button>
            </>
          )}

          {task.status === "error" && (
            <>
              <AlertCircle size={18} className="text-destructive shrink-0" />
              <span className="text-[14px] text-destructive">{task.label}失败</span>
            </>
          )}

          <button
            onClick={() => dismissTask(task.id)}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
