import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Gauge,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { getTopicIcon } from "../utils/topicIcons";
import { getProfile, getTopicHistory, getTopicRetrospective, getTopics } from "../api/interview";
import useTaskStatus from "../hooks/useTaskStatus";
import { parseRetrospectiveSections, selectRetrospectiveSections } from "../lib/retrospectiveSections";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PageContainer from "@/components/PageContainer";
import ScorePill from "@/components/ScorePill";

const MODE_BADGES = {
  resume: { text: "简历面试", variant: "default" },
  topic_drill: { text: "专项训练", variant: "success" },
  jd_prep: { text: "JD 备面", variant: "blue" },
  recording: { text: "录音复盘", variant: "blue" },
};

export default function TopicDetail() {
  const { topic } = useParams();
  const navigate = useNavigate();
  const { startTask } = useTaskStatus();

  const [profile, setProfile] = useState(null);
  const [topicInfo, setTopicInfo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [retrospective, setRetrospective] = useState(null);
  const [showFullRetrospective, setShowFullRetrospective] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadingTimer = window.setTimeout(() => {
      if (!cancelled) setLoading(true);
    }, 0);

    Promise.all([getProfile(), getTopics(), getTopicHistory(topic)])
      .then(([prof, topics, hist]) => {
        if (cancelled) return;
        setProfile(prof);
        setTopicInfo(topics[topic] || { name: topic, icon: "" });
        setSessions(Array.isArray(hist) ? hist : []);
        const cached = prof?.topic_mastery?.[topic]?.retrospective;
        if (cached) setRetrospective(cached);
        else setRetrospective(null);
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(loadingTimer);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimer);
    };
  }, [topic]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await getTopicRetrospective(topic);
      startTask(res.task_id, "retrospective", `${topicInfo?.name || topic} 领域回顾生成中`);
    } catch (err) {
      toast.error("生成失败: " + (err?.message || "未知错误"));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <PageContainer size="wide" className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {[...Array(6)].map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-[24px]" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.24fr)_minmax(340px,0.86fr)]">
          <Skeleton className="h-[540px] rounded-[28px]" />
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-[28px]" />
            <Skeleton className="h-60 rounded-[28px]" />
            <Skeleton className="h-52 rounded-[28px]" />
          </div>
        </div>
      </PageContainer>
    );
  }

  const mastery = profile?.topic_mastery?.[topic] || {};
  const masteryScore = getMasteryScore(mastery);
  const sessionsDesc = [...sessions].sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
  const latestSession = sessionsDesc[0] || null;
  const previousSession = sessionsDesc[1] || null;
  const latestAvg = getSessionAverage(latestSession);
  const previousAvg = getSessionAverage(previousSession);
  const trendDelta = latestAvg != null && previousAvg != null ? roundScore(latestAvg - previousAvg) : null;
  const totalAnswered = sessions.reduce((sum, session) => sum + getAnsweredCount(session?.scores), 0);
  const retrospectiveAt = mastery.retrospective_at;
  const retrospectiveSections = parseRetrospectiveSections(retrospective);
  const visibleSections = retrospectiveSections.slice(0, 4);
  const { diagnosis: diagnosisSection, nextSteps: nextStepsSection } = selectRetrospectiveSections(retrospectiveSections);
  const diagnosisText = mastery.notes
    || extractPlainText(diagnosisSection?.markdown, 180)
    || "还没有形成稳定的阶段判断。";
  const latestSummary = extractSummarySnippet(latestSession?.review, latestSession?.overall);
  const actionText = extractPlainText(nextStepsSection?.markdown, 180)
    || "先把最近一次最低分题重新讲通，再继续新增题目。";

  const profileWeaknesses = (profile?.weak_points || [])
    .filter((item) => item.topic === topic && !item.improved)
    .map((item) => ({
      point: item.point,
      count: item.times_seen || 1,
      lastSeen: item.last_seen || item.first_seen,
    }));
  const sessionWeaknesses = sessionsDesc.flatMap((session) => {
    const items = session?.overall?.new_weak_points?.length ? session.overall.new_weak_points : session?.weak_points || [];
    return items.map((item) => ({
      point: normalizePoint(item),
      count: 1,
      lastSeen: session.created_at,
    }));
  });
  const recurringWeaknesses = buildPointFrequency([...profileWeaknesses, ...sessionWeaknesses]).slice(0, 6);

  const profileStrengths = (profile?.strong_points || [])
    .filter((item) => item.topic === topic)
    .map((item) => ({
      point: item.point,
      count: item.times_seen || 1,
      lastSeen: item.last_seen || item.first_seen,
    }));
  const sessionStrengths = sessionsDesc.flatMap((session) =>
    (session?.overall?.new_strong_points || []).map((item) => ({
      point: normalizePoint(item),
      count: 1,
      lastSeen: session.created_at,
    }))
  );
  const recurringStrengths = buildPointFrequency([...profileStrengths, ...sessionStrengths]).slice(0, 6);

  return (
    <PageContainer size="wide">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm text-dim transition-colors hover:text-text"
        onClick={() => navigate("/profile")}
      >
        <ArrowLeft size={16} />
        返回画像
      </button>

      <div className="mt-3 flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-border/80 bg-card/85 text-dim">
              {getTopicIcon(topicInfo?.icon, 30)}
            </div>

            <div className="min-w-0">
              <h1 className="text-3xl font-display font-bold tracking-tight md:text-4xl">
                {topicInfo?.name || topic}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-dim">
                <span>{sessions.length} 次训练记录</span>
                {latestSession?.created_at && <span>最后训练 {formatMinute(latestSession.created_at)}</span>}
                {mastery.last_assessed && <span>上次评估 {formatMinute(mastery.last_assessed)}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {masteryScore != null && (
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[12px]">
              掌握度 {masteryScore}/100
            </Badge>
          )}
          {retrospectiveAt && (
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-[12px]">
              回顾更新 {formatShortDate(retrospectiveAt)}
            </Badge>
          )}
          {retrospective && (
            <Button variant="outline" onClick={() => setShowFullRetrospective(true)}>
              查看原文
            </Button>
          )}
          {sessions.length > 0 && (
            <Button
              variant={retrospective ? "outline" : "gradient"}
              onClick={handleGenerate}
              disabled={generating}
            >
              <RefreshCw className={cn(generating && "animate-spin")} />
              {generating ? "生成中..." : retrospective ? "刷新回顾" : "生成回顾"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SummaryStat
          icon={<Gauge size={18} />}
          label="掌握度"
          value={masteryScore != null ? `${masteryScore}/100` : "--"}
          hint={mastery.notes || "暂无掌握度说明"}
          accentClassName="text-primary"
          panelClassName="bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.03))]"
        />
        <SummaryStat
          icon={<Target size={18} />}
          label="训练次数"
          value={sessions.length}
          hint="该领域累计"
          accentClassName="text-text"
        />
        <SummaryStat
          icon={<TrendingUp size={18} />}
          label="最近均分"
          value={latestAvg != null ? `${latestAvg}/10` : "--"}
          hint={latestSession?.created_at ? formatShortDate(latestSession.created_at) : "暂无评分"}
          accentClassName={getScoreTextClass(latestAvg)}
        />
        <SummaryStat
          icon={<Sparkles size={18} />}
          label="趋势变化"
          value={formatDelta(trendDelta)}
          hint={trendDelta == null ? "至少需要 2 次训练" : "相比上一条评分记录"}
          accentClassName={getDeltaClass(trendDelta)}
        />
        <SummaryStat
          icon={<CalendarDays size={18} />}
          label="已答题数"
          value={totalAnswered}
          hint="历史累计"
          accentClassName="text-text"
        />
        <SummaryStat
          icon={<CircleAlert size={18} />}
          label="待攻克点"
          value={recurringWeaknesses.length}
          hint={recurringWeaknesses.length ? "重复暴露" : "暂未沉淀"}
          accentClassName={recurringWeaknesses.length ? "text-red" : "text-text"}
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.24fr)_minmax(340px,0.86fr)] 2xl:grid-cols-[minmax(0,1.32fr)_minmax(380px,0.82fr)]">
        <div className="space-y-4">
          <WorkbenchPanel
            icon={<CalendarDays size={18} />}
            title="训练时间线"
            caption="这里直接看每次训练的结论、答题量和高低分题，不再只给日期列表。"
            action={(
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
                最新记录在上
              </Badge>
            )}
          >
            {sessionsDesc.length === 0 ? (
              <DashboardEmpty message="该领域暂无训练记录。" />
            ) : (
              <div className="space-y-3">
                {sessionsDesc.map((session, index) => (
                  <SessionTimelineCard
                    key={session.session_id}
                    index={index}
                    session={session}
                    onOpen={() => navigate(`/review/${session.session_id}`)}
                  />
                ))}
              </div>
            )}
          </WorkbenchPanel>

          <WorkbenchPanel
            icon={<Sparkles size={18} />}
            title="训练回顾拆解"
            caption="AI 回顾先拆成模块化信息块，再决定要不要展开全文。"
          >
            {visibleSections.length > 0 ? (
              <div className="space-y-3">
                {visibleSections.map((section, index) => (
                  <div
                    key={`${section.title}-${index}`}
                    className="rounded-[22px] border border-border/80 bg-background/70 p-4"
                  >
                    <div className="text-sm font-semibold text-text">{section.title}</div>
                    <div className="md-content mt-2 text-sm leading-6 text-text">
                      <ReactMarkdown>{section.markdown}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DashboardEmpty
                message={sessions.length === 0 ? "还没有训练数据可拆解。" : "先生成一次领域回顾，这里会自动拆成模块。"}
                action={sessions.length > 0 ? (
                  <Button variant="outline" onClick={handleGenerate} disabled={generating}>
                    {generating ? "生成中..." : "生成回顾"}
                  </Button>
                ) : null}
              />
            )}
          </WorkbenchPanel>
        </div>

        <div className="space-y-4">
          <WorkbenchPanel
            icon={<Gauge size={18} />}
            title="当前诊断"
            caption="把掌握度、最近表现和当前动作集中放在一处。"
          >
            <div className="space-y-3">
              <InsightBlock
                title="掌握度判断"
                value={masteryScore != null ? `${masteryScore}/100` : "暂无评分"}
                body={diagnosisText}
              />
              <InsightBlock
                title="最新训练结论"
                value={latestAvg != null ? `${latestAvg}/10` : "--"}
                body={latestSummary || "最近一次训练还没有结构化总结。"}
              />
              <InsightBlock
                title="当前动作"
                body={actionText}
                tone="accent"
              />
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel
            icon={<CircleAlert size={18} />}
            title="持续薄弱点"
            caption="优先看重复暴露的问题，而不是只看最近一次失分。"
          >
            <SignalList
              items={recurringWeaknesses}
              tone="red"
              emptyText="还没有沉淀出重复暴露的问题。"
            />
          </WorkbenchPanel>

          <WorkbenchPanel
            icon={<Trophy size={18} />}
            title="稳定优势"
            caption="这些点已经形成正向信号，下一轮训练别把它们丢掉。"
          >
            <SignalList
              items={recurringStrengths}
              tone="green"
              emptyText="还没有形成稳定优势信号。"
            />
          </WorkbenchPanel>
        </div>
      </div>

      <FullRetrospectiveModal
        open={showFullRetrospective}
        retrospective={retrospective}
        sectionCount={retrospectiveSections.length}
        updatedAt={retrospectiveAt}
        topicName={topicInfo?.name || topic}
        onClose={() => setShowFullRetrospective(false)}
      />
    </PageContainer>
  );
}

function SummaryStat({ icon, label, value, hint, accentClassName, panelClassName }) {
  return (
    <Card className={cn("rounded-[24px] border-border/80 bg-card/88", panelClassName)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim/80">{label}</div>
            <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", accentClassName)}>
              {value}
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-background/70 p-2.5 text-dim">
            {icon}
          </div>
        </div>

        <div className="mt-3 text-sm leading-6 text-dim">{hint}</div>
      </CardContent>
    </Card>
  );
}

function WorkbenchPanel({ icon, title, caption, action, children }) {
  return (
    <Card className="rounded-[28px] border-border/80 bg-card/88">
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-text">
              <span className="text-dim">{icon}</span>
              <span>{title}</span>
            </div>
            {caption && <div className="mt-1 text-sm leading-6 text-dim">{caption}</div>}
          </div>
          {action}
        </div>

        <div className="mt-5">{children}</div>
      </CardContent>
    </Card>
  );
}

function SessionTimelineCard({ session, index, onOpen }) {
  const avg = getSessionAverage(session);
  const answeredCount = getAnsweredCount(session?.scores);
  const badge = MODE_BADGES[session.mode] || MODE_BADGES.resume;
  const summary = extractSummarySnippet(session.review, session.overall);
  const { best, weak } = getQuestionExtremes(session?.scores);
  const weakCount = session?.overall?.new_weak_points?.length || session?.weak_points?.length || 0;
  const strongCount = session?.overall?.new_strong_points?.length || 0;

  return (
    <Card
      className="group cursor-pointer rounded-[24px] border-border/75 bg-card/92 transition-all hover:border-primary/35 hover:shadow-sm"
      onClick={onOpen}
    >
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant}>{badge.text}</Badge>
              <div className="text-sm font-medium text-text">{session.created_at?.slice(0, 10)}</div>
              <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px]">
                第 {index + 1} 条
              </Badge>
              <div className="text-xs text-dim">#{session.session_id}</div>
            </div>

            <div className="mt-3 text-sm leading-6 text-text">
              {summary || "这次训练暂时没有提炼出结构化结论。"}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <SignalChip label={`已答 ${answeredCount} 题`} />
              {weak && <SignalChip label={`最低 ${formatQuestionScore(weak)}`} tone="red" />}
              {best && <SignalChip label={`最佳 ${formatQuestionScore(best)}`} tone="green" />}
              {weakCount > 0 && <SignalChip label={`薄弱 ${weakCount}`} tone="red" />}
              {strongCount > 0 && <SignalChip label={`亮点 ${strongCount}`} tone="green" />}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 xl:flex-col xl:items-end">
            <ScorePill score={avg} size="large" emptyLabel="--" />
            <div className="inline-flex items-center gap-1 text-xs text-dim transition-colors group-hover:text-text">
              查看完整复盘
              <ChevronRight size={15} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InsightBlock({ title, value, body, tone = "default" }) {
  const toneClass = tone === "accent"
    ? "border-primary/20 bg-primary/8"
    : "border-border/80 bg-background/70";

  return (
    <div className={cn("rounded-[22px] border p-4", toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-text">{title}</div>
        {value && <div className="text-sm font-semibold tabular-nums text-primary">{value}</div>}
      </div>
      <div className="mt-2 text-sm leading-6 text-text">{body}</div>
    </div>
  );
}

function SignalList({ items, tone, emptyText }) {
  if (!items.length) {
    return <DashboardEmpty message={emptyText} compact />;
  }

  const cardClass = tone === "green"
    ? "border-green/20 bg-green/8"
    : "border-red/20 bg-red/8";
  const badgeVariant = tone === "green" ? "success" : "destructive";

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.point} className={cn("rounded-[22px] border p-4", cardClass)}>
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm leading-6 text-text">{item.point}</div>
            <Badge variant={badgeVariant} className="shrink-0">
              {item.count}x
            </Badge>
          </div>
          {item.lastSeen && (
            <div className="mt-2 text-xs text-dim">最近信号 {formatShortDate(item.lastSeen)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SignalChip({ label, tone = "default" }) {
  const className = tone === "green"
    ? "border-green/20 bg-green/8 text-green"
    : tone === "red"
      ? "border-red/20 bg-red/8 text-red"
      : "border-border/80 bg-background/70 text-dim";

  return (
    <span className={cn("rounded-full border px-2.5 py-1", className)}>
      {label}
    </span>
  );
}

function DashboardEmpty({ message, action, compact = false }) {
  return (
    <div className={cn(
      "rounded-[24px] border border-dashed border-border/80 bg-background/45 text-center text-dim",
      compact ? "px-4 py-6" : "px-5 py-10"
    )}>
      <div className="text-sm leading-6">{message}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function FullRetrospectiveModal({ open, retrospective, sectionCount, updatedAt, topicName, onClose }) {
  if (!retrospective) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-[28px] p-0">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12 md:px-6">
          <DialogTitle>{topicName} 完整回顾原文</DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{sectionCount || 1} 个模块</span>
            {updatedAt && <span>更新于 {formatMinute(updatedAt)}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-5 py-5 md:px-6">
          <div className="md-content text-sm leading-7 text-text">
            <ReactMarkdown>{retrospective}</ReactMarkdown>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getMasteryScore(data) {
  const value = data?.score ?? (data?.level ? data.level * 20 : null);
  if (value == null || Number.isNaN(Number(value))) return null;
  return roundScore(value);
}

function getSessionAverage(session) {
  if (!session) return null;
  const overallAvg = session?.overall?.avg_score;
  if (typeof overallAvg === "number") return roundScore(overallAvg);

  const entries = getNumericScoreEntries(session?.scores);
  if (!entries.length) return null;
  return roundScore(entries.reduce((sum, item) => sum + item.score, 0) / entries.length);
}

function getAnsweredCount(scores = []) {
  return getNumericScoreEntries(scores).length;
}

function getQuestionExtremes(scores = []) {
  const entries = getNumericScoreEntries(scores);
  if (!entries.length) return { best: null, weak: null };

  const best = entries.reduce((current, item) => (item.score > current.score ? item : current), entries[0]);
  const weak = entries.reduce((current, item) => (item.score < current.score ? item : current), entries[0]);

  return { best, weak };
}

function getNumericScoreEntries(scores = []) {
  return (scores || []).filter((item) => typeof item?.score === "number");
}

function extractSummarySnippet(review, overall) {
  if (typeof overall?.summary === "string" && overall.summary.trim()) {
    return truncate(condenseWhitespace(overall.summary), 180);
  }

  if (!review) return "";

  const summaryPart = review
    .split("## 逐题复盘")[0]
    .replace(/^## .*$/gm, "")
    .replace(/\*\*/g, "")
    .trim();

  return truncate(condenseWhitespace(summaryPart), 180);
}

function buildPointFrequency(items = []) {
  const map = new Map();

  for (const item of items) {
    const point = normalizePoint(item?.point || item);
    if (!point) continue;

    const key = point.toLowerCase();
    const count = Number(item?.count) || 1;
    const lastSeen = item?.lastSeen || "";
    const existing = map.get(key);

    if (existing) {
      existing.count += count;
      if (toTimestamp(lastSeen) > toTimestamp(existing.lastSeen)) existing.lastSeen = lastSeen;
      continue;
    }

    map.set(key, {
      point,
      count,
      lastSeen,
    });
  }

  return [...map.values()].sort((a, b) => (
    b.count - a.count
    || toTimestamp(b.lastSeen) - toTimestamp(a.lastSeen)
    || a.point.localeCompare(b.point)
  ));
}

function normalizePoint(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && typeof value.point === "string") return value.point.trim();
  return "";
}

function extractPlainText(markdown, maxLength = 180) {
  if (!markdown) return "";
  const text = markdown
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[#>*_`-]/g, " ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, maxLength);
}

function formatQuestionScore(item) {
  if (!item) return "--";
  return `Q${item.question_id ?? "?"} ${item.score}/10`;
}

function formatMinute(value) {
  if (!value) return "--";
  return value.replace("T", " ").slice(0, 16);
}

function formatShortDate(value) {
  if (!value) return "--";
  return value.length >= 10 ? value.slice(5, 10) : value;
}

function formatDelta(value) {
  if (value == null) return "--";
  if (value > 0) return `+${value}`;
  return String(value);
}

function getDeltaClass(value) {
  if (value == null) return "text-text";
  if (value > 0) return "text-green";
  if (value < 0) return "text-red";
  return "text-text";
}

function getScoreTextClass(value) {
  if (value == null) return "text-text";
  if (value >= 8) return "text-green";
  if (value >= 6) return "text-primary";
  if (value >= 4) return "text-primary";
  return "text-red";
}

function roundScore(value) {
  const rounded = Number(Number(value).toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function condenseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength = 180) {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function toTimestamp(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
