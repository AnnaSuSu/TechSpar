import { Card, CardContent } from "@/components/ui/card";
import ScorePill from "@/components/ScorePill";
import { getScoreColorVar } from "@/lib/scoreTone";
import PointList from "./PointList";
import ReviewObservations from "./ReviewObservations";
import type { ReviewedTopic, ReviewOverall } from "./types";

export default function SoloRecordingReview({ topicsCovered, overall }: {
  topicsCovered: ReviewedTopic[];
  overall?: ReviewOverall | null;
}) {
  const avgScore = overall?.avg_score || "-";
  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8">
          <div className="text-lg font-semibold mb-3">整体评价</div>
          <div>
            <span className="inline-block text-[32px] font-bold mr-2" style={{ color: typeof avgScore === "number" ? getScoreColorVar(avgScore) : "var(--foreground)" }}>
              {avgScore}
            </span>
            <span className="text-base text-dim">/10</span>
          </div>
          {overall?.summary && (
            <div className="mt-4 text-[15px] leading-[1.8] text-text">{overall.summary}</div>
          )}
        </CardContent>
      </Card>

      <PointList title="薄弱点" items={overall?.new_weak_points} />
      <PointList title="亮点" items={overall?.new_strong_points} tone="green" />

      {topicsCovered?.length > 0 && (
        <div className="mb-6">
          <div className="text-base font-semibold mb-3 text-text">涉及知识点</div>
          <div className="flex flex-col gap-4">
            {topicsCovered.map((t, i) => (
              <Card key={i} className="animate-fade-in">
                <CardContent className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[15px] font-medium">{t.topic || "未知知识点"}</span>
                    <ScorePill emptyLabel="--" score={t.score} />
                  </div>
                  {t.assessment && <div className="text-sm leading-[1.7] text-text mb-2">{t.assessment}</div>}
                  {t.understanding && <div className="text-[13px] text-dim italic mb-1">理解程度: {t.understanding}</div>}
                  {Boolean(t.errors?.length) && <div className="text-[13px] text-red leading-normal">错误: {t.errors?.join("、")}</div>}
                  {Boolean(t.missing?.length) && <div className="text-[13px] text-dim leading-normal">遗漏: {t.missing?.join("、")}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <ReviewObservations overall={overall} />
    </>
  );
}
