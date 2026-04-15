import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { ZONE_FILTERS } from "./meta";

export default function DomainTable({ items, onSelect }) {
  const [zoneFilter, setZoneFilter] = useState("all");

  const filtered = zoneFilter === "all" ? items : items.filter((item) => item.zone === zoneFilter);
  const zoneCounts = { focus: 0, build: 0, strong: 0 };
  items.forEach((item) => {
    if (zoneCounts[item.zone] != null) zoneCounts[item.zone] += 1;
  });

  const dotColor = { focus: "bg-primary", build: "bg-info", strong: "bg-green" };
  const scoreColor = { focus: "text-primary", build: "text-info", strong: "text-green" };
  const barGradient = { focus: "from-primary to-orange", build: "from-info to-teal", strong: "from-green to-teal" };

  return (
    <div className="mt-5 space-y-3">
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

      {filtered.length === 0 ? (
        <div className="py-6 text-center text-sm text-dim">暂无匹配的领域。</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {filtered.map((item, index) => (
            <button
              key={item.topic}
              type="button"
              onClick={() => onSelect?.(item.topic)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors",
                "cursor-pointer hover:bg-card/60",
                index > 0 && "border-t border-border"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor[item.zone])} />
              <span className="font-medium shrink-0">{item.topic}</span>

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
