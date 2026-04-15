import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Brain,
  ChevronRight,
  Clock3,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { getProfile, getTopics } from "../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const MODE_META = {
  resume: { color: "var(--ai-glow)", label: "简历面试" },
  topic_drill: { color: "var(--success)", label: "专项训练" },
  jd_prep: { color: "#60a5fa", label: "JD 备面" },
  recording: { color: "#22d3ee", label: "录音复盘" },
};

const ZONE_META = {
  focus: {
    title: "补课区",
    description: "优先补会反复拉低上限的问题",
    panelClassName: "border-primary/20 bg-primary/6 dark:bg-primary/8",
    accentClassName: "text-primary",
    pillClassName: "bg-primary/12 text-primary",
    progressClassName: "from-primary to-orange",
    empty: "目前没有明显的低分区。",
  },
  build: {
    title: "过渡区",
    description: "已经有框架，下一步补深度和稳定性",
    panelClassName: "border-info/20 bg-info/6 dark:bg-info/8",
    accentClassName: "text-info",
    pillClassName: "bg-info/12 text-info",
    progressClassName: "from-info to-teal",
    empty: "还没有进入过渡区的主题。",
  },
  strong: {
    title: "优势区",
    description: "可以继续放大，作为面试里的稳定得分点",
    panelClassName: "border-green/20 bg-green/6 dark:bg-green/8",
    accentClassName: "text-green",
    pillClassName: "bg-green/12 text-green",
    progressClassName: "from-green to-teal",
    empty: "还没有形成足够稳定的优势区。",
  },
};

const TRAINING_MODE_META = {
  resume: {
    label: "简历面试",
    accentClassName: "text-primary",
    borderClassName: "border-l-primary",
    glowClassName: "shadow-[inset_3px_0_0_rgba(245,158,11,0.18)]",
    countKey: "resume_sessions",
    avgKey: "resume_avg_score",
  },
  topic_drill: {
    label: "专项训练",
    accentClassName: "text-green",
    borderClassName: "border-l-green",
    glowClassName: "shadow-[inset_3px_0_0_rgba(34,197,94,0.18)]",
    countKey: "drill_sessions",
    avgKey: "drill_avg_score",
  },
  jd_prep: {
    label: "JD 备面",
    accentClassName: "text-blue-400",
    borderClassName: "border-l-blue-400",
    glowClassName: "shadow-[inset_3px_0_0_rgba(96,165,250,0.18)]",
    countKey: "job_prep_sessions",
    avgKey: "job_prep_avg_score",
  },
};

const PAGE_CLASS = "flex-1 w-full max-w-[1600px] mx-auto px-4 py-6 md:px-7 md:py-8 xl:px-10 2xl:px-12";

function CollapsibleList({ items, limit, renderItem }) {
  const [expanded, setExpanded] = useState(false);
  const show = expanded ? items : items.slice(0, limit);
  const hasMore = items.length > limit;

  return (
    <div className="flex flex-col gap-2">
      {show.map((item, index) => renderItem(item, index))}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-primary text-[13px] cursor-pointer py-1 text-left hover:underline"
        >
          {expanded ? "收起" : `展开更多 (+${items.length - limit})`}
        </button>
      )}
    </div>
  );
}

function ScoreChart({ history }) {
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

function SectionHeader({ icon, title, caption, action }) {
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

// Stats components have been refactored into inline elements for a unified dashboard layout

function TopicPriorityCard({ item, onSelect, variant = "default", label }) {
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

function CrossBlockerList({ items }) {
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

const ZONE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "focus", label: "补课区" },
  { key: "build", label: "过渡区" },
  { key: "strong", label: "优势区" },
];

function DomainTable({ items, onSelect }) {
  const [zoneFilter, setZoneFilter] = useState("all");

  const filtered = zoneFilter === "all" ? items : items.filter((item) => item.zone === zoneFilter);
  const zoneCounts = { focus: 0, build: 0, strong: 0 };
  items.forEach((item) => { if (zoneCounts[item.zone] != null) zoneCounts[item.zone]++; });

  const dotColor = { focus: "bg-primary", build: "bg-info", strong: "bg-green" };
  const scoreColor = { focus: "text-primary", build: "text-info", strong: "text-green" };
  const barGradient = { focus: "from-primary to-orange", build: "from-info to-teal", strong: "from-green to-teal" };

  return (
    <div className="mt-5 space-y-3">
      {/* Zone filter chips */}
      <div className="flex flex-wrap gap-2">
        {ZONE_FILTERS.map(({ key, label }) => {
          const active = zoneFilter === key;
          const count = key === "all" ? items.length : zoneCounts[key];
          return (
            <button
              key={key}
              onClick={() => setZoneFilter(key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer",
                active
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-card border border-border text-dim hover:border-primary/20 hover:text-text"
              )}
            >
              {label}
              <span className={cn("text-[11px]", active ? "text-primary/70" : "text-dim/60")}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Domain rows */}
      {filtered.length === 0 ? (
        <div className="py-6 text-center text-sm text-dim">暂无匹配的领域。</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {filtered.map((item, i) => (
            <button
              key={item.topic}
              type="button"
              onClick={() => onSelect?.(item.topic)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors",
                "cursor-pointer hover:bg-card/60",
                i > 0 && "border-t border-border"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor[item.zone])} />
              <span className="font-medium shrink-0">{item.topic}</span>

              {/* Inline progress bar */}
              <div className="hidden md:block flex-1 min-w-0">
                {item.score != null ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r", barGradient[item.zone])}
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                ) : (
                  <div className="h-1.5 rounded-full bg-border" />
                )}
              </div>

              <span className={cn("shrink-0 text-xs font-semibold w-10 text-right", scoreColor[item.zone])}>
                {item.score != null ? item.score : "—"}
              </span>

              {item.weakCount > 0 && (
                <span className="shrink-0 text-[11px] text-red">{item.weakCount}弱</span>
              )}
              {item.strongCount > 0 && (
                <span className="shrink-0 text-[11px] text-green">{item.strongCount}强</span>
              )}

              <ChevronRight size={14} className="shrink-0 text-dim/40" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PatternColumn({ title, color, items }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className={cn("text-xs font-semibold uppercase tracking-wide mb-2", color)}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="flex items-start gap-2 text-sm leading-6 text-dim">
            <span className={cn("mt-2 h-1.5 w-1.5 rounded-full shrink-0", color.replace("text-", "bg-"))} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HabitTagList({ items }) {
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

const EVIDENCE_TYPE_ALL = "all";
const EVIDENCE_TYPES = [
  { key: EVIDENCE_TYPE_ALL, label: "全部" },
  { key: "weak", label: "待改进", tone: "destructive" },
  { key: "strong", label: "强项", tone: "success" },
  { key: "improved", label: "已改善", tone: "blue" },
];

function EvidenceTable({ weakItems, strongItems, improvedItems }) {
  const [typeFilter, setTypeFilter] = useState(EVIDENCE_TYPE_ALL);
  const [topicFilter, setTopicFilter] = useState(EVIDENCE_TYPE_ALL);
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 8;

  // Build unified list
  const allItems = [
    ...weakItems.map((item) => ({ ...item, _type: "weak" })),
    ...strongItems.map((item) => ({ ...item, _type: "strong" })),
    ...improvedItems.map((item) => ({ ...item, _type: "improved" })),
  ];

  // Collect unique topics
  const topics = [...new Set(allItems.map((item) => item.topic).filter(Boolean))].sort();

  // Filter
  const filtered = allItems.filter((item) => {
    if (typeFilter !== EVIDENCE_TYPE_ALL && item._type !== typeFilter) return false;
    if (topicFilter !== EVIDENCE_TYPE_ALL && item.topic !== topicFilter) return false;
    return true;
  });

  const visible = expanded ? filtered : filtered.slice(0, LIMIT);
  const hasMore = filtered.length > LIMIT;

  const typeCounts = { weak: weakItems.length, strong: strongItems.length, improved: improvedItems.length };

  const dotColor = { weak: "bg-red/80", strong: "bg-green/80", improved: "bg-info/80" };

  return (
    <div className="mt-5 space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {EVIDENCE_TYPES.map(({ key, label }) => {
          const active = typeFilter === key;
          const count = key === EVIDENCE_TYPE_ALL ? allItems.length : typeCounts[key];
          return (
            <button
              key={key}
              onClick={() => { setTypeFilter(key); setExpanded(false); }}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer",
                active
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-card border border-border text-dim hover:border-primary/20 hover:text-text"
              )}
            >
              {label}
              <span className={cn("text-[11px]", active ? "text-primary/70" : "text-dim/60")}>{count}</span>
            </button>
          );
        })}

        {topics.length > 1 && (
          <>
            <div className="w-px h-6 bg-border self-center mx-1" />
            {topics.map((topic) => {
              const active = topicFilter === topic;
              return (
                <button
                  key={topic}
                  onClick={() => { setTopicFilter(active ? EVIDENCE_TYPE_ALL : topic); setExpanded(false); }}
                  className={cn(
                    "px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-card border border-border text-dim hover:border-accent/20 hover:text-text"
                  )}
                >
                  {topic}
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Evidence rows */}
      {filtered.length === 0 ? (
        <div className="py-6 text-center text-sm text-dim">暂无匹配的证据条目。</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {visible.map((item, i) => {
            const isConsolidated = item.source === "consolidated";
            const sourceList = Array.isArray(item.consolidates) ? item.consolidates : [];
            return (
              <div
                key={`${item._type}-${item.point}-${i}`}
                className={cn(
                  "px-4 py-3 text-sm",
                  i > 0 && "border-t border-border",
                  item._type === "improved" && "opacity-65",
                  isConsolidated && "bg-accent/5"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      isConsolidated ? "bg-accent" : dotColor[item._type]
                    )}
                  />
                  <span className={cn("flex-1 min-w-0 truncate", item._type === "improved" && "line-through")}>
                    {item.point}
                  </span>
                  {isConsolidated && (
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px] bg-accent/15 text-accent border-accent/30"
                    >
                      ✦ 系统观察
                    </Badge>
                  )}
                  {item.topic && !isConsolidated && (
                    <Badge variant="outline" className="shrink-0 text-[11px]">{item.topic}</Badge>
                  )}
                  {item._type === "weak" && !isConsolidated && (item.times_seen || 1) > 1 && (
                    <span className="shrink-0 text-xs text-dim">{item.times_seen}次</span>
                  )}
                  <span className="shrink-0 text-xs text-dim w-12 text-right">
                    {formatShortDate(
                      item._type === "improved"
                        ? (item.improved_at || item.last_seen || item.first_seen)
                        : (item.last_seen || item.first_seen)
                    )}
                  </span>
                </div>
                {isConsolidated && sourceList.length > 0 && (
                  <div className="mt-2 ml-5 pl-3 border-l-2 border-accent/30 space-y-0.5">
                    <div className="text-[11px] text-dim/70">
                      基于 {sourceList.length} 条具体观察整合
                    </div>
                    {sourceList.map((src, ci) => (
                      <div key={ci} className="text-[11px] text-dim/80 truncate">
                        · {src}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-primary text-[13px] cursor-pointer hover:underline"
        >
          {expanded ? "收起" : `展开更多 (+${filtered.length - LIMIT})`}
        </button>
      )}
    </div>
  );
}

function getMasteryScore(data) {
  const value = data?.score ?? (data?.level ? data.level * 20 : null);
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(1));
}

function toTimestamp(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatMinute(value) {
  if (!value) return "--";
  return value.replace("T", " ").slice(0, 16);
}

function formatShortDate(value) {
  if (!value) return "--";
  if (value.length >= 10) return value.slice(5, 10);
  return value;
}

function sortByDateDesc(list, primaryKey, fallbackKey) {
  return [...list].sort((a, b) => {
    const aTime = toTimestamp(a[primaryKey] || a[fallbackKey]);
    const bTime = toTimestamp(b[primaryKey] || b[fallbackKey]);
    return bTime - aTime;
  });
}

function buildPriorityWeaknesses(weakPoints, masteryMap) {
  return [...weakPoints]
    .map((item) => {
      const masteryScore = getMasteryScore(masteryMap[item.topic]);
      const reasons = [`重复出现 ${item.times_seen || 1} 次`];
      if (item.last_seen || item.first_seen) reasons.push(`最近暴露 ${formatShortDate(item.last_seen || item.first_seen)}`);

      return {
        ...item,
        masteryScore,
        domainNote: masteryMap[item.topic]?.notes || "",
        reason: reasons.join(" · "),
      };
    })
    .sort((a, b) => {
      const seenDiff = (b.times_seen || 1) - (a.times_seen || 1);
      if (seenDiff !== 0) return seenDiff;

      const masteryA = a.masteryScore ?? -1;
      const masteryB = b.masteryScore ?? -1;
      if (masteryA !== masteryB) return masteryA - masteryB;

      return toTimestamp(b.last_seen || b.first_seen) - toTimestamp(a.last_seen || a.first_seen);
    });
}

function getRealTopicSet(profile, history, canonicalTopics) {
  const candidates = new Set(Object.keys(profile.topic_mastery || {}));

  (history || []).forEach((entry) => {
    if (entry?.topic) candidates.add(entry.topic);
  });

  // Only keep topics that exist in the canonical topics.json list
  if (canonicalTopics && canonicalTopics.size > 0) {
    for (const t of candidates) {
      if (!canonicalTopics.has(t)) candidates.delete(t);
    }
  }

  return candidates;
}

function buildDomainInsights(profile, realTopics) {
  const domainMap = new Map();
  const mastery = profile.topic_mastery || {};

  [...realTopics].forEach((topic) => {
    const data = mastery[topic] || {};
    domainMap.set(topic, {
      topic,
      score: getMasteryScore(data),
      note: data.notes || "",
      weakCount: 0,
      strongCount: 0,
      lastSignal: data.last_assessed || "",
    });
  });

  (profile.weak_points || [])
    .filter((item) => !item.improved && !item.archived && item.topic && realTopics.has(item.topic))
    .forEach((item) => {
      const existing = domainMap.get(item.topic) || {
        topic: item.topic,
        score: null,
        note: "",
        weakCount: 0,
        strongCount: 0,
        lastSignal: "",
      };
      existing.weakCount += 1;
      existing.lastSignal = [existing.lastSignal, item.last_seen || item.first_seen].sort((a, b) => toTimestamp(b) - toTimestamp(a))[0];
      domainMap.set(item.topic, existing);
    });

  (profile.strong_points || [])
    .filter((item) => item.topic && realTopics.has(item.topic))
    .forEach((item) => {
      const existing = domainMap.get(item.topic) || {
        topic: item.topic,
        score: null,
        note: "",
        weakCount: 0,
        strongCount: 0,
        lastSignal: "",
      };
      existing.strongCount += 1;
      existing.lastSignal = [existing.lastSignal, item.first_seen].sort((a, b) => toTimestamp(b) - toTimestamp(a))[0];
      domainMap.set(item.topic, existing);
    });

  return [...domainMap.values()]
    .map((item) => {
      let zone = "build";
      if (item.score != null) {
        if (item.score < 40) zone = "focus";
        else if (item.score >= 70) zone = "strong";
      } else if (item.weakCount > 0) {
        zone = "focus";
      } else if (item.strongCount > 0) {
        zone = "strong";
      }

      return {
        ...item,
        topWeakness: "",
        zone,
      };
    })
    .sort((a, b) => {
      const zoneOrder = { focus: 0, build: 1, strong: 2 };
      if (zoneOrder[a.zone] !== zoneOrder[b.zone]) return zoneOrder[a.zone] - zoneOrder[b.zone];

      const scoreA = a.score ?? -1;
      const scoreB = b.score ?? -1;
      if (scoreA !== scoreB) return scoreA - scoreB;

      const weakDiff = b.weakCount - a.weakCount;
      if (weakDiff !== 0) return weakDiff;

      return toTimestamp(b.lastSignal) - toTimestamp(a.lastSignal);
    });
}

function buildModeCounts(stats, history) {
  const counts = history.length
    ? history.reduce((acc, entry) => {
      const mode = entry.mode || "topic_drill";
      acc[mode] = (acc[mode] || 0) + 1;
      return acc;
    }, {})
    : {
      resume: stats.resume_sessions || 0,
      topic_drill: stats.drill_sessions || 0,
      jd_prep: stats.job_prep_sessions || 0,
    };

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(MODE_META)
    .map(([mode, meta]) => ({
      mode,
      label: meta.label,
      color: meta.color,
      count: counts[mode] || 0,
      percent: ((counts[mode] || 0) / total) * 100,
    }))
    .filter((item) => item.count > 0);
}

function buildTrainingModeStats(stats, history) {
  return Object.entries(TRAINING_MODE_META).map(([mode, meta]) => {
    const historyEntries = (history || []).filter((entry) => (entry.mode || "topic_drill") === mode);
    const historyScores = historyEntries
      .map((entry) => entry.avg_score)
      .filter((value) => typeof value === "number");
    const count = Math.max(stats[meta.countKey] || 0, historyEntries.length);
    const avgScore = typeof stats[meta.avgKey] === "number"
      ? stats[meta.avgKey]
      : historyScores.length
        ? Number((historyScores.reduce((sum, value) => sum + value, 0) / historyScores.length).toFixed(1))
        : null;

    return {
      mode,
      title: meta.label,
      count,
      avgScore,
      accentClassName: meta.accentClassName,
      borderClassName: meta.borderClassName,
      glowClassName: meta.glowClassName,
    };
  });
}

function getTrendDelta(history) {
  if (!history || history.length < 2) return null;
  const current = history[history.length - 1]?.avg_score;
  const previous = history[history.length - 2]?.avg_score;
  if (typeof current !== "number" || typeof previous !== "number") return null;
  return Number((current - previous).toFixed(1));
}

function getLatestEntry(history) {
  return history && history.length > 0 ? history[history.length - 1] : null;
}

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [canonicalTopics, setCanonicalTopics] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      getProfile().catch(() => null),
      getTopics().catch(() => ({})),
    ])
      .then(([p, t]) => {
        setProfile(p);
        setCanonicalTopics(new Set(Object.keys(t || {})));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={cn(PAGE_CLASS, "space-y-4")}>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-[220px] w-full rounded-[28px]" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
          <Skeleton className="h-[280px] rounded-[24px]" />
          <Skeleton className="h-[280px] rounded-[24px]" />
        </div>
        <Skeleton className="h-[260px] rounded-[24px]" />
      </div>
    );
  }

  const hasData = profile && (
    profile.stats?.total_sessions > 0 ||
    profile.stats?.total_answers > 0 ||
    (profile.weak_points || []).length > 0 ||
    (profile.strong_points || []).length > 0
  );

  if (!hasData) {
    return (
      <div className={PAGE_CLASS}>
        <div className="text-3xl font-display font-bold">个人画像</div>
        <Card className="mt-5 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(20,184,166,0.08))] dark:bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(8,145,178,0.12))]">
          <CardContent className="p-8 md:p-10">
            <div className="max-w-2xl">
              <Badge className="mb-4 bg-primary/12 text-primary">还没有训练数据</Badge>
              <div className="text-2xl font-semibold leading-tight md:text-4xl">
                先积累几轮回答，再让页面开始提炼真正的重点。
              </div>
              <div className="mt-4 text-sm leading-7 text-dim md:text-base">
                开始面试后，系统会逐步把你的弱项、强项、答题模式和领域变化沉淀下来。等第一批数据形成，页面会自动切到驾驶舱视图。
              </div>
              <Button variant="gradient" size="lg" className="mt-6" onClick={() => navigate("/")}>
                开始第一场面试
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = profile.stats || {};
  const scoreHistory = stats.score_history || [];
  const weakActive = (profile.weak_points || []).filter((item) => !item.improved && !item.archived);
  const weakImproved = sortByDateDesc(
    (profile.weak_points || []).filter((item) => item.improved),
    "improved_at",
    "last_seen"
  );
  const strongPoints = sortByDateDesc(profile.strong_points || [], "first_seen", "first_seen");
  const thinkingStrengths = profile.thinking_patterns?.strengths || [];
  const thinkingGaps = profile.thinking_patterns?.gaps || [];
  const communicationHabits = profile.communication?.habits || [];
  const communicationSuggestions = profile.communication?.suggestions || [];
  const masteryMap = profile.topic_mastery || {};
  const realTopicSet = getRealTopicSet(profile, scoreHistory, canonicalTopics);
  const priorityWeaknesses = buildPriorityWeaknesses(weakActive, masteryMap);
  const domains = buildDomainInsights(profile, realTopicSet);
  const focusDomains = domains.filter((item) => item.zone === "focus");
  const buildDomains = domains.filter((item) => item.zone === "build");
  const strongDomains = domains.filter((item) => item.zone === "strong");
  const topicPriorities = [...focusDomains, ...buildDomains, ...strongDomains]
    .map((item) => ({
      ...item,
      topWeakness: priorityWeaknesses.find((weakness) => weakness.topic === item.topic)?.point || "",
    }));
  const featuredTopic = topicPriorities[0] || null;
  const secondaryTopic = topicPriorities[1] || null;
  const extraTopicCount = Math.max(topicPriorities.length - 2, 0);
  const crossBlockers = priorityWeaknesses
    .filter((item) => !(item.topic && realTopicSet.has(item.topic)))
    .slice(0, 4);
  const visibleCrossBlockers = crossBlockers.slice(0, 2);
  const hiddenCrossBlockerCount = Math.max(crossBlockers.length - visibleCrossBlockers.length, 0);
  const modeCounts = buildModeCounts(stats, scoreHistory);
  const trainingModeStats = buildTrainingModeStats(stats, scoreHistory);
  const latestEntry = getLatestEntry(scoreHistory);
  const trendDelta = getTrendDelta(scoreHistory);
  const answerPatternsSection = (
    <Card className="mt-5 animate-fade-in-up [animation-delay:0.24s]">
      <CardContent className="p-5 md:p-6">
        <SectionHeader
          icon={<Brain size={18} />}
          title="答题模式"
          caption="模式层解释，不再拆成四张一级卡片和前面的诊断抢权重。"
        />

        {/* 表达特征 */}
        <div className="mt-5 text-sm leading-7 text-dim">
          {profile.communication?.style || "暂时没有形成明确的表达侧总结。"}
        </div>
        {communicationHabits.length > 0 && (
          <div className="mt-3">
            <HabitTagList items={communicationHabits} />
          </div>
        )}

        {/* 三栏紧凑列表 */}
        {(thinkingGaps.length > 0 || thinkingStrengths.length > 0 || communicationSuggestions.length > 0) && (
          <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-3">
            <PatternColumn title="风险" color="text-red" items={thinkingGaps} />
            <PatternColumn title="优势" color="text-green" items={thinkingStrengths} />
            <PatternColumn title="训练" color="text-primary" items={communicationSuggestions} />
          </div>
        )}
      </CardContent>
    </Card>
  );
  const evidenceSection = (
    <Card className="mt-5 animate-fade-in-up [animation-delay:0.16s]">
      <CardContent className="p-5 md:p-6">
        <SectionHeader
          icon={<Clock3 size={18} />}
          title="证据库"
          caption="原始条目提前到摘要之后，方便你快速核对判断依据。"
        />
        <EvidenceTable
          weakItems={priorityWeaknesses}
          strongItems={strongPoints}
          improvedItems={weakImproved}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className={PAGE_CLASS}>
      <div className="animate-fade-in">
        <div className="text-3xl font-display font-bold tracking-tight md:text-4xl">个人画像</div>
        <div className="mt-2 text-sm text-dim">
          {stats.total_answers || 0} 次回答分析
          {stats.total_sessions ? ` | ${stats.total_sessions} 次完整面试` : ""}
          {profile.updated_at ? ` | 上次更新 ${formatMinute(profile.updated_at)}` : ""}
        </div>
      </div>

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.04s]">
        <CardContent className="p-4 md:p-5">
          <SectionHeader
            icon={<TrendingUp size={18} />}
            title="练习统计"
          />

          <div className="mt-5 grid gap-6 lg:grid-cols-[auto_1px_1fr] items-center rounded-3xl border border-border/60 bg-black/[0.02] dark:bg-white/[0.02] p-5 md:p-6 lg:p-7 shadow-sm">
            {/* Global Stats */}
            <div className="flex gap-8 md:gap-14 lg:pl-2">
              <div className="flex flex-col gap-1.5">
                 <div className="text-sm font-medium text-dim">总练习次数</div>
                 <div className="mt-1 flex items-baseline gap-1.5">
                    <div className="text-4xl font-bold tracking-tight text-primary drop-shadow-sm">{stats.total_sessions || 0}</div>
                 </div>
              </div>
              <div className="flex flex-col gap-1.5">
                 <div className="text-sm font-medium text-dim">综合平均分</div>
                 <div className="mt-1 flex items-baseline gap-1.5">
                    <div className="text-4xl font-bold tracking-tight text-green drop-shadow-sm">{stats.avg_score ?? "-"}</div>
                 </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-full w-px bg-border/60 hidden lg:block" />

            {/* Breakdown Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 w-full lg:pl-6">
              {trainingModeStats.map((item) => (
                <div key={item.mode} className={cn("flex flex-col rounded-2xl border border-border/80 border-l-[4px] px-4 py-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.92))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.04))]", item.borderClassName, item.glowClassName)}>
                   <div className={cn("text-xs font-medium md:text-sm", item.accentClassName)}>{item.title}</div>
                   <div className="mt-2.5 flex items-baseline gap-3">
                      <div>
                         <span className={cn("text-xl font-semibold tracking-tight", item.accentClassName)}>{item.count}</span>
                         <span className="ml-0.5 text-[10px] text-dim">次</span>
                      </div>
                      <div className="text-border/60 text-xs">/</div>
                      <div>
                         <span className={cn("text-xl font-semibold tracking-tight", item.accentClassName)}>{item.avgScore ?? "-"}</span>
                         <span className="ml-0.5 text-[10px] text-dim">分</span>
                      </div>
                   </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.38fr)_minmax(360px,0.82fr)] 2xl:grid-cols-[minmax(0,1.5fr)_minmax(400px,0.86fr)]">
        <Card className="animate-fade-in-up [animation-delay:0.08s]">
          <CardContent className="p-5 md:p-6">
            <SectionHeader
              icon={<Target size={18} />}
              title="当前重点"
              caption="把真实训练领域和跨领域阻塞拆开，避免继续混成同一类卡片。"
              action={(
                <Button variant="outline" size="sm" onClick={() => navigate("/history")}>
                  查看全部记录
                </Button>
              )}
            />

            <div className="mt-5 space-y-4">
              {featuredTopic ? (
                <TopicPriorityCard
                  item={featuredTopic}
                  onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
                  variant="featured"
                  label="主推荐领域"
                />
              ) : (
                <div className="rounded-[24px] border border-dashed border-border/80 px-5 py-8 text-sm text-dim">
                  目前没有可继续追踪的真实训练领域。
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="text-sm font-semibold">下一顺位</div>
                    <Badge variant="secondary">{secondaryTopic ? 1 : 0}</Badge>
                  </div>

                  {secondaryTopic ? (
                    <TopicPriorityCard
                      item={secondaryTopic}
                      onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
                      label="次推荐"
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-sm text-dim">
                      当前没有第二优先级领域，先把主推荐打透。
                    </div>
                  )}

                  {extraTopicCount > 0 && (
                    <div className="mt-3 rounded-2xl border border-border/70 bg-black/[0.02] px-4 py-3 text-xs leading-5 text-dim dark:bg-white/[0.02]">
                      还有 {extraTopicCount} 个领域在排队，完整列表放在下方能力地图，不再挤进首页主视图。
                    </div>
                  )}
                </div>

                <div className="rounded-[24px] border border-border/80 bg-card/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">共性阻塞</div>
                      <div className="mt-1 text-xs leading-5 text-dim">
                        这些问题会跨多个场景反复出现，不属于单一领域，所以单独收口，不再伪装成可点击的 topic。
                      </div>
                    </div>
                    <Badge variant="destructive">{crossBlockers.length}</Badge>
                  </div>

                  <div className="mt-4">
                    <CrossBlockerList items={visibleCrossBlockers} />
                  </div>

                  {hiddenCrossBlockerCount > 0 && (
                    <div className="mt-3 text-xs leading-5 text-dim">
                      其余 {hiddenCrossBlockerCount} 条保留在证据库里，避免首页继续堆叠重复诊断。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 animate-fade-in-up [animation-delay:0.12s]">
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={<Sparkles size={18} />}
                title="最近信号"
                caption="把进步、稳定得分点和最新表现放在同一侧栏里。"
              />

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl bg-green/8 p-4">
                  <div className="text-sm font-semibold text-green">最近改善</div>
                  <div className="mt-3 space-y-2">
                    {weakImproved.slice(0, 2).map((item) => (
                      <div key={item.point} className="rounded-xl bg-card/90 px-3 py-2 text-sm leading-6">
                        <div className="flex items-center justify-between gap-3">
                          <span>{item.point}</span>
                          <Badge variant="success">已改善</Badge>
                        </div>
                      </div>
                    ))}
                    {weakImproved.length === 0 && (
                      <div className="rounded-xl bg-card/90 px-3 py-2 text-sm text-dim">
                        还没有形成明确的改善闭环。
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-primary/8 p-4">
                  <div className="text-sm font-semibold text-primary">稳定得分点</div>
                  <div className="mt-3 space-y-2">
                    {strongPoints.slice(0, 3).map((item) => (
                      <div key={item.point} className="rounded-xl bg-card/90 px-3 py-2 text-sm leading-6">
                        <div className="flex items-center justify-between gap-3">
                          <span>{item.point}</span>
                          {item.topic && <Badge variant="outline">{item.topic}</Badge>}
                        </div>
                      </div>
                    ))}
                    {strongPoints.length === 0 && (
                      <div className="rounded-xl bg-card/90 px-3 py-2 text-sm text-dim">
                        还没有记录到稳定的优势信号。
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/80 bg-card/80 p-4">
                    <div className="text-xs font-medium text-dim">最近一次评分</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {latestEntry?.avg_score != null ? `${latestEntry.avg_score}/10` : "--"}
                    </div>
                    <div className="mt-2 text-xs text-dim">
                      {latestEntry ? `${(MODE_META[latestEntry.mode] || MODE_META.topic_drill).label} · ${formatShortDate(latestEntry.date)}` : "暂无评分记录"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/80 bg-card/80 p-4">
                    <div className="text-xs font-medium text-dim">趋势变化</div>
                    <div className={cn(
                      "mt-2 text-2xl font-semibold",
                      trendDelta == null ? "text-text" : trendDelta >= 0 ? "text-green" : "text-red"
                    )}>
                      {trendDelta == null ? "--" : trendDelta > 0 ? `+${trendDelta}` : trendDelta}
                    </div>
                    <div className="mt-2 text-xs text-dim">
                      相比上一条评分记录
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={<Activity size={18} />}
                title="训练结构"
                caption="训练类型分布决定了画像的信号来源。"
              />

              <div className="mt-5 space-y-3">
                {modeCounts.length > 0 ? modeCounts.map((item) => (
                  <div key={item.mode}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{item.label}</span>
                      <span className="text-dim">{item.count} 次</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-border/80 px-3 py-4 text-sm text-dim">
                    暂无训练分布数据。
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-black/4 px-4 py-3 dark:bg-white/[0.04]">
                  <div className="text-xs text-dim">回答分析</div>
                  <div className="mt-1 text-xl font-semibold">{stats.total_answers || 0}</div>
                </div>
                <div className="rounded-2xl bg-black/4 px-4 py-3 dark:bg-white/[0.04]">
                  <div className="text-xs text-dim">覆盖主题</div>
                  <div className="mt-1 text-xl font-semibold">{domains.length}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {evidenceSection}

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.2s]">
        <CardContent className="p-5 md:p-6">
          <SectionHeader
            icon={<Target size={18} />}
            title="能力地图"
            caption="这里只显示真实训练主题，不再把画像标签误当成领域。"
          />

          <DomainTable
            items={topicPriorities}
            onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
          />
        </CardContent>
      </Card>

      {answerPatternsSection}

      {scoreHistory.length >= 2 && (
        <Card className="mt-5 animate-fade-in-up [animation-delay:0.28s]">
          <CardContent className="p-5 md:p-6">
            <SectionHeader
              icon={<TrendingUp size={18} />}
              title="成长趋势"
              caption="趋势保留在后面，作为历史参考，而不是首页主判断。"
            />
            <div className="mt-5 rounded-[24px] border border-border/70 bg-black/[0.02] p-3 dark:bg-white/[0.02] md:p-4">
              <ScoreChart history={scoreHistory} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
