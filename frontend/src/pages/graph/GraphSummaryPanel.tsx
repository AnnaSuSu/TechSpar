import type { ReactNode } from "react";
import type { TopicInfo } from "@/api/topics";
import ScorePill from "@/components/ScorePill";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buildScoreFilterLabel } from "./graphUtils";
import type { GraphInsights, ScoreFilter } from "./types";

export function GraphHeadlineStats({ topicCount, graphInsights, selectedTopic }: {
  topicCount: number;
  graphInsights: GraphInsights;
  selectedTopic: string | null;
}) {
  return (
      <div className="flex flex-wrap gap-2">
        <SummaryChip label="领域" value={topicCount} hint="可切换" />
        <SummaryChip label="节点" value={graphInsights.nodeCount} hint={selectedTopic ? "当前筛选结果" : "待选择"} />
        <SummaryChip label="连接" value={graphInsights.linkCount} hint="语义相似" />
      </div>
  );
}

function SummaryChip({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/82 px-3.5 py-2.5 backdrop-blur-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim/80">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-xl font-semibold tracking-tight text-primary tabular-nums">{value}</div>
        <div className="text-xs text-dim">{hint}</div>
      </div>
    </div>
  );
}

export default function GraphSummaryPanel({ graphInsights, selectedTopicInfo, scoreFilter, areaFilter, hasActiveFilters }: {
  graphInsights: GraphInsights;
  selectedTopicInfo?: TopicInfo | null;
  scoreFilter: ScoreFilter;
  areaFilter: string;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricTile label="平均得分" value={<ScorePill score={graphInsights.avgScore} size="large" emptyLabel="--" />} />
        <MetricTile label="待补题数" value={graphInsights.weakCount} valueClassName={graphInsights.weakCount ? "text-red" : "text-text"} />
        <MetricTile label="稳定题数" value={graphInsights.stableCount} valueClassName={graphInsights.stableCount ? "text-green" : "text-text"} />
        <MetricTile label="语义连接" value={graphInsights.linkCount} />
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm font-semibold text-text">当前上下文</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-dim">
          <Badge variant="outline">{selectedTopicInfo?.name || "未选择领域"}</Badge>
          <Badge variant="outline">得分筛选 {buildScoreFilterLabel(scoreFilter)}</Badge>
          <Badge variant="outline">Focus Area {areaFilter === "all" ? "全部" : areaFilter}</Badge>
          {hasActiveFilters && <Badge variant="secondary">已启用筛选</Badge>}
        </div>
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm font-semibold text-text">高频 Focus Area</div>
        <div className="mt-3 space-y-2">
          {graphInsights.topAreas.length > 0 ? graphInsights.topAreas.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-text">{item.label}</span>
              <Badge variant="secondary">{item.count}</Badge>
            </div>
          )) : (
            <div className="text-sm text-dim">选择领域后，这里会显示节点最集中的 focus area。</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, valueClassName = "text-primary" }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="rounded-[20px] border border-border/80 bg-background/70 px-4 py-3.5">
      <div className="text-xs text-dim">{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", valueClassName)}>{value}</div>
    </div>
  );
}
