import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { getReview } from "../api/interview";

function getScoreColor(score) {
  if (score >= 8) return { bg: "rgba(0,184,148,0.15)", color: "var(--green)" };
  if (score >= 6) return { bg: "rgba(108,92,231,0.15)", color: "var(--accent-light)" };
  if (score >= 4) return { bg: "rgba(253,203,110,0.2)", color: "#e2b93b" };
  return { bg: "rgba(225,112,85,0.15)", color: "var(--red)" };
}

const DIMENSION_LABELS = {
  technical_depth: "技术深度",
  project_articulation: "项目表达",
  communication: "表达能力",
  problem_solving: "问题解决",
};

function DimensionScores({ dimensionScores, avgScore }) {
  if (!dimensionScores) return null;
  const entries = Object.entries(DIMENSION_LABELS).filter(([k]) => dimensionScores[k] != null);
  if (!entries.length) return null;

  return (
    <div className="bg-card border border-border rounded-2xl px-5 py-6 md:px-7 mb-6">
      <div className="text-lg font-semibold mb-4">
        维度评分
        {avgScore != null && (
          <span className="text-sm font-normal text-dim ml-3">综合 {avgScore}/10</span>
        )}
      </div>
      {entries.map(([key, label]) => {
        const score = dimensionScores[key];
        const color = score >= 8 ? "var(--green)" : score >= 6 ? "var(--accent-light)" : score >= 4 ? "#e2b93b" : "var(--red)";
        return (
          <div key={key} className="flex items-center gap-3 mb-2.5">
            <div className="w-[80px] md:w-[100px] text-[13px] text-dim text-right shrink-0">{label}</div>
            <div className="flex-1 h-2 rounded bg-border overflow-hidden">
              <div className="h-full rounded transition-[width] duration-500 ease-in-out" style={{ width: `${score * 10}%`, background: color }} />
            </div>
            <div className="w-9 text-sm font-semibold text-right shrink-0" style={{ color }}>{score}</div>
          </div>
        );
      })}
    </div>
  );
}

function DrillReview({ scores, overall, questions, answers }) {
  const answerMap = {};
  for (const a of (answers || [])) answerMap[a.question_id] = a.answer;
  const scoreMap = {};
  for (const s of (scores || [])) scoreMap[s.question_id] = s;

  const avgScore = overall?.avg_score || "-";

  return (
    <>
      {/* Overall summary */}
      <div className="bg-card border border-border rounded-2xl px-5 py-6 md:px-8 md:py-7 mb-6">
        <div className="text-lg font-semibold mb-3">整体评价</div>
        <div>
          <span className="inline-block text-[32px] font-bold mr-2" style={{ color: typeof avgScore === "number" ? getScoreColor(avgScore).color : "var(--text)" }}>
            {avgScore}
          </span>
          <span className="text-base text-dim">/10</span>
        </div>
        {overall?.summary && (
          <div className="mt-4 text-[15px] leading-[1.8] text-text">{overall.summary}</div>
        )}
        <div className="flex flex-wrap gap-4 mt-4">
          <span className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-hover text-dim">
            共 {questions?.length || 0} 题
          </span>
          <span className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-hover text-dim">
            已答 {answers?.filter((a) => a.answer).length || 0} 题
          </span>
        </div>
      </div>

      {/* Weak points */}
      {overall?.new_weak_points?.length > 0 && (
        <>
          <div className="text-base font-semibold mb-4 mt-2 text-text">薄弱点</div>
          <div className="flex flex-col gap-1.5 mb-4">
            {overall.new_weak_points.map((wp, i) => (
              <div key={i} className="px-3 py-2 rounded-lg text-[13px] text-text bg-red/8 border border-red/20">
                {typeof wp === "string" ? wp : wp.point || JSON.stringify(wp)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Strong points */}
      {overall?.new_strong_points?.length > 0 && (
        <>
          <div className="text-base font-semibold mb-4 mt-2 text-text">亮点</div>
          <div className="flex flex-col gap-1.5 mb-4">
            {overall.new_strong_points.map((sp, i) => (
              <div key={i} className="px-3 py-2 rounded-lg text-[13px] text-text bg-green/8 border border-green/20">
                {typeof sp === "string" ? sp : sp.point || JSON.stringify(sp)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Per-question cards */}
      <div className="text-base font-semibold mb-4 mt-2 text-text">逐题复盘</div>
      {(questions || []).map((q) => {
        const s = scoreMap[q.id] || {};
        const answer = answerMap[q.id];
        const isSkipped = !answer;
        const score = s.score;
        const sc = typeof score === "number" ? getScoreColor(score) : { bg: "var(--bg-hover)", color: "var(--text-dim)" };

        if (isSkipped) {
          return (
            <div key={q.id} className="bg-card border border-border rounded-xl px-4 py-3 md:px-6 mb-4 opacity-50 flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-accent-light bg-accent/12 px-2.5 py-0.5 rounded-md">Q{q.id}</span>
                <span className="text-sm text-dim">{q.question.slice(0, 50)}{q.question.length > 50 ? "..." : ""}</span>
              </div>
              <span className="text-[13px] text-dim">未作答</span>
            </div>
          );
        }

        return (
          <div key={q.id} className="bg-card border border-border rounded-xl px-4 py-5 md:px-6 mb-4 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-accent-light bg-accent/12 px-2.5 py-0.5 rounded-md">Q{q.id}</span>
                {q.focus_area && <span className="text-xs text-dim bg-hover px-2 py-0.5 rounded">{q.focus_area}</span>}
              </div>
              <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ background: sc.bg, color: sc.color }}>
                {score ?? "-"}/10
              </span>
            </div>

            <div className="text-[15px] font-medium leading-relaxed mb-3">{q.question}</div>

            <div className="bg-hover rounded-lg px-3 py-3 md:px-4 mb-3">
              <div className="text-xs font-semibold text-dim mb-1.5 opacity-70">你的回答</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
            </div>

            {s.assessment && s.assessment !== "未作答" && (
              <div className="text-sm leading-[1.7] text-text mb-2">
                <strong className="text-xs opacity-60">点评: </strong>{s.assessment}
              </div>
            )}

            {s.improvement && (
              <div className="text-sm leading-[1.7] text-accent-light bg-accent/8 rounded-lg px-3 py-2.5 md:px-3.5 mb-2">
                <strong className="text-xs opacity-70">改进建议: </strong>{s.improvement}
              </div>
            )}

            {s.understanding && s.understanding !== "未作答" && (
              <div className="text-[13px] text-dim italic mt-1">理解程度: {s.understanding}</div>
            )}

            {s.key_missing?.length > 0 && (
              <div className="text-[13px] text-red leading-normal">遗漏关键点: {s.key_missing.join("、")}</div>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function Review() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const stateData = location.state || {};
  const isDrill = stateData.mode === "topic_drill";

  const [review, setReview] = useState(stateData.review || null);
  const [scores, setScores] = useState(stateData.scores || null);
  const [overall, setOverall] = useState(stateData.overall || null);
  const [questions, setQuestions] = useState(stateData.questions || []);
  const [answers, setAnswers] = useState(stateData.answers || []);
  const [messages, setMessages] = useState(stateData.messages || []);
  const [mode, setMode] = useState(stateData.mode || null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [loading, setLoading] = useState(!review && !scores);

  useEffect(() => {
    if (!review && !scores) {
      setLoading(true);
      getReview(sessionId)
        .then((data) => {
          setReview(data.review);
          if (data.scores) setScores(data.scores);
          if (data.questions) setQuestions(data.questions);
          if (data.transcript) {
            setMessages(data.transcript);
            if (data.mode === "topic_drill" && data.questions) {
              const userMsgs = data.transcript.filter((m) => m.role === "user");
              const ans = data.questions.map((q, i) => ({ question_id: q.id, answer: userMsgs[i]?.content || "" }));
              setAnswers(ans);
            }
          }
          if (data.mode) setMode(data.mode);
          if (data.overall && Object.keys(data.overall).length) {
            setOverall(data.overall);
          } else if (data.weak_points) {
            const wp = Array.isArray(data.weak_points) ? data.weak_points : [];
            if (wp.length) setOverall((prev) => ({ ...prev, new_weak_points: wp }));
          }
        })
        .catch((err) => setReview("加载失败: " + err.message))
        .finally(() => setLoading(false));
    }
  }, [sessionId]);

  if (loading) {
    return <div className="text-center py-15 text-dim">加载复盘报告中...</div>;
  }

  const showDrill = isDrill || (mode === "topic_drill" && (scores || questions.length > 0));

  return (
    <div className="flex-1 px-4 py-8 md:px-6 md:py-10 max-w-3xl mx-auto w-full">
      <div className="mb-8">
        <div className="text-2xl md:text-[28px] font-bold mb-2">{showDrill ? "训练复盘" : "面试复盘"}</div>
        <div className="text-sm text-dim">Session: {sessionId}</div>
      </div>

      {showDrill ? (
        <DrillReview scores={scores} overall={overall} questions={questions} answers={answers} />
      ) : (
        <>
          <DimensionScores
            dimensionScores={stateData.dimension_scores || overall?.dimension_scores}
            avgScore={stateData.avg_score ?? overall?.avg_score}
          />
          <div className="bg-card border border-border rounded-box px-5 py-6 md:px-8 leading-[1.8] text-[15px]">
            <div className="md-content">
              <ReactMarkdown>{review || ""}</ReactMarkdown>
            </div>
          </div>

          {messages.length > 0 && (
            <>
              <button
                className="mt-6 mr-3 px-5 py-2.5 rounded-box bg-transparent text-accent-light text-sm border border-border cursor-pointer"
                onClick={() => setShowTranscript(!showTranscript)}
              >
                {showTranscript ? "收起面试记录" : "查看面试记录"}
              </button>
              {showTranscript && (
                <div className="mt-4 bg-card border border-border rounded-box px-4 py-5 md:px-6 max-h-[500px] overflow-y-auto">
                  {messages.map((msg, i) => (
                    <div key={i} className="py-2 border-b border-border text-sm leading-relaxed">
                      <strong style={{ color: msg.role === "user" ? "var(--accent-light)" : "var(--green)" }}>
                        {msg.role === "user" ? "你" : "面试官"}:
                      </strong>{" "}
                      {msg.content}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <button
        className="inline-block mt-6 px-6 py-2.5 rounded-box bg-hover text-text text-sm border border-border cursor-pointer"
        onClick={() => navigate("/")}
      >
        返回首页
      </button>
    </div>
  );
}
