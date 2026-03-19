import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getHistory, deleteSession, getInterviewTopics } from "../api/interview";

const PAGE_SIZE = 15;

function getScoreColor(score) {
  if (score >= 8) return { bg: "rgba(0,184,148,0.15)", color: "var(--green)" };
  if (score >= 6) return { bg: "rgba(108,92,231,0.15)", color: "var(--accent-light)" };
  if (score >= 4) return { bg: "rgba(253,203,110,0.2)", color: "#e2b93b" };
  return { bg: "rgba(225,112,85,0.15)", color: "var(--red)" };
}

const MODE_BADGES = {
  resume: { text: "简历面试", cls: "bg-accent/15 text-accent-light" },
  topic_drill: { text: "专项训练", cls: "bg-green/15 text-green" },
};

export default function History() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [modeFilter, setModeFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [topics, setTopics] = useState([]);

  useEffect(() => { getInterviewTopics().then(setTopics).catch(() => {}); }, []);

  const fetchSessions = useCallback((reset) => {
    const offset = reset ? 0 : sessions.length;
    const setter = reset ? setLoading : setLoadingMore;
    setter(true);
    const mode = modeFilter === "all" ? null : modeFilter;
    const topic = topicFilter === "all" ? null : topicFilter;
    getHistory(PAGE_SIZE, offset, mode, topic)
      .then((data) => {
        setSessions((prev) => (reset ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setter(false));
  }, [modeFilter, topicFilter, sessions.length]);

  useEffect(() => { fetchSessions(true); }, [modeFilter, topicFilter]); // eslint-disable-line

  const handleModeChange = (mode) => {
    if (mode === "resume") setTopicFilter("all");
    setModeFilter(mode);
  };

  const handleDelete = async (e, sessionId) => {
    e.stopPropagation();
    if (!window.confirm("确定要删除这条记录吗？")) return;
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      setTotal((prev) => prev - 1);
    } catch (err) {
      alert("删除失败: " + err.message);
    }
  };

  if (loading) return <div className="text-center py-15 text-dim">加载中...</div>;

  const hasFilters = modeFilter !== "all" || topicFilter !== "all";

  return (
    <div className="flex-1 px-4 py-8 md:px-6 md:py-10 max-w-3xl mx-auto w-full">
      {/* Title row */}
      <div className="flex items-baseline justify-between mb-5">
        <div className="text-2xl md:text-[28px] font-bold">历史记录</div>
        <div className="text-sm text-dim">共 {total} 条记录</div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {[
          { key: "all", label: "全部" },
          { key: "resume", label: "简历面试" },
          { key: "topic_drill", label: "专项训练" },
        ].map((m) => (
          <button
            key={m.key}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium border transition-all cursor-pointer
              ${modeFilter === m.key ? "bg-hover text-text border-accent" : "bg-transparent text-dim border-border hover:bg-hover"}`}
            onClick={() => handleModeChange(m.key)}
          >
            {m.label}
          </button>
        ))}

        {modeFilter !== "resume" && topics.length > 0 && (
          <>
            <div className="w-px h-5 bg-border mx-1" />
            <select
              className="px-3.5 py-1.5 rounded-lg text-[13px] bg-input text-text border border-border outline-none cursor-pointer"
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
            >
              <option value="all">全部领域</option>
              {topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Session list */}
      {sessions.length === 0 ? (
        <div className="text-center py-15 text-dim">
          {hasFilters ? "没有匹配的记录，试试调整筛选条件" : "还没有面试记录，去首页开始一场面试吧"}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {sessions.map((s) => {
              const badge = MODE_BADGES[s.mode] || MODE_BADGES.resume;
              const hasScore = s.avg_score != null;
              const sc = hasScore ? getScoreColor(s.avg_score) : null;

              return (
                <div
                  key={s.session_id}
                  className="flex items-center justify-between px-4 py-3.5 md:px-5 bg-card border border-border rounded-box cursor-pointer transition-all hover:border-accent"
                  onClick={() => navigate(`/review/${s.session_id}`)}
                >
                  <div className="flex items-center gap-2 md:gap-2.5 min-w-0 flex-1 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium shrink-0 ${badge.cls}`}>{badge.text}</span>
                    {s.topic && <span className="text-sm text-text font-medium truncate">{s.topic}</span>}
                    <span className="text-xs text-dim shrink-0 hidden md:inline">#{s.session_id}</span>
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 shrink-0">
                    {hasScore ? (
                      <span className="px-2.5 py-1 rounded-md text-[13px] font-semibold min-w-[52px] text-center" style={{ background: sc.bg, color: sc.color }}>
                        {s.avg_score}/10
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-md text-[13px] text-dim bg-hover min-w-[52px] text-center">--</span>
                    )}
                    <span className="text-[13px] text-dim whitespace-nowrap hidden md:inline">{s.created_at?.slice(0, 10)}</span>
                    <button
                      className="px-2 py-1 rounded-md bg-transparent text-dim text-[15px] opacity-50 transition-all hover:text-red hover:opacity-100"
                      title="删除"
                      onClick={(e) => handleDelete(e, s.session_id)}
                    >
                      &#x2715;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {sessions.length < total && (
            <button
              className="block w-full py-3 mt-4 rounded-box bg-hover text-dim text-sm border border-border cursor-pointer transition-all hover:bg-card"
              onClick={() => fetchSessions(false)}
              disabled={loadingMore}
            >
              {loadingMore ? "加载中..." : `加载更多 (${sessions.length}/${total})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
