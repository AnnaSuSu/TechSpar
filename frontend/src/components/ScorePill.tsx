import { Badge } from "@/components/ui/badge";
import { getScoreToneClass } from "@/lib/scoreTone";
import { cn } from "@/lib/utils";

export type ScorePillSize = "compact" | "default" | "large";

export interface ScorePillProps {
  score?: number | null;
  size?: ScorePillSize;
  emptyLabel?: string;
  className?: string;
}

const SIZE_CLASSES: Record<ScorePillSize, string> = {
  compact: "px-2 py-0.5 text-[11px]",
  default: "min-w-[52px] px-2.5 py-0.5 text-xs",
  large: "min-w-[64px] px-3 py-1 text-sm",
};

export default function ScorePill({
  score,
  size = "default",
  emptyLabel = "未评分",
  className,
}: ScorePillProps) {
  if (score == null || Number.isNaN(score)) {
    return (
      <Badge
        variant="secondary"
        className={cn("justify-center rounded-full font-medium tabular-nums", SIZE_CLASSES[size], className)}
      >
        {emptyLabel}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "justify-center rounded-full font-semibold tabular-nums",
        SIZE_CLASSES[size],
        getScoreToneClass(score),
        className,
      )}
    >
      {score}/10
    </Badge>
  );
}
