import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-md bg-secondary/60 relative overflow-hidden",
        className
      )}
      {...props}
    >
      <div 
        className="absolute inset-0 animate-shimmer pointer-events-none bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)]"
        style={{ backgroundSize: "200% 100%" }}
      />
    </div>
  );
}

export { Skeleton }
