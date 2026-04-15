import { useState } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { formatShortDate } from "./derive";
import { EVIDENCE_TYPE_ALL, EVIDENCE_TYPES } from "./meta";

export default function EvidenceTable({ weakItems, strongItems, improvedItems }) {
  const [typeFilter, setTypeFilter] = useState(EVIDENCE_TYPE_ALL);
  const [topicFilter, setTopicFilter] = useState(EVIDENCE_TYPE_ALL);
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 8;

  const allItems = [
    ...weakItems.map((item) => ({ ...item, _type: "weak" })),
    ...strongItems.map((item) => ({ ...item, _type: "strong" })),
    ...improvedItems.map((item) => ({ ...item, _type: "improved" })),
  ];

  const topics = [...new Set(allItems.map((item) => item.topic).filter(Boolean))].sort();

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
      <div className="flex flex-wrap gap-2">
        {EVIDENCE_TYPES.map(({ key, label }) => {
          const active = typeFilter === key;
          const count = key === EVIDENCE_TYPE_ALL ? allItems.length : typeCounts[key];
          return (
            <button
              key={key}
              onClick={() => {
                setTypeFilter(key);
                setExpanded(false);
              }}
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
                  onClick={() => {
                    setTopicFilter(active ? EVIDENCE_TYPE_ALL : topic);
                    setExpanded(false);
                  }}
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

      {filtered.length === 0 ? (
        <div className="py-6 text-center text-sm text-dim">暂无匹配的证据条目。</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {visible.map((item, index) => {
            const isConsolidated = item.source === "consolidated";
            const sourceList = Array.isArray(item.consolidates) ? item.consolidates : [];

            return (
              <div
                key={`${item._type}-${item.point}-${index}`}
                className={cn(
                  "px-4 py-3 text-sm",
                  index > 0 && "border-t border-border",
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
                    {sourceList.map((source, sourceIndex) => (
                      <div key={sourceIndex} className="text-[11px] text-dim/80 truncate">
                        · {source}
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
