import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { formatShortDate } from "./derive";
import { MODE_META } from "./meta";

export function ScoreChart({ history }) {
  if (!history || history.length < 2) return null;

  const W = 920;
  const H = 260;
  const PAD = { top: 20, right: 22, bottom: 36, left: 38 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const points = history.map((entry, index) => ({
    x: PAD.left + (index / (history.length - 1)) * innerW,
    y: PAD.top + innerH - ((entry.avg_score || 0) / 10) * innerH,
    score: entry.avg_score,
    date: entry.date,
    topic: entry.topic || "综合",
    mode: entry.mode,
  }));

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD.top + innerH} L${points[0].x},${PAD.top + innerH} Z`;
  const yLabels = [0, 5, 10];
  const xIndices = history.length <= 6
    ? history.map((_, index) => index)
    : [0, Math.floor(history.length / 2), history.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {yLabels.map((value) => {
        const y = PAD.top + innerH - (value / 10) * innerH;
        return (
          <g key={value}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize={11}>
              {value}
            </text>
          </g>
        );
      })}
      {xIndices.map((index) => (
        <text
          key={index}
          x={points[index].x}
          y={H - 8}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize={11}
        >
          {history[index].date?.slice(5)}
        </text>
      ))}
      <path d={areaPath} fill="url(#profileChartGradient)" opacity={0.26} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--ai-glow)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={index}>
          <circle
            cx={point.x}
            cy={point.y}
            r={4.5}
            fill={(MODE_META[point.mode] || MODE_META.topic_drill).color}
            stroke="var(--card)"
            strokeWidth={2}
          />
          <title>
            {`${point.date} ${(MODE_META[point.mode] || MODE_META.topic_drill).label}${point.topic ? ` · ${point.topic}` : ""}: ${point.score}/10`}
          </title>
        </g>
      ))}
      <defs>
        <linearGradient id="profileChartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ai-glow)" />
          <stop offset="100%" stopColor="var(--ai-glow)" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function SectionHeader({ icon, title, caption, action }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <div className="text-base font-semibold">{title}</div>
          {caption && <div className="mt-0.5 text-sm text-dim">{caption}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function TopicPriorityCard({ item, onSelect, variant = "default", label }) {
  const featured = variant === "featured";

  return (
    <button
      type="button"
      onClick={() => onSelect(item.topic)}
      className={cn(
        "w-full rounded-[24px] border border-primary/15 bg-[linear-gradient(180deg,rgba(245,158,11,0.06),transparent)] text-left transition-all hover:-translate-y-px hover:border-primary/35 hover:shadow-sm dark:bg-[linear-gradient(180deg,rgba(245,158,11,0.08),transparent)]",
        featured ? "p-6 md:p-7" : "p-5"
      )}
    >
      {label && (
        <div className="mb-4 inline-flex rounded-full bg-primary/12 px-3 py-1 text-xs font-medium text-primary">
          {label}
        </div>
      )}

      <div className={cn("gap-4", featured ? "flex flex-col sm:flex-row sm:items-start sm:justify-between" : "flex items-start justify-between")}>
        <div className="min-w-0">
          <div className={cn("break-words font-semibold", featured ? "text-[28px] leading-tight md:text-[32px]" : "text-lg")}>
            {item.topic}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.weakCount > 0 && <Badge variant="destructive">待补 {item.weakCount}</Badge>}
            {item.strongCount > 0 && <Badge variant="success">强项 {item.strongCount}</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-semibold text-primary", featured ? "text-[28px]" : "text-xl")}>
            {item.score != null ? `${item.score}/100` : "--"}
          </div>
          <div className="mt-1 text-xs text-dim">领域掌握度</div>
        </div>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-orange"
          style={{ width: `${item.score != null ? item.score : 0}%` }}
        />
      </div>

      <div className="mt-4 text-sm leading-6 text-dim">
        {item.note || item.topWeakness || "该领域已有训练记录，但还没有生成明确总结。"}
      </div>

      {featured && item.topWeakness && (
        <div className="mt-4 rounded-2xl border border-border/70 bg-card/84 px-4 py-3">
          <div className="text-xs font-medium text-dim">当前先补</div>
          <div className="mt-2 text-sm leading-6">{item.topWeakness}</div>
        </div>
      )}

      <div className={cn("mt-4 flex items-center justify-between gap-3 text-xs text-dim", featured && "flex-wrap")}>
        <span>{item.lastSignal ? `最近信号 ${formatShortDate(item.lastSignal)}` : "已有历史训练记录"}</span>
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          查看领域
          <ChevronRight size={14} />
        </span>
      </div>
    </button>
  );
}

export function CrossBlockerList({ items }) {
  return (
    <div className="space-y-3">
      {items.length > 0 ? items.map((item, index) => (
        <div
          key={`${item.point}-${index}`}
          className="rounded-2xl border border-border/80 bg-black/[0.02] p-4 dark:bg-white/[0.02]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-sm font-semibold leading-6">{item.point}</div>
              <div className="mt-2 text-xs leading-5 text-dim">{item.reason}</div>
            </div>
            {item.topic && <Badge variant="outline">{item.topic}</Badge>}
          </div>
        </div>
      )) : (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-sm text-dim">
          目前没有明显的跨领域阻塞项。
        </div>
      )}
    </div>
  );
}

export function PatternColumn({ title, color, items }) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className={cn("text-xs font-semibold uppercase tracking-wide mb-2", color)}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-dim">
            <span className={cn("mt-2 h-1.5 w-1.5 rounded-full shrink-0", color.replace("text-", "bg-"))} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HabitTagList({ items }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 5);
  const hasMore = items.length > 5;

  if (items.length === 0) {
    return <div className="text-sm text-dim">还没有记录到稳定的表达习惯。</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {visible.map((item, index) => (
          <Badge key={`${item}-${index}`} variant="secondary" className="rounded-full px-3 py-1 text-xs">
            {item}
          </Badge>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-left text-[13px] text-primary hover:underline"
        >
          {expanded ? "收起" : `展开更多 (+${items.length - 5})`}
        </button>
      )}
    </div>
  );
}
