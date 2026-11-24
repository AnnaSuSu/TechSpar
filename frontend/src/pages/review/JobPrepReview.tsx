import { BriefcaseBusiness } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import ScorePill from "@/components/ScorePill";
import { getScoreColorVar } from "@/lib/scoreTone";
import PointList from "./PointList";
import DimensionScores from "./DimensionScores";
import type { QuestionReviewProps, ReviewMeta } from "./types";
import { JOB_PREP_DIMENSION_LABELS } from "./utils";

export default function JobPrepReview({ scores, overall, questions, answers, meta }: QuestionReviewProps & {
  meta?: ReviewMeta;
}) {
  const answerMap = new Map(answers.map((answer) => [String(answer.question_id), answer.answer]));
  const scoreMap = new Map(scores?.map((score) => [String(score.question_id), score]));
  const avgScore = overall?.avg_score || "-";

  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BriefcaseBusiness size={18} className="text-blue-400" />
                <span className="text-lg font-semibold">
                  {meta?.company ? `${meta.company} · ` : ""}{meta?.position || "目标岗位"}
                </span>
              </div>
              {typeof meta?.preview?.role_summary === "string" && (
                <div className="text-sm text-dim leading-relaxed">{meta.preview.role_summary}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[32px] font-bold" style={{ color: typeof avgScore === "number" ? getScoreColorVar(avgScore) : "var(--foreground)" }}>
                {avgScore}
              </div>
              <div className="text-sm text-dim">/10</div>
            </div>
          </div>

          {overall?.summary && (
            <div className="text-[15px] leading-[1.8] text-text mb-4">{overall.summary}</div>
          )}
          {overall?.role_fit_summary && (
            <div className="rounded-xl bg-blue-500/8 border border-blue-500/15 px-4 py-3 text-sm leading-relaxed">
              <div className="text-[13px] font-semibold text-blue-300 mb-1.5">岗位匹配判断</div>
              {overall.role_fit_summary}
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <Badge variant="secondary">共 {questions?.length || 0} 题</Badge>
            <Badge variant="secondary">已答 {answers?.filter((a) => a.answer).length || 0} 题</Badge>
            <Badge variant={meta?.use_resume ? "blue" : "secondary"}>{meta?.use_resume ? "JD + 简历联动" : "仅 JD"}</Badge>
          </div>
        </CardContent>
      </Card>

      <DimensionScores
        dimensionScores={overall?.dimension_scores}
        avgScore={overall?.avg_score}
        labels={JOB_PREP_DIMENSION_LABELS}
      />

      <PointList title="高风险追问点" items={overall?.interviewer_hotspots} tone="blue" />
      <PointList title="面试前优先补强" items={overall?.prep_priorities} />
      <PointList title="薄弱点" items={overall?.new_weak_points} />
      <PointList title="亮点" items={overall?.new_strong_points} tone="green" />

      <div className="text-base font-semibold mb-3 text-text">逐题复盘</div>
      <div className="flex flex-col gap-4">
        {(questions || []).map((q) => {
          const s = scoreMap.get(String(q.id));
          const answer = answerMap.get(String(q.id));
          const isSkipped = !answer;

          return (
            <Card key={q.id} className={isSkipped ? "opacity-60" : "animate-fade-in"}>
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-primary border-primary/30">Q{q.id}</Badge>
                    {q.category && <Badge variant="blue">{q.category}</Badge>}
                    {q.focus_area && <Badge variant="secondary">{q.focus_area}</Badge>}
                  </div>
                  <ScorePill emptyLabel="--" score={isSkipped ? null : s?.score} />
                </div>

                <div className="text-[15px] font-medium leading-relaxed mb-3">{q.question}</div>

                {q.intent && (
                  <div className="mb-3 rounded-lg bg-hover px-3.5 py-3 text-sm text-dim leading-relaxed">
                    <span className="font-medium text-text">面试官在看什么：</span> {q.intent}
                  </div>
                )}

                {isSkipped ? (
                  <div className="text-[13px] text-dim">未作答</div>
                ) : (
                  <>
                    <div className="bg-hover rounded-lg px-3 py-3 md:px-4 mb-3">
                      <div className="text-xs font-semibold text-dim mb-1.5 opacity-70">你的回答</div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
                    </div>

                    {s?.role_expectation && (
                      <div className="text-sm leading-[1.7] text-dim mb-2">
                        <strong className="text-xs opacity-60">岗位在看什么: </strong>{s.role_expectation}
                      </div>
                    )}
                    {s?.assessment && (
                      <div className="text-sm leading-[1.7] text-text mb-2">
                        <strong className="text-xs opacity-60">点评: </strong>{s.assessment}
                      </div>
                    )}
                    {s?.improvement && (
                      <div className="text-sm leading-[1.7] text-primary bg-primary/8 rounded-lg px-3 py-2.5 mb-2">
                        <strong className="text-xs opacity-70">改进建议: </strong>{s.improvement}
                      </div>
                    )}
                    {s?.understanding && (
                      <div className="text-[13px] text-dim italic mb-1">理解程度: {s.understanding}</div>
                    )}
                    {Boolean(s?.key_missing?.length) && (
                      <div className="text-[13px] text-red leading-normal">遗漏关键点: {s?.key_missing?.join("、")}</div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
