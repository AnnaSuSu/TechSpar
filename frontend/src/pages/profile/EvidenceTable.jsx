import { useState } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { sendPatternFeedback } from "../../api/interview";
import { formatShortDate } from "./derive";
import { EVIDENCE_TYPE_ALL, EVIDENCE_TYPES } from "./meta";

export default function EvidenceTable({ weakItems, strongItems, improvedItems }) {
  const [typeFilter, setTypeFilter] = useState(EVIDENCE_TYPE_ALL);
  const [topicFilter, setTopicFilter] = useState(EVIDENCE_TYPE_ALL);
  const [expanded, setExpanded] = useState(false);
  // 用户对 consolidated 规律的反馈,乐观更新,失败回滚
  const [patternFeedback, setPatternFeedback] = useState({});
  const LIMIT = 8;

  const handlePatternFeedback = async (point, verdict) => {
    setPatternFeedback((prev) => ({ ...prev, [point]: verdict }));
    try {
      await sendPatternFeedback(point, verdict);
    } catch {
      setPatternFeedback((prev) => {
        const next = { ...prev };
        delete next[point];
        return next;
      });
    }
  };

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
  // source="predicted" 是 Copilot JD 分析预测的坑,还没在实际回答中暴露过,
  // 必须和 observed 区分展示,否则用户会以为自己真的答砸过
  const isPredicted = (item) => item.source === "predicted";

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap gap-2">
        {EVIDENCE_TYPES.map(({ key, label }) => {
          const active = typeFilter === key;
          const count = key === EVIDENCE_TYPE_ALL ? allItems.length : typeCounts[key];
          // 数量为 0 的分类没有可筛内容,渲染出来只是噪音
          if (count === 0 && key !== EVIDENCE_TYPE_ALL) return null;
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
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "bg-card border border-border text-dim hover:border-primary/20 hover:text-text"
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
                  isConsolidated && "bg-primary/5"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      isConsolidated ? "bg-primary" : isPredicted(item) ? "bg-info/70" : dotColor[item._type]
                    )}
                  />
                  <span className={cn("flex-1 min-w-0 truncate", item._type === "improved" && "line-through")}>
                    {item.point}
                  </span>
                  {isPredicted(item) && (
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px] bg-info/12 text-info border-info/30"
                      title="来自 JD 分析的预测，还没在实际回答中验证过"
                    >
                      JD 预测
                    </Badge>
                  )}
                  {isConsolidated && (
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px] bg-primary/15 text-primary border-primary/30"
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
                  <div className="mt-2 ml-5 pl-3 border-l-2 border-primary/30 space-y-0.5">
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

                {isConsolidated && item._type === "weak" && (
                  <div className="mt-2 ml-5 flex items-center gap-2">
                    {patternFeedback[item.point] === "inaccurate" ? (
                      <span className="text-[11px] text-dim/70">已标记不准，这条规律不再展示</span>
                    ) : patternFeedback[item.point] === "accurate" || item.user_acknowledged ? (
                      <span className="text-[11px] text-dim/70">✓ 已确认</span>
                    ) : (
                      <>
                        <span className="text-[11px] text-dim/60">这条规律准吗？</span>
                        <button
                          onClick={() => handlePatternFeedback(item.point, "accurate")}
                          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-dim transition-colors cursor-pointer hover:border-green/40 hover:text-green"
                        >
                          准
                        </button>
                        <button
                          onClick={() => handlePatternFeedback(item.point, "inaccurate")}
                          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-dim transition-colors cursor-pointer hover:border-red/40 hover:text-red"
                        >
                          不准
                        </button>
                      </>
                    )}
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
