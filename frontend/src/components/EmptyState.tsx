import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("border-dashed border-border/80 bg-card/50", className)}>
      <CardContent
        className={cn(
          "flex flex-col items-center justify-center text-center",
          compact ? "px-5 py-10" : "min-h-[240px] px-6 py-12",
        )}
      >
        {icon && (
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {icon}
          </div>
        )}
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {description && (
          <p className="mt-2 max-w-md text-sm leading-6 text-dim">{description}</p>
        )}
        {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
