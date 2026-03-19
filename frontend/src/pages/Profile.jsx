import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = "/api";

function CollapsibleList({ items, limit, renderItem }) {
  const [expanded, setExpanded] = useState(false);
  const show = expanded ? items : items.slice(0, limit);
  const hasMore = items.length > limit;

  return (
    <div className="flex flex-col gap-2">
      {show.map((item, i) => renderItem(item, i))}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="bg-transparent border-none text-accent-light text-[13px] cursor-pointer py-1 text-left"
        >
          {expanded ? "收起" : `展开更多 (+${items.length - limit})`}
        </button>
      )}
    </div>
  );
}

function getScoreColor(score) {
  if (score >= 8) return "var(--green)";
  if (score >= 6) return "var(--accent-light)";
  if (score >= 4) return "#e2b93b";
  return "var(--red)";
}

function ScoreChart({ history }) {
  if (!history || history.length < 2) return null;

  const W = 700, H = 200;
  const PAD = { top: 20, right: 20, bottom: 32, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const points = history.map((h, i) => ({
    x: PAD.left + (i / (history.length - 1)) * innerW,
    y: PAD.top + innerH - (h.avg_score / 10) * innerH,
    score: h.avg_score,
    date: h.date,
    topic: h.topic || "简历",
    mode: h.mode,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD.top + innerH} L${points[0].x},${PAD.top + innerH} Z`;

  const yLabels = [0, 5, 10];
  const xIndices = history.length <= 5
    ? history.map((_, i) => i)
    : [0, Math.floor(history.length / 2), history.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {yLabels.map((v) => {
        const y = PAD.top + innerH - (v / 10) * innerH;
        return (
          <g key={v}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="var(--text-dim)" fontSize={11}>{v}</text>
          </g>
        );
      })}
      {xIndices.map((i) => (
        <text key={i} x={points[i].x} y={H - 6} textAnchor="middle" fill="var(--text-dim)" fontSize={11}>
          {history[i].date?.slice(5)}
        </text>
      ))}
      <path d={areaPath} fill="url(#chartGrad)" opacity={0.2} />
      <path d={linePath} fill="none" stroke="var(--accent-light)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill={p.mode === "resume" ? "var(--accent-light)" : "var(--green)"} stroke="var(--bg-card)" strokeWidth={2} />
          <title>{`${p.date} ${p.mode === "resume" ? "简历面试" : p.topic}: ${p.score}/10`}</title>
        </g>
      ))}
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-light)" />
          <stop offset="100%" stopColor="var(--accent-light)" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE}/profile`)
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-15 text-dim">加载中...</div>;

  const hasData = profile && (
    profile.stats?.total_sessions > 0 ||
    profile.stats?.total_answers > 0 ||
    (profile.weak_points || []).length > 0 ||
    (profile.strong_points || []).length > 0
  );

  if (!hasData) {
    return (
      <div className="flex-1 px-4 py-8 md:px-6 md:py-10 max-w-3xl mx-auto w-full">
        <div className="text-2xl md:text-[28px] font-bold mb-2">个人画像</div>
        <div className="text-center py-15 text-dim">
          <p>还没有面试数据</p>
          <p className="mt-3 text-sm">开始面试后，系统会实时分析你的每个回答，自动构建你的能力画像</p>
          <button className="mt-5 px-6 py-2.5 rounded-lg bg-accent text-white text-sm" onClick={() => navigate("/")}>
            开始第一场面试
          </button>
        </div>
      </div>
    );
  }

  const stats = profile.stats || {};
  const weakActive = (profile.weak_points || []).filter((w) => !w.improved);
  const weakImproved = (profile.weak_points || []).filter((w) => w.improved);

  return (
    <div className="flex-1 px-4 py-8 md:px-6 md:py-10 max-w-3xl mx-auto w-full">
      <div className="text-2xl md:text-[28px] font-bold mb-2">个人画像</div>
      <div className="text-sm text-dim mb-8">
        {stats.total_answers || 0} 次回答分析{stats.total_sessions ? ` | ${stats.total_sessions} 次完整面试` : ""} | 上次更新: {profile.updated_at?.slice(0, 16)}
      </div>

      {/* Stats */}
      <div className="mb-7">
        <div className="text-base font-semibold mb-3 flex items-center gap-2">练习统计</div>
        {/* Overview row */}
        <div className="flex gap-3 mb-3">
          <div className="flex-1 bg-hover rounded-lg p-4 text-center">
            <div className="text-[28px] font-bold text-accent-light">{stats.total_sessions}</div>
            <div className="text-xs text-dim mt-1">总练习次数</div>
          </div>
          <div className="flex-1 bg-hover rounded-lg p-4 text-center">
            <div className="text-[32px] font-bold text-green">{stats.avg_score || "-"}</div>
            <div className="text-xs text-dim mt-1">综合平均分</div>
          </div>
        </div>
        {/* Two mode columns */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 bg-hover rounded-lg p-3.5 border-l-[3px] border-l-accent-light">
            <div className="text-[13px] font-semibold text-accent-light mb-2.5">简历面试</div>
            <div className="flex gap-3">
              <div className="flex-1 text-center">
                <div className="text-[22px] font-bold text-accent-light">{stats.resume_sessions || 0}</div>
                <div className="text-[11px] text-dim mt-0.5">次数</div>
              </div>
              <div className="flex-1 text-center">
                <div className="text-[22px] font-bold text-accent-light">{stats.resume_avg_score ?? "-"}</div>
                <div className="text-[11px] text-dim mt-0.5">平均分</div>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-hover rounded-lg p-3.5 border-l-[3px] border-l-green">
            <div className="text-[13px] font-semibold text-green mb-2.5">专项训练</div>
            <div className="flex gap-3">
              <div className="flex-1 text-center">
                <div className="text-[22px] font-bold text-green">{stats.drill_sessions || 0}</div>
                <div className="text-[11px] text-dim mt-0.5">次数</div>
              </div>
              <div className="flex-1 text-center">
                <div className="text-[22px] font-bold text-green">{stats.drill_avg_score ?? "-"}</div>
                <div className="text-[11px] text-dim mt-0.5">平均分</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Score Trend */}
      {(stats.score_history || []).length >= 2 && (
        <div className="mb-7">
          <div className="text-base font-semibold mb-3 flex items-center gap-2">成长趋势</div>
          <div className="bg-card border border-border rounded-box px-4 py-5 md:px-6">
            <ScoreChart history={stats.score_history} />
          </div>
        </div>
      )}

      {/* Topic Mastery */}
      {Object.keys(profile.topic_mastery || {}).length > 0 && (
        <div className="mb-7">
          <div className="text-base font-semibold mb-3 flex items-center gap-2">领域掌握度</div>
          <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
            {Object.entries(profile.topic_mastery).map(([topic, data]) => (
              <div
                key={topic}
                className="px-4 py-3 rounded-lg bg-hover border border-transparent cursor-pointer transition-all hover:border-accent"
                onClick={() => navigate(`/profile/topic/${topic}`)}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm font-medium">{topic}</span>
                  <span className="text-xs text-dim">{data.score ?? (data.level ? data.level * 20 : 0)}/100 &rsaquo;</span>
                </div>
                <div className="h-1.5 rounded-sm bg-border overflow-hidden">
                  <div
                    className="h-full rounded-sm bg-gradient-to-r from-accent to-accent-light transition-[width] duration-500 ease-in-out"
                    style={{ width: `${data.score ?? (data.level ? data.level * 20 : 0)}%` }}
                  />
                </div>
                {data.notes && <div className="text-xs text-dim mt-1.5">{data.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weak & Strong side by side */}
      {(weakActive.length > 0 || (profile.strong_points || []).length > 0) && (
        <div className="flex flex-col md:flex-row gap-3 mb-7">
          {weakActive.length > 0 && (
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold mb-3 flex items-center gap-2">
                待改进 <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-red/15 text-red">{weakActive.length}</span>
              </div>
              <CollapsibleList items={weakActive} limit={3} renderItem={(w, i) => (
                <div key={i} className="flex justify-between items-center px-3.5 py-2.5 rounded-lg bg-hover text-sm">
                  <span className="flex-1">{w.point}</span>
                  <div className="flex items-center gap-2 text-xs text-dim shrink-0">
                    {w.topic && <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-accent/15 text-accent-light">{w.topic}</span>}
                    <span>出现 {w.times_seen} 次</span>
                  </div>
                </div>
              )} />
            </div>
          )}
          {(profile.strong_points || []).length > 0 && (
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold mb-3 flex items-center gap-2">强项</div>
              <CollapsibleList items={profile.strong_points} limit={3} renderItem={(s, i) => (
                <div key={i} className="flex justify-between items-center px-3.5 py-2.5 rounded-lg bg-hover text-sm border-l-[3px] border-l-green">
                  <span>{s.point}</span>
                  {s.topic && <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-accent/15 text-accent-light">{s.topic}</span>}
                </div>
              )} />
            </div>
          )}
        </div>
      )}

      {/* Improved Points */}
      {weakImproved.length > 0 && (
        <div className="mb-7">
          <div className="text-base font-semibold mb-3 flex items-center gap-2">
            已改善 <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-green/15 text-green">{weakImproved.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {weakImproved.map((w, i) => (
              <div key={i} className="flex justify-between items-center px-3.5 py-2.5 rounded-lg bg-hover text-sm opacity-70">
                <span className="flex-1 line-through">{w.point}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-green/15 text-green">已改善</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thinking Patterns */}
      {((profile.thinking_patterns?.strengths || []).length > 0 ||
        (profile.thinking_patterns?.gaps || []).length > 0) && (
        <div className="mb-7">
          <div className="text-base font-semibold mb-3 flex items-center gap-2">思维模式</div>
          <div className="flex flex-col md:flex-row gap-3">
            {(profile.thinking_patterns.strengths || []).length > 0 && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-green mb-1.5">优势</div>
                <CollapsibleList items={profile.thinking_patterns.strengths} limit={3} renderItem={(s, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg text-sm bg-green/8 border-l-[3px] border-l-green mb-1.5">{s}</div>
                )} />
              </div>
            )}
            {(profile.thinking_patterns.gaps || []).length > 0 && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-red mb-1.5">短板</div>
                <CollapsibleList items={profile.thinking_patterns.gaps} limit={3} renderItem={(g, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg text-sm bg-red/8 border-l-[3px] border-l-red mb-1.5">{g}</div>
                )} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Communication */}
      {profile.communication?.style && (
        <div className="mb-7">
          <div className="text-base font-semibold mb-3 flex items-center gap-2">沟通风格分析</div>
          <div className="p-4 bg-hover rounded-lg text-sm leading-[1.8]">
            <div>{profile.communication.style}</div>
            {(profile.communication.habits || []).length > 0 && (
              <div className="mt-3">
                <strong className="text-[13px]">习惯</strong>
                <ul className="mt-1.5 pl-4.5 leading-[1.8]">
                  {profile.communication.habits.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
            {(profile.communication.suggestions || []).length > 0 && (
              <div className="mt-3">
                <strong className="text-[13px]">建议</strong>
                <ul className="mt-1.5 pl-4.5 leading-[1.8]">
                  {profile.communication.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
