import { Card, CardContent } from "@/components/ui/card";
import ScorePill from "@/components/ScorePill";
import { getScoreColorVar } from "@/lib/scoreTone";
import type { DimensionScoreMap } from "./types";

export default function DimensionScores({ dimensionScores, avgScore, labels }: {
  dimensionScores?: DimensionScoreMap | null;
  avgScore?: number | null;
  labels: Record<string, string>;
}) {
  if (!dimensionScores) return null;
  const entries = Object.entries(labels).flatMap(([key, label]) => {
    const score = dimensionScores[key];
    return score == null ? [] : [{ key, label, score }];
  });
  if (!entries.length) return null;

  return (
    <Card className="mb-6">
      <CardContent className="p-5 md:p-7">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-lg font-semibold">
          维度评分
          {avgScore != null && (
            <div className="flex items-center gap-1 text-sm font-normal text-dim">
              综合 <ScorePill emptyLabel="--" score={avgScore} />
            </div>
          )}
        </div>
        {entries.map(({ key, label, score }) => {
          const color = getScoreColorVar(score);
          return (
            <div key={key} className="flex items-center gap-3 mb-2.5">
              <div className="w-[90px] md:w-[110px] text-[13px] text-dim text-right shrink-0">{label}</div>
              <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-500 ease-in-out" style={{ width: `${score * 10}%`, background: color }} />
              </div>
              <div className="w-9 text-sm font-semibold text-right shrink-0" style={{ color }}>{score}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
