import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  getProfile,
  getTopics,
  getTopicRetrospective,
  getTopicHistory,
} from "../api/interview";

function getScoreColor(score) {
  if (score >= 8) return "var(--green)";
  if (score >= 6) return "var(--accent-light)";
  if (score >= 4) return "#e2b93b";
  return "var(--red)";
}

export default function TopicDetail() {
  const { topic } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [topicInfo, setTopicInfo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [retrospective, setRetrospective] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getProfile(), getTopics(), getTopicHistory(topic)])
      .then(([prof, topics, hist]) => {
        setProfile(prof);
        setTopicInfo(topics[topic] || { name: topic, icon: "" });
        setSessions(hist);
        const cached = prof?.topic_mastery?.[topic]?.retrospective;
        if (cached) setRetrospective(cached);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [topic]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await getTopicRetrospective(topic);
      setRetrospective(res.retrospective);
    } catch (err) {
      alert("生成失败: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="text-center py-15 text-dim">加载中...</div>;

  const mastery = profile?.topic_mastery?.[topic] || {};

  return (
    <div className="flex-1 px-4 py-8 md:px-6 md:py-10 max-w-3xl mx-auto w-full">
      <div
        className="text-sm text-dim cursor-pointer mb-4 inline-block"
        onClick={() => navigate("/profile")}
      >
        &larr; 返回画像
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 md:gap-4 mb-8">
        <div className="text-4xl">{topicInfo?.icon || "📝"}</div>
        <div className="flex-1">
          <div className="text-2xl md:text-[28px] font-bold">{topicInfo?.name || topic}</div>
          <div className="text-sm text-dim mt-1">
            {sessions.length} 次训练记录
            {mastery.last_assessed && ` | 上次评估: ${mastery.last_assessed.slice(0, 10)}`}
          </div>
        </div>
      </div>

      {/* Mastery bar */}
      {(mastery.score > 0 || mastery.level > 0) && (
        <div className="flex items-center gap-3 md:gap-4 px-4 py-4 md:px-5 bg-card border border-border rounded-box mb-6">
          <div>
            <span className="text-[32px] font-bold text-accent-light">{mastery.score ?? (mastery.level ? mastery.level * 20 : 0)}</span>
            <span className="text-base text-dim">/100</span>
          </div>
          <div className="flex-1 h-2 rounded bg-border overflow-hidden">
            <div
              className="h-full rounded bg-gradient-to-r from-accent to-accent-light transition-[width] duration-500 ease-in-out"
              style={{ width: `${mastery.score ?? (mastery.level ? mastery.level * 20 : 0)}%` }}
            />
          </div>
          {mastery.notes && <div className="text-[13px] text-dim ml-2 md:ml-4 max-w-[200px] hidden md:block">{mastery.notes}</div>}
        </div>
      )}

      {/* Retrospective */}
      <div className="mb-7">
        <div className="text-base font-semibold mb-3 flex items-center justify-between">
          <span>领域回顾</span>
          {retrospective && (
            <button
              className="px-3.5 py-1.5 rounded-lg bg-hover border border-border text-dim text-[13px] cursor-pointer transition-all"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? "生成中..." : "刷新回顾"}
            </button>
          )}
        </div>

        {retrospective ? (
          <div className="bg-card border border-border rounded-box px-5 py-6 md:px-6 leading-[1.8] text-[15px]">
            <div className="md-content">
              <ReactMarkdown>{retrospective}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-box px-5 py-10 text-center text-dim">
            <p>{sessions.length === 0 ? "该领域暂无训练记录" : "还没有生成领域回顾"}</p>
            {sessions.length > 0 && (
              <button
                className="mt-4 px-6 py-2.5 rounded-lg bg-gradient-to-br from-accent to-accent-light text-white text-sm font-medium"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? "正在分析历史记录..." : "生成领域回顾"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Session history */}
      <div className="mb-7">
        <div className="text-base font-semibold mb-3">训练历史</div>
        {sessions.length === 0 ? (
          <div className="bg-card border border-border rounded-box px-5 py-10 text-center text-dim">
            该领域暂无训练记录
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...sessions].reverse().map((s) => {
              const scores = s.scores || [];
              const validScores = scores.map((sc) => sc.score).filter((v) => typeof v === "number");
              const avg = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : null;

              return (
                <div
                  key={s.session_id}
                  className="flex items-center justify-between px-4 py-3.5 md:px-4.5 bg-card border border-border rounded-box cursor-pointer transition-all hover:border-accent"
                  onClick={() => navigate(`/review/${s.session_id}`)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{s.created_at?.slice(0, 10)}</span>
                    {avg && <span className="text-[13px]" style={{ color: getScoreColor(Number(avg)) }}>{avg}/10</span>}
                  </div>
                  <span className="text-xs text-dim">#{s.session_id}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
