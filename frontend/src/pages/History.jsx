import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CalendarDays, ChevronRight, CircleAlert, CircleCheck, Filter, Hash, LoaderCircle, Play, RotateCw, Trash2 } from "lucide-react";
import { getHistory, deleteSession, getInterviewTopics, retryReview } from "../api/interview";
import { useTaskStatus } from "../contexts/TaskStatusContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const PAGE_SIZE = 15;
const PAGE_CLASS = "flex-1 w-full max-w-[1600px] mx-auto px-4 py-5 md:px-7 md:py-6 xl:px-10 2xl:px-12";

const MODE_BADGES = {
  resume: { text: "简历面试", variant: "default" },
  topic_drill: { text: "专项训练", variant: "success" },
  jd_prep: { text: "JD 备面", variant: "blue" },
  recording: { text: "录音复盘", variant: "blue" },
};

const FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "resume", label: "简历面试" },
  { key: "topic_drill", label: "专项训练" },
  { key: "jd_prep", label: "JD 备面" },
  { key: "recording", label: "录音复盘" },
];

// Session lifecycle → UI affordances. Ongoing sessions with no review yet are
// shown distinctly from review-failed ones so users can take the right action.
const STATUS_META = {
  reviewed: { label: "已复盘", tone: "success", icon: CircleCheck },
  reviewing: { label: "复盘生成中", tone: "info", icon: LoaderCircle, spin: true },
  review_failed: { label: "总结失败", tone: "danger", icon: CircleAlert },
  ended: { label: "待复盘", tone: "warn", icon: RotateCw },
  ongoing: { label: "未完成", tone: "warn", icon: Play },
};

const STATUS_TONE_STYLE = {
  success: "bg-success/10 text-success border-success/30",
  info: "bg-primary/10 text-primary border-primary/30",
  danger: "bg-red/10 text-red border-red/30",
  warn: "bg-orange/10 border-orange/30 text-orange",
};

export default function History() {
  const navigate = useNavigate();
  const { startTask } = useTaskStatus();
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [modeFilter, setModeFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [topics, setTopics] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [retrying, setRetrying] = useState({});
  const hasLoadedOnceRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    getInterviewTopics().then(setTopics).catch(() => {});
  }, []);

  const runHistoryQuery = useCallback(async ({ offset, reset }) => {
    const requestId = ++requestIdRef.current;

    if (reset) {
      if (hasLoadedOnceRef.current) setIsRefreshing(true);
      else setLoading(true);
    } else {
      setLoadingMore(true);
    }

    const mode = modeFilter === "all" ? null : modeFilter;
    const topic = topicFilter === "all" ? null : topicFilter;

    try {
      const data = await getHistory(PAGE_SIZE, offset, mode, topic);
      if (requestId !== requestIdRef.current) return;
      setSessions((prev) => (reset ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
    } catch {
      if (requestId !== requestIdRef.current) return;
      if (reset) setSessions([]);
    } finally {
      if (requestId === requestIdRef.current) {
        if (reset) {
          setLoading(false);
          setIsRefreshing(false);
          hasLoadedOnceRef.current = true;
        } else {
          setLoadingMore(false);
        }
      }
    }
  }, [modeFilter, topicFilter]);

  useEffect(() => {
    runHistoryQuery({ offset: 0, reset: true });
  }, [runHistoryQuery]);

  const handleModeChange = (mode) => {
    if (mode !== "all" && mode !== "topic_drill") setTopicFilter("all");
    setModeFilter(mode);
  };

  const handleTopicChange = (value) => {
    setTopicFilter(value);
  };

  // Status dictates where a row click goes. Reviewed → /review. Anything else
  // routes back into /interview so the user can continue answering or retry review.
  const openSession = (session) => {
    if (session.status === "reviewed") navigate(`/review/${session.session_id}`);
    else navigate(`/interview/${session.session_id}`);
  };

  const handleRetryReview = async (event, session) => {
    event.stopPropagation();
    if (retrying[session.session_id]) return;
    setRetrying((prev) => ({ ...prev, [session.session_id]: true }));
    try {
      await retryReview(session.session_id);
      const label = session.mode === "resume"
        ? "简历面试复盘生成中"
        : session.mode === "jd_prep" ? "JD 备面复盘生成中" : "专项训练复盘生成中";
      const type = session.mode === "resume"
        ? "resume_review"
        : session.mode === "jd_prep" ? "jd_review" : "drill_review";
      startTask(session.session_id, type, label);
      // Optimistically reflect the new status so the row updates without a full refetch.
      setSessions((prev) => prev.map((s) =>
        s.session_id === session.session_id
          ? { ...s, status: "reviewing", review_error: null }
          : s
      ));
    } catch (err) {
      alert("重新生成失败: " + err.message);
    } finally {
      setRetrying((prev) => {
        const next = { ...prev };
        delete next[session.session_id];
        return next;
      });
    }
  };

  const handleDeleteRequest = (event, session) => {
    event.stopPropagation();
    setPendingDelete(session);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete || isDeleting) return;

    setIsDeleting(true);

    try {
      await deleteSession(pendingDelete.session_id);
      setSessions((prev) => prev.filter((item) => item.session_id !== pendingDelete.session_id));
      setTotal((prev) => Math.max(0, prev - 1));
      setPendingDelete(null);
    } catch (error) {
      alert("删除失败: " + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className={cn(PAGE_CLASS, "space-y-3")}>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-24 w-full rounded-[24px]" />
        {[...Array(5)].map((_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-[20px]" />
        ))}
      </div>
    );
  }

  const hasFilters = modeFilter !== "all" || topicFilter !== "all";
  const showTopicFilter = (modeFilter === "all" || modeFilter === "topic_drill") && topics.length > 0;
  const activeFilterCount = Number(modeFilter !== "all") + Number(topicFilter !== "all");

  return (
    <TooltipProvider delayDuration={0}>
      <div className={PAGE_CLASS}>
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="text-3xl font-display font-bold tracking-tight md:text-[38px]">历史记录</div>
            <div className="mt-1 max-w-2xl text-sm leading-6 text-dim">
              按模式和领域快速回看训练记录，重点保留时间和评分这两类核心信息。
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[520px]">
            <HistorySummaryChip label="总记录" value={total} hint="累计完成" />
            <HistorySummaryChip label="当前列表" value={sessions.length} hint="本页已加载" />
            <HistorySummaryChip
              label="筛选状态"
              value={hasFilters ? "已生效" : "无条件"}
              hint={hasFilters ? `${activeFilterCount} 项条件` : "当前显示全部记录"}
              valueClassName={hasFilters ? "text-primary" : "text-text"}
            />
          </div>
        </div>

        <Card className="mt-3 border-border/80 bg-card/72">
          <CardContent className="p-3 md:p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] xl:items-stretch">
              <div className="min-w-0 rounded-[20px] border border-border/75 bg-background/55 p-3.5 md:p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">
                  <Filter size={13} />
                  模式筛选
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTER_OPTIONS.map((option) => (
                    <Button
                      key={option.key}
                      variant={modeFilter === option.key ? "secondary" : "ghost"}
                      size="sm"
                      className={cn(
                        "h-8 rounded-full px-3.5",
                        modeFilter === option.key && "border border-primary/40 bg-primary/10 text-text"
                      )}
                      onClick={() => handleModeChange(option.key)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="rounded-[20px] border border-border/75 bg-background/65 p-3.5 md:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">领域筛选</div>
                  <div className="text-[11px] text-dim/70">
                    {showTopicFilter ? "可进一步收窄记录" : "当前模式下不可用"}
                  </div>
                </div>

                {showTopicFilter ? (
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/80 px-3 py-3 text-sm">
                    <span className="shrink-0 text-dim">领域</span>
                    <select
                      className="min-w-0 flex-1 bg-transparent text-right text-text outline-none"
                      value={topicFilter}
                      onChange={(event) => handleTopicChange(event.target.value)}
                    >
                      <option value="all">全部领域</option>
                      {topics.map((topic) => (
                        <option key={topic} value={topic}>{topic}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/75 bg-background/60 px-3 py-3 text-sm text-dim">
                    当前模式下没有额外的领域筛选项。
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-border/80 bg-background/80 px-3 py-1.5 text-sm text-dim">
                    {buildFilterSummary(modeFilter, topicFilter)}
                  </div>
                  {hasFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-dim hover:text-text"
                      onClick={() => {
                        setModeFilter("all");
                        setTopicFilter("all");
                      }}
                    >
                      清空筛选
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {sessions.length === 0 ? (
          <Card className="mt-4 border-border/80">
            <CardContent className="px-6 py-14">
              <div className="mx-auto flex max-w-md flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  {hasFilters ? <Filter size={22} /> : <CalendarDays size={22} />}
                </div>
                <div className="mt-4 text-base font-semibold text-text">
                  {hasFilters ? "没有匹配的记录" : "还没有历史记录"}
                </div>
                <p className="mt-2 text-sm leading-6 text-dim">
                  {hasFilters
                    ? "调整模式或领域筛选后，再试一次。"
                    : "开始一场新的模拟面试后，这里会沉淀你的时间线和评分变化。"}
                </p>
                {!hasFilters && (
                  <Button variant="gradient" className="mt-5" onClick={() => navigate("/")}>
                    去首页开始面试
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between gap-3 border-b border-border/70 pb-2">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">复盘列表</div>
                {hasFilters && (
                  <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[11px]">
                    已筛选
                  </Badge>
                )}
              </div>
              <div className="text-sm text-dim tabular-nums">
                {isRefreshing ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircle size={14} className="animate-spin" />
                    更新中
                  </span>
                ) : (
                  `显示 ${sessions.length} / ${total}`
                )}
              </div>
            </div>

            <div
              aria-busy={isRefreshing}
              className={cn(
                "mt-3 flex flex-col gap-2 transition-opacity duration-150",
                isRefreshing && "opacity-70"
              )}
            >
              {sessions.map((session) => (
                <HistoryRow
                  key={session.session_id}
                  session={session}
                  onOpen={() => openSession(session)}
                  onDelete={handleDeleteRequest}
                  onRetry={handleRetryReview}
                  retrying={!!retrying[session.session_id]}
                />
              ))}
            </div>

            {sessions.length < total && (
              <Button
                variant="outline"
                className="mt-3 w-full py-3"
                onClick={() => runHistoryQuery({ offset: sessions.length, reset: false })}
                disabled={loadingMore}
              >
                {loadingMore ? "加载中..." : `加载更多 (${sessions.length}/${total})`}
              </Button>
            )}
          </>
        )}

        <DeleteConfirmDialog
          session={pendingDelete}
          open={Boolean(pendingDelete)}
          deleting={isDeleting}
          onConfirm={handleDeleteConfirm}
          onOpenChange={(open) => {
            if (!open && !isDeleting) setPendingDelete(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function HistorySummaryChip({ label, value, hint, valueClassName = "text-primary" }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/82 px-3.5 py-3 backdrop-blur-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim/80">{label}</div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
          valueClassName,
          typeof value === "number" && "tabular-nums"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-dim">{hint}</div>
    </div>
  );
}

function HistoryRow({ session, onOpen, onDelete, onRetry, retrying }) {
  const badge = MODE_BADGES[session.mode] || MODE_BADGES.resume;
  const title = session.meta?.position || session.topic || "综合";
  const subtitle = session.meta?.company || "";
  const createdDate = session.created_at?.slice(0, 10);
  const compactSessionId = formatSessionId(session.session_id);
  const status = session.status || "reviewed";
  const canRetry = status === "review_failed" && session.mode !== "recording";

  return (
    <Card
      role="button"
      tabIndex={0}
      className="group cursor-pointer rounded-[20px] border-border/75 bg-card/88 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="px-4 py-3.5 md:px-5 md:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant}>{badge.text}</Badge>
              <StatusBadge status={status} />
              <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">{title}</div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-2">
              {session.topic && (
                <TopicBadge topic={session.topic} mode={session.mode} />
              )}
              <ScorePill score={session.avg_score} />
              {createdDate && (
                <div className="inline-flex items-center gap-1.5 text-[13px] text-dim tabular-nums">
                  <CalendarDays size={13} />
                  {createdDate}
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1 text-[12px] text-dim/70"
                    title={session.session_id}
                  >
                    <Hash size={11} />
                    {compactSessionId}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{session.session_id}</TooltipContent>
              </Tooltip>
              {subtitle && (
                <span className="min-w-0 basis-full truncate text-[13px] text-dim md:basis-auto md:max-w-[420px]">
                  {subtitle}
                </span>
              )}
            </div>

            {status === "review_failed" && session.review_error && (
              <div className="mt-2 text-[12px] leading-5 text-red/80">
                {session.review_error}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 self-center">
            {canRetry && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                title="重新生成复盘"
                onClick={(event) => onRetry(event, session)}
                disabled={retrying}
              >
                <RotateCw size={13} className={retrying ? "animate-spin" : ""} />
                {retrying ? "重试中" : "重新生成"}
              </button>
            )}
            <button
              type="button"
              className="rounded-lg p-2 text-dim opacity-75 transition-colors hover:bg-red/8 hover:text-red hover:opacity-100"
              title="删除"
              aria-label="删除这条历史记录"
              onClick={(event) => onDelete(event, session)}
            >
              <Trash2 size={14} />
            </button>
            <div className="rounded-full bg-primary/8 p-1 text-primary transition-all group-hover:translate-x-0.5 group-hover:bg-primary/12">
              <ChevronRight size={18} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.reviewed;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_TONE_STYLE[meta.tone],
      )}
    >
      <Icon size={11} className={meta.spin ? "animate-spin" : ""} />
      {meta.label}
    </span>
  );
}

function buildFilterSummary(modeFilter, topicFilter) {
  const modeLabel = FILTER_OPTIONS.find((item) => item.key === modeFilter)?.label || "全部";
  if (modeFilter === "all" && topicFilter === "all") return "无筛选条件";
  if (topicFilter !== "all" && modeFilter === "all") return `全部模式 / ${topicFilter}`;
  if (topicFilter !== "all") return `${modeLabel} / ${topicFilter}`;
  return modeLabel;
}

function ScorePill({ score }) {
  if (score == null) {
    return (
      <Badge variant="secondary" className="min-w-[72px] justify-center rounded-full px-3 py-1 text-[12px]">
        未评分
      </Badge>
    );
  }

  let bg;
  let color;

  if (score >= 8) {
    bg = "rgba(34,197,94,0.15)";
    color = "var(--success)";
  } else if (score >= 6) {
    bg = "rgba(245,158,11,0.15)";
    color = "var(--ai-glow)";
  } else if (score >= 4) {
    bg = "rgba(253,203,110,0.2)";
    color = "#e2b93b";
  } else {
    bg = "rgba(239,68,68,0.15)";
    color = "var(--destructive)";
  }

  return (
    <Badge
      variant="outline"
      className="min-w-[72px] justify-center rounded-full px-3 py-1 font-semibold text-[12px] shadow-sm"
      style={{ background: bg, borderColor: "transparent", color }}
    >
      {score}/10
    </Badge>
  );
}

function TopicBadge({ topic, mode }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-medium",
        mode === "topic_drill"
          ? "border-green/20 bg-green/15 text-green"
          : "border-primary/20 bg-primary/10 text-primary"
      )}
    >
      {topic}
    </Badge>
  );
}

function formatSessionId(sessionId) {
  if (!sessionId) return "#--";
  if (sessionId.length <= 10) return `#${sessionId}`;
  return `#${sessionId.slice(0, 4)}...${sessionId.slice(-4)}`;
}

function DeleteConfirmDialog({ session, open, deleting, onConfirm, onOpenChange }) {
  const badge = session ? (MODE_BADGES[session.mode] || MODE_BADGES.resume) : MODE_BADGES.resume;
  const title = session?.meta?.position || session?.topic || "这条记录";
  const subtitle = session?.meta?.company || "";
  const createdDate = session?.created_at?.slice(0, 10) || "未知";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-border/80 bg-card text-text shadow-[0_24px_90px_rgba(0,0,0,0.35)] outline-none data-[state=open]:animate-bounce-in">
          <div className="relative p-5 md:p-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-br from-red/10 via-orange/10 to-transparent" />

            <div className="relative">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-red/15 bg-red/10 text-red shadow-sm">
                <AlertTriangle size={20} />
              </div>

              <Dialog.Title className="mt-4 text-[24px] font-display font-semibold tracking-tight">
                删除这条记录？
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-dim">
                删除后，这场复盘会从历史记录中移除，无法恢复。
              </Dialog.Description>

              <div className="mt-5 rounded-[22px] border border-border/80 bg-background/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badge.variant}>{badge.text}</Badge>
                  {session?.topic && <TopicBadge topic={session.topic} mode={session.mode} />}
                  <ScorePill score={session?.avg_score} />
                </div>

                <div className="mt-3 text-base font-semibold text-text">{title}</div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <DeleteMetaItem icon={<CalendarDays size={12} />} label="面试时间" value={createdDate} />
                  <DeleteMetaItem icon={<Hash size={12} />} label="记录 ID" value={formatSessionId(session?.session_id)} />
                </div>

                {(subtitle || session?.session_id) && (
                  <div className="mt-3 rounded-2xl bg-hover/80 px-3 py-2.5">
                    {subtitle && <div className="text-sm text-text">{subtitle}</div>}
                    {session?.session_id && (
                      <div className={cn("break-all text-xs text-dim", subtitle && "mt-1")}>
                        {session.session_id}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-[18px] border border-red/12 bg-red/6 px-3.5 py-3">
                <div className="text-sm font-medium text-text">危险操作</div>
                <div className="mt-1 text-sm leading-6 text-dim">
                  删除后不会进入回收站，也不会保留这场记录的评分和复盘入口。
                </div>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  className="h-10 rounded-full px-5"
                  onClick={() => onOpenChange(false)}
                  disabled={deleting}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  className="h-10 rounded-full px-5 shadow-[0_12px_30px_rgba(239,68,68,0.18)]"
                  onClick={onConfirm}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <LoaderCircle size={14} className="animate-spin" />
                      删除中
                    </>
                  ) : (
                    "确认删除"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteMetaItem({ icon, label, value }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3 py-2.5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-dim/75">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-sm font-medium text-text">{value}</div>
    </div>
  );
}
