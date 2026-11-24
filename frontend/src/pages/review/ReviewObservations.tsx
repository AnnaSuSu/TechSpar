import { Card, CardContent } from "@/components/ui/card";
import type { ReviewOverall } from "./types";

export default function ReviewObservations({ overall }: { overall?: ReviewOverall | null }) {
  const communication = overall?.communication_observations;
  const thinking = overall?.thinking_patterns;
  if (!communication && !thinking) return null;

  return (
    <Card className="mb-6">
      <CardContent className="p-5 md:p-7">
        {communication && (
          <div className="mb-4">
            <div className="text-base font-semibold mb-3">沟通表达</div>
            {communication.style_update && (
              <div className="text-sm leading-[1.7] text-text mb-2">{communication.style_update}</div>
            )}
            {communication.new_habits?.length ? (
              <div className="text-[13px] text-dim mb-1">表达习惯: {communication.new_habits.join("、")}</div>
            ) : null}
            {communication.new_suggestions?.length ? (
              <div className="mt-2">
                {communication.new_suggestions.map((suggestion, index) => (
                  <div key={index} className="px-3 py-2 rounded-lg text-[13px] text-text border bg-blue-500/8 border-blue-500/20 mb-1.5">{suggestion}</div>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {thinking && (
          <div>
            <div className="text-base font-semibold mb-3">思维模式</div>
            {thinking.new_strengths?.length ? (
              <div className="text-[13px] text-text mb-1">
                <span className="text-dim">优势: </span>{thinking.new_strengths.join("、")}
              </div>
            ) : null}
            {thinking.new_gaps?.length ? (
              <div className="text-[13px] text-text">
                <span className="text-dim">待提升: </span>{thinking.new_gaps.join("、")}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
