import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-lg bg-secondary/70", className)}
      {...props}
    >
      <div
        className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)]"
        style={{ backgroundSize: "200% 100%" }}
      />
    </div>
  );
}

export { Skeleton };
