import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HintChipProps {
  title: string;
  description: string;
  className?: string;
}

export function HintChip({ title, description, className }: HintChipProps) {
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-background/72 px-3.5 py-3", className)}>
      <div className="text-sm font-semibold text-text">{title}</div>
      <div className="mt-1 text-[13px] leading-6 text-dim">{description}</div>
    </div>
  );
}

export interface StepRowProps {
  index: string;
  title: string;
  description: string;
  done?: boolean;
  active?: boolean;
  loading?: boolean;
}

export function StepRow({
  index,
  title,
  description,
  done = false,
  active = false,
  loading = false,
}: StepRowProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3.5 py-3",
        done
          ? "border-green/20 bg-green/8"
          : active
            ? "border-primary/25 bg-primary/6"
            : "border-border/75 bg-card/72",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            done
              ? "bg-green/15 text-green"
              : active
                ? "bg-primary/12 text-primary"
                : "bg-hover text-dim",
          )}
        >
          {done ? <CheckCircle2 size={14} /> : loading ? <Loader2 size={14} className="animate-spin" /> : index}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{title}</div>
          <div className="mt-1 text-[13px] leading-6 text-dim">{description}</div>
        </div>
      </div>
    </div>
  );
}
