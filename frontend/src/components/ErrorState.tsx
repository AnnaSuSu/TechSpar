import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export default function ErrorState({
  title = "加载失败",
  message,
  onRetry,
  retryLabel = "重试",
  action,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <Card className={cn("border-red/25 bg-red/5", className)}>
      <CardContent
        className={cn(
          "flex flex-col items-center justify-center text-center",
          compact ? "px-5 py-8" : "min-h-[220px] px-6 py-12",
        )}
      >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-red/12 text-red">
          <AlertTriangle size={20} />
        </div>
        <h3 className="text-base font-semibold text-text">{title}</h3>
        <p className="mt-1.5 max-w-lg break-words text-sm leading-6 text-dim">
          {message}
        </p>
        {(onRetry || action) && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCw size={14} />
                {retryLabel}
              </Button>
            )}
            {action}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
