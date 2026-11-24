import type { TopicsResponse } from "@/api/topics";
import { getTopicIcon } from "@/utils/topicIcons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SCORE_FILTERS } from "./graphUtils";
import type { GraphFilters } from "./types";

interface GraphFilterBarProps {
  topics: TopicsResponse;
  selectedTopic: string | null;
  focusAreas: string[];
  filters: GraphFilters;
  onSelectTopic: (topic: string) => void;
  onFilterChange: (filters: GraphFilters) => void;
}

export default function GraphFilterBar({ topics, selectedTopic, focusAreas, filters, onSelectTopic, onFilterChange }: GraphFilterBarProps) {
  const topicEntries = Object.entries(topics);
  const { searchQuery, scoreFilter, areaFilter } = filters;

  return (
    <Card className="mt-4 border-border/80 bg-card/76">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text">领域切换</div>
            <div className="mt-1 text-sm text-dim">横向滚动切换，避免领域标签换行打散布局。</div>
          </div>
          <div className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs text-dim">
            当前支持拖拽、滚轮缩放、节点点击
          </div>
        </div>

        <div className="mt-4 -mx-1 overflow-x-auto scrollbar-subtle pb-1">
          <div className="flex min-w-max gap-2 px-1">
            {topicEntries.map(([key, info]) => {
              const selected = selectedTopic === key;
              return (
                <Button
                  key={key}
                  variant={selected ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-10 rounded-full px-4",
                    selected
                      ? "border border-primary/60 bg-primary/14 text-text shadow-[0_0_0_1px_rgba(245,158,11,0.08)]"
                      : "border border-transparent hover:border-border/80"
                  )}
                  onClick={() => onSelectTopic(key)}
                >
                  <span className="mr-1.5 inline-flex align-middle">{getTopicIcon(info.icon, 14)}</span>
                  {info.name}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-[minmax(280px,1fr)_280px_260px] 2xl:grid-cols-[minmax(360px,1fr)_280px_280px]">
          <Input
            className="w-full min-w-0"
            value={searchQuery}
            disabled={!selectedTopic}
            onChange={(event) => onFilterChange({ ...filters, searchQuery: event.target.value })}
            placeholder={selectedTopic ? "搜索题目或 focus area" : "先选择领域，再搜索题目"}
          />

          <div className="flex min-w-0 flex-nowrap gap-2 overflow-hidden">
            {SCORE_FILTERS.map((item) => (
              <Button
                key={item.key}
                variant={scoreFilter === item.key ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "rounded-full px-4",
                  scoreFilter === item.key && "border border-primary/45 bg-primary/10 text-text"
                )}
                disabled={!selectedTopic}
                onClick={() => onFilterChange({ ...filters, scoreFilter: item.key })}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <label className={cn(
            "flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-2xl border border-border/80 bg-background/75 px-3 py-2.5 text-sm",
            !selectedTopic && "opacity-60"
          )}>
            <span className="shrink-0 text-dim">Focus Area</span>
            <select
              className="w-0 min-w-0 flex-1 truncate bg-transparent text-right text-text outline-none"
              value={areaFilter}
              disabled={!selectedTopic}
              onChange={(event) => onFilterChange({ ...filters, areaFilter: event.target.value })}
            >
              <option value="all">全部</option>
              {focusAreas.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
