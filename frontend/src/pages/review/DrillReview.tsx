import { useState } from "react";
import { BookOpen } from "lucide-react";
import { getReferenceAnswer } from "@/api/sessions";
import { errorMessage } from "@/lib/errorMessage";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ScorePill from "@/components/ScorePill";
import { getScoreColorVar } from "@/lib/scoreTone";
import PointList from "./PointList";
import ReviewObservations from "./ReviewObservations";
import type { QuestionId } from "../interview/types";
import type { QuestionReviewProps } from "./types";

export default function DrillReview({ scores, overall, questions, answers, topic, sessionId, initialRefAnswers }: QuestionReviewProps & {
  topic?: string | null;
  sessionId: string;
  initialRefAnswers?: Record<string, string>;
}) {
  const answerMap = new Map(answers.map((answer) => [String(answer.question_id), answer.answer]));
  const scoreMap = new Map(scores?.map((score) => [String(score.question_id), score]));
  const [refAnswers, setRefAnswers] = useState(initialRefAnswers || {});
  const [refLoading, setRefLoading] = useState<Partial<Record<QuestionId, boolean>>>({});

  const handleRefAnswer = async (qId: QuestionId) => {
    if (refAnswers[qId]) return;
    setRefLoading((p) => ({ ...p, [qId]: true }));
    try {
      const data = await getReferenceAnswer(sessionId, qId);
      setRefAnswers((p) => ({ ...p, [qId]: data.reference_answer }));
    } catch (e) {
      setRefAnswers((p) => ({ ...p, [qId]: "生成失败: " + errorMessage(e) }));
    }
    setRefLoading((p) => ({ ...p, [qId]: false }));
  };

  const avgScore = overall?.avg_score || "-";

  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8">
          <div className="text-lg font-semibold mb-3">整体评价</div>
          <div className="flex items-center gap-1 mb-2">
            <span className="inline-block text-[32px] font-bold" style={{ color: typeof avgScore === "number" ? getScoreColorVar(avgScore) : "var(--foreground)" }}>
              {avgScore}
            </span>
            <span className="text-base text-dim">/10</span>
          </div>
          {overall?.summary && (
            <div className="mt-4 text-[15px] leading-[1.8] text-text">{overall.summary}</div>
          )}
          <div className="flex flex-wrap gap-3 mt-4">
            <Badge variant="secondary">共 {questions?.length || 0} 题</Badge>
            <Badge variant="secondary">已答 {answers?.filter((a) => a.answer).length || 0} 题</Badge>
          </div>
        </CardContent>
      </Card>

      <PointList title="薄弱点" items={overall?.new_weak_points} />
      <PointList title="亮点" items={overall?.new_strong_points} tone="green" />

      <div className="text-base font-semibold mb-3 text-text">逐题复盘</div>
      <div className="flex flex-col gap-4">
        {(questions || []).map((q) => {
          const s = scoreMap.get(String(q.id));
          const answer = answerMap.get(String(q.id));
          const isSkipped = !answer;

          if (isSkipped) {
            return (
              <Card key={q.id} className="opacity-50">
                <CardContent className="p-3 md:p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary/30">Q{q.id}</Badge>
                    <span className="text-sm text-dim">{q.question.slice(0, 50)}{q.question.length > 50 ? "..." : ""}</span>
                  </div>
                  <span className="text-[13px] text-dim">未作答</span>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={q.id} className="animate-fade-in">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary/30">Q{q.id}</Badge>
                    {q.focus_area && <Badge variant="secondary">{q.focus_area}</Badge>}
                  </div>
                  <ScorePill emptyLabel="--" score={s?.score} />
                </div>

                <div className="text-[15px] font-medium leading-relaxed mb-3">{q.question}</div>

                <div className="bg-hover rounded-lg px-3 py-3 md:px-4 mb-3">
                  <div className="text-xs font-semibold text-dim mb-1.5 opacity-70">你的回答</div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
                </div>

                {s?.assessment && s.assessment !== "未作答" && (
                  <div className="text-sm leading-[1.7] text-text mb-2">
                    <strong className="text-xs opacity-60">点评: </strong>{s.assessment}
                  </div>
                )}

                {s?.improvement && (
                  <div className="text-sm leading-[1.7] text-primary bg-primary/8 rounded-lg px-3 py-2.5 mb-2">
                    <strong className="text-xs opacity-70">改进建议: </strong>{s.improvement}
                  </div>
                )}

                {s?.understanding && s.understanding !== "未作答" && (
                  <div className="text-[13px] text-dim italic mt-1">理解程度: {s.understanding}</div>
                )}

                {Boolean(s?.key_missing?.length) && (
                  <div className="text-[13px] text-red leading-normal">遗漏关键点: {s?.key_missing?.join("、")}</div>
                )}

                {topic && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {refAnswers[q.id] ? (
                      <div className="text-sm leading-[1.8]">
                        <div className="text-xs font-semibold text-dim mb-2 flex items-center gap-1.5">
                          <BookOpen size={13} /> 参考答案
                        </div>
                        <div className="md-content bg-hover rounded-lg px-3.5 py-3">
                          <ReactMarkdown>{refAnswers[q.id]}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary"
                        onClick={() => handleRefAnswer(q.id)}
                        disabled={refLoading[q.id]}
                      >
                        <BookOpen size={13} />
                        {refLoading[q.id] ? "正在生成参考答案..." : "查看参考答案"}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ReviewObservations overall={overall} />
    </>
  );
}
