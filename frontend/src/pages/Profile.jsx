import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Brain,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  FileText,
  Sparkles,
  Target,
  TrendingUp,
  User,
} from "lucide-react";

import { getProfile, getTopics, markProfileViewed } from "../api/interview";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import ErrorState from "@/components/ErrorState";

import DomainTable from "./profile/DomainTable";
import EvidenceTable from "./profile/EvidenceTable";
import {
  BehaviorSignalList,
  PerformanceDimCard,
  ScoreChart,
  SectionHeader,
  TopicPriorityCard,
} from "./profile/components";
import {
  buildBehaviorSignals,
  buildDimensionAverages,
  buildDomainInsights,
  buildPriorityWeaknesses,
  buildTrainingModeStats,
  buildVisitDelta,
  formatMinute,
  formatShortDate,
  getLatestEntry,
  getRealTopicSet,
  getTrendDelta,
  isKnowledgeAxis,
  sortByDateDesc,
} from "./profile/derive";
import { MODE_META, PERFORMANCE_DIMENSIONS } from "./profile/meta";

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [canonicalTopics, setCanonicalTopics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getProfile({ signal: controller.signal }),
      getTopics({ signal: controller.signal }).catch(() => ({})),
    ])
      .then(([nextProfile, topics]) => {
        if (controller.signal.aborted) return;
        setProfile(nextProfile);
        setCanonicalTopics(new Set(Object.keys(topics || {})));
        setLoadError(null);
        // 重置"自上次访问"基线。基线 30 分钟内不重置,短时间刷新/跳转回来时 delta 保持可见
        const hasAnyData = (nextProfile?.stats?.total_sessions || 0) > 0
          || (nextProfile?.weak_points || []).length > 0;
        const markerAt = Date.parse(nextProfile?.view_marker?.at || "") || 0;
        if (hasAnyData && (!markerAt || Date.now() - markerAt > 30 * 60 * 1000)) {
          markProfileViewed().catch(() => {});
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(err, "加载个人画像失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadNonce]);

  const handleRetry = () => {
    setLoading(true);
    setLoadError(null);
    setReloadNonce((n) => n + 1);
  };

  if (loading) {
    return (
      <PageContainer size="wide" className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-[220px] w-full rounded-[28px]" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
          <Skeleton className="h-[280px] rounded-[24px]" />
          <Skeleton className="h-[280px] rounded-[24px]" />
        </div>
        <Skeleton className="h-[260px] rounded-[24px]" />
      </PageContainer>
    );
  }

  if (loadError) {
    return (
      <PageContainer size="wide">
        <PageHeader icon={<User size={21} />} title="我的画像" className="mb-6" />
        <ErrorState title="画像加载失败" message={loadError} onRetry={handleRetry} />
      </PageContainer>
    );
  }

  const hasData = profile && (
    profile.stats?.total_sessions > 0 ||
    profile.stats?.total_answers > 0 ||
    (profile.weak_points || []).length > 0 ||
    (profile.strong_points || []).length > 0
  );

  if (!hasData) {
    const startOptions = [
      {
        path: "/topic-drill",
        icon: Target,
        title: "专项训练",
        desc: "选个技术主题，AI 按你的应答深度持续追问。",
        hint: "最快上手",
      },
      {
        path: "/mock-interview?mode=live",
        icon: FileText,
        title: "简历面试",
        desc: "上传简历，按你的经历定制行为面与项目深挖。",
        hint: "需先传简历",
      },
      {
        path: "/mock-interview?mode=targeted",
        icon: BriefcaseBusiness,
        title: "JD 备面",
        desc: "贴目标岗位 JD，模拟真实岗位的考察重点。",
        hint: "需先填 JD",
      },
    ];

    return (
      <PageContainer size="wide">
        <PageHeader icon={<User size={21} />} title="我的画像" />
        <Card className="mt-5 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(20,184,166,0.08))] dark:bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(8,145,178,0.12))]">
          <CardContent className="p-8 md:p-10">
            <div className="max-w-2xl">
              <Badge className="mb-4 bg-primary/12 text-primary">还没有训练数据</Badge>
              <div className="text-2xl font-semibold leading-tight md:text-4xl">
                先积累几轮回答，再让页面开始提炼真正的重点。
              </div>
              <div className="mt-4 text-sm leading-7 text-dim md:text-base">
                开始面试后，系统会逐步把你的弱项、强项、答题模式和领域变化沉淀下来。等第一批数据形成，页面会自动切到驾驶舱视图。
              </div>
            </div>

            <div className="mt-7 text-xs font-medium text-dim">选一个方式开始第一场面试</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {startOptions.map((option) => {
                const { path, icon: Icon, title, desc, hint } = option;
                return (
                <button
                  key={path}
                  type="button"
                  onClick={() => navigate(path)}
                  className="group relative flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/70 p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-background text-dim transition-colors duration-300 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
                      <Icon size={20} />
                    </div>
                    <ChevronRight size={16} className="text-dim/60 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold tracking-tight text-text">{title}</div>
                    <div className="mt-1 text-xs leading-5 text-dim">{desc}</div>
                  </div>
                  <div className="text-[11px] font-medium text-primary/80">{hint}</div>
                </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const stats = profile.stats || {};
  const scoreHistory = stats.score_history || [];
  // 知识轴: weak_points / strong_points 现在只承载知识类。
  // 老数据里可能存在 axis=performance 的遗留条目,用 isKnowledgeAxis 过滤掉。
  const weakActive = (profile.weak_points || []).filter(
    (item) => !item.improved && !item.archived && isKnowledgeAxis(item)
  );
  const weakImproved = sortByDateDesc(
    (profile.weak_points || []).filter((item) => item.improved && isKnowledgeAxis(item)),
    "improved_at",
    "last_seen"
  );
  const knowledgeStrong = sortByDateDesc(
    (profile.strong_points || []).filter(isKnowledgeAxis),
    "first_seen",
    "first_seen"
  );
  const masteryMap = profile.topic_mastery || {};
  const realTopicSet = getRealTopicSet(profile, scoreHistory, canonicalTopics);

  const priorityWeaknesses = buildPriorityWeaknesses(weakActive, masteryMap);

  // 表现轴: 全部从 behavior_signals 派生,不再从 weak_points 派生
  const behaviorView = buildBehaviorSignals(profile);
  const featuredBehavior = behaviorView.featured;
  const activePerfDims = behaviorView.namespaces.filter(
    (dim) =>
      (dim.negative?.length || 0) > 0 ||
      (dim.positive?.length || 0) > 0 ||
      (dim.improved?.length || 0) > 0
  );

  const domains = buildDomainInsights(profile, realTopicSet);
  const focusDomains = domains.filter((item) => item.zone === "focus");
  const buildDomains = domains.filter((item) => item.zone === "build");
  const strongDomains = domains.filter((item) => item.zone === "strong");
  const topicPriorities = [...focusDomains, ...buildDomains, ...strongDomains].map((item) => ({
    ...item,
    topWeakness: priorityWeaknesses.find((weakness) => weakness.topic === item.topic)?.point || "",
  }));
  const featuredTopic = topicPriorities[0] || null;
  const secondaryTopic = topicPriorities[1] || null;
  const extraTopicCount = Math.max(topicPriorities.length - 2, 0);
  // 只展示有记录的模式;没练过的模式不渲染 0 值卡片
  const activeModeStats = buildTrainingModeStats(stats, scoreHistory).filter((item) => item.count > 0);
  const latestEntry = getLatestEntry(scoreHistory);
  const trendDelta = getTrendDelta(scoreHistory);
  const visitDelta = buildVisitDelta(profile, canonicalTopics);
  // 有无可评分记录决定综合平均分显示 "–" 还是数字;后端在无评分时会给 0,不能直接透传
  const hasScores = scoreHistory.length > 0 || latestEntry?.avg_score != null;
  const dimensionAverages = buildDimensionAverages(scoreHistory);
  // SM-2 调度里今天到期的复习点,后端 GET /profile 附带的计算值
  const dueReviews = profile.due_reviews || [];

  return (
    <PageContainer size="wide">
      <PageHeader
        icon={<User size={21} />}
        title="我的画像"
        description={`${profile.target_role ? `目标岗位 ${profile.target_role} · ` : ""}共 ${stats.total_sessions || 0} 场练习 · 分析了 ${stats.total_answers || 0} 个回答${profile.updated_at ? ` · 上次更新 ${formatMinute(profile.updated_at).slice(5)}` : ""}`}
        className="animate-fade-in"
      />

      {visitDelta && (
        <Card className="mt-5 animate-fade-in-up [animation-delay:0.02s] border-primary/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.05),transparent)]">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={16} className="text-primary" />
              自上次访问（{formatShortDate(visitDelta.since)}）的变化
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {visitDelta.sessionsDelta > 0 && (
                <Badge variant="outline" className="rounded-full px-2.5 py-1 text-xs font-normal">
                  +{visitDelta.sessionsDelta} 次训练
                </Badge>
              )}
              {visitDelta.masteryChanges.slice(0, 4).map((change) => (
                <Badge
                  key={change.topic}
                  variant="outline"
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-normal",
                    change.diff > 0 ? "border-green/40 text-green" : "border-red/40 text-red"
                  )}
                >
                  {change.topic} {change.from} → {change.to}
                </Badge>
              ))}
              {visitDelta.newWeak.length > 0 && (
                <Badge variant="outline" className="rounded-full border-red/40 px-2.5 py-1 text-xs font-normal text-red">
                  +{visitDelta.newWeak.length} 个新薄弱点
                </Badge>
              )}
              {visitDelta.newlyImproved.length > 0 && (
                <Badge variant="outline" className="rounded-full border-green/40 px-2.5 py-1 text-xs font-normal text-green">
                  {visitDelta.newlyImproved.length} 条已改善
                </Badge>
              )}
            </div>

            {visitDelta.newPatterns.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {visitDelta.newPatterns.map((pattern) => (
                  <div key={pattern.point} className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm leading-6">
                    <span className="shrink-0 text-primary">✦</span>
                    <span>
                      系统发现了一条关于你的新规律：{pattern.point}
                      <span className="ml-1 text-xs text-dim">（可在下方知识证据区确认准不准）</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {dueReviews.length > 0 && (
        <Card className="mt-5 animate-fade-in-up [animation-delay:0.03s] border-primary/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.06),transparent)]">
          <CardContent className="p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Clock3 size={16} className="text-primary" />
                今日到期复习
                <span className="text-primary">{dueReviews.length} 个知识点</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {dueReviews.slice(0, 3).map((item) => (
                  <Badge key={item.point} variant="outline" className="max-w-[260px] rounded-full px-2.5 py-1 text-xs font-normal">
                    <span className="truncate">{item.topic ? `${item.topic} · ` : ""}{item.point}</span>
                  </Badge>
                ))}
                {dueReviews.length > 3 && (
                  <span className="self-center text-xs text-dim">等 {dueReviews.length} 条</span>
                )}
              </div>
              <Button size="sm" onClick={() => navigate("/topic-drill")}>
                去重练
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.04s]">
        <CardContent className="p-5 md:p-6">
          <SectionHeader
            icon={<TrendingUp size={18} />}
            title="练习统计"
            action={(
              <Button size="sm" variant="outline" onClick={() => navigate("/topic-drill")}>
                去练一场
                <ArrowRight size={14} />
              </Button>
            )}
          />

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
            <div>
              <div className="text-sm font-medium text-dim">总练习次数</div>
              <div className="mt-1.5 text-3xl font-bold tracking-tight">{stats.total_sessions || 0}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-dim">综合平均分</div>
              <div className="mt-1.5 text-3xl font-bold tracking-tight">
                {hasScores ? (stats.avg_score ?? "–") : "–"}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-dim">最近一次评分</div>
              <div className="mt-1.5 text-3xl font-bold tracking-tight">
                {latestEntry?.avg_score != null ? `${latestEntry.avg_score}/10` : "–"}
              </div>
              {latestEntry && (
                <div className="mt-1 text-xs text-dim">
                  {(MODE_META[latestEntry.mode] || MODE_META.topic_drill).label} · {formatShortDate(latestEntry.date)}
                </div>
              )}
            </div>
            <div>
              <div className="text-sm font-medium text-dim">趋势变化</div>
              <div className={cn(
                "mt-1.5 text-3xl font-bold tracking-tight",
                trendDelta != null && (trendDelta >= 0 ? "text-green" : "text-red")
              )}>
                {trendDelta == null ? "–" : trendDelta > 0 ? `+${trendDelta}` : trendDelta}
              </div>
              {trendDelta != null && <div className="mt-1 text-xs text-dim">相比上一条评分</div>}
            </div>
          </div>

          {activeModeStats.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {activeModeStats.map((item) => (
                <div
                  key={item.mode}
                  className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/50 px-3 py-1.5 text-xs"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: (MODE_META[item.mode] || MODE_META.topic_drill).color }}
                  />
                  <span className="font-medium">{item.title}</span>
                  <span className="text-dim">
                    {item.count} 次{item.avgScore != null ? ` · 平均 ${item.avgScore} 分` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!hasScores && (
            <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-primary/20 bg-primary/[0.05] px-4 py-3 text-sm leading-6">
              <Sparkles size={15} className="shrink-0 text-primary" />
              <span>还没有可评分的回答——完成一轮完整问答后，评分、趋势和下面的画像会开始生长。</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ 能力特征 (大卡, 知识轴) ═══ */}
      <Card className="mt-5 animate-fade-in-up [animation-delay:0.08s]">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <div className="text-xl font-display font-bold tracking-tight">能力特征</div>
              <div className="text-xs text-dim">"你懂什么、会什么" — 技术知识维度</div>
            </div>
            <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">知识轴</Badge>
          </div>

          {/* 焦点领域 */}
          <div className="mt-6">
            <SectionHeader
              icon={<Target size={18} />}
              title="焦点领域"
              caption="按训练领域排列，聚焦当前最该补的方向。"
              action={(
                <Button variant="outline" size="sm" onClick={() => navigate("/history")}>
                  查看全部记录
                </Button>
              )}
            />
            <div className="mt-5 space-y-4">
              {featuredTopic ? (
                <TopicPriorityCard
                  item={featuredTopic}
                  onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
                  label="主推荐"
                />
              ) : (
                <div className="rounded-[24px] border border-dashed border-border/80 px-5 py-8 text-sm text-dim">
                  目前没有可继续追踪的真实训练领域。
                </div>
              )}
              {secondaryTopic && (
                <TopicPriorityCard
                  item={secondaryTopic}
                  onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
                  label="次推荐"
                />
              )}
              {extraTopicCount > 0 && (
                <div className="rounded-2xl border border-border/70 bg-black/[0.02] px-4 py-3 text-xs leading-5 text-dim dark:bg-white/[0.02]">
                  还有 {extraTopicCount} 个领域在排队，完整列表见下方能力地图。
                </div>
              )}
            </div>
          </div>

          <div className="my-5 border-t border-border/60" />

          {/* 知识证据 */}
          <div>
            <SectionHeader
              icon={<Clock3 size={18} />}
              title="知识证据"
              caption="按弱点 / 强项 / 已改善分组的原始观察，可点击核对判断依据。"
            />
            <div className="mt-4">
              <EvidenceTable
                weakItems={priorityWeaknesses}
                strongItems={knowledgeStrong}
                improvedItems={weakImproved}
              />
            </div>
          </div>

          <div className="my-5 border-t border-border/60" />

          {/* 能力地图 */}
          <div>
            <SectionHeader
              icon={<Target size={18} />}
              title="能力地图"
              caption="覆盖到的真实训练主题与各自掌握度。"
            />
            <div className="mt-4">
              <DomainTable
                items={topicPriorities}
                onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 表现特征 (大卡, 表现轴) ═══ */}
      <Card className="mt-5 animate-fade-in-up [animation-delay:0.12s]">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <div className="text-xl font-display font-bold tracking-tight">表现特征</div>
              <div className="text-xs text-dim">"你怎么表达、怎么推导" — 行为模式维度</div>
            </div>
            <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">表现轴</Badge>
          </div>

          {/* 面试四维评分: 复盘产出的 dimension_scores 聚合,此前只在单场复盘里可见 */}
          {dimensionAverages && (
            <div className="mt-6">
              <div className="flex items-baseline gap-2">
                <div className="text-sm font-semibold">面试四维评分</div>
                <div className="text-xs text-dim">最近 {Math.max(...dimensionAverages.map((d) => d.samples))} 场带评分复盘的平均</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {dimensionAverages.map((dim) => (
                  <div key={dim.key} className="rounded-xl border border-border/60 bg-secondary/40 p-3.5">
                    <div className="text-xs font-medium text-dim">{dim.label}</div>
                    <div className="mt-1.5 text-2xl font-semibold">
                      {dim.score ?? "–"}
                      <span className="ml-0.5 text-xs font-normal text-dim">/10</span>
                    </div>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-orange"
                        style={{ width: `${(dim.score || 0) * 10}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="my-5 border-t border-border/60" />
            </div>
          )}

          {/* 主推行为模式 + 四 namespace 摘要 */}
          <div className={dimensionAverages ? "" : "mt-6"}>
            {featuredBehavior ? (
              <div className="rounded-[20px] border border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.06),rgba(251,191,36,0.03))] p-5 md:p-6 dark:bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(251,191,36,0.04))]">
                <div className="inline-flex rounded-full bg-amber-500/12 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  最突出的行为模式
                </div>
                <div className="mt-3 text-lg font-semibold leading-relaxed md:text-xl">
                  {featuredBehavior.description || featuredBehavior.id}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
                  <span>{PERFORMANCE_DIMENSIONS[featuredBehavior.namespace]?.label || featuredBehavior.namespace}</span>
                  <span>·</span>
                  <span className="font-mono">{featuredBehavior.id}</span>
                  <span>·</span>
                  <span>出现 {featuredBehavior.times_seen || 1} 次</span>
                </div>
                {featuredBehavior.examples?.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border/60 bg-card/90 px-3 py-2 text-xs leading-5 text-dim">
                    最近一次: {featuredBehavior.examples[featuredBehavior.examples.length - 1].snippet}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-[20px] border border-dashed border-border/70 px-5 py-7 text-sm leading-6 text-dim">
                还没有累积到稳定的行为模式。完成下一次面试后，系统会按四个维度（推导 / 叙事 / 表达 / 元认知）开始识别你的模式。
              </div>
            )}

            {activePerfDims.length > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                {behaviorView.namespaces.map((dim) => (
                  <PerformanceDimCard key={dim.key} dim={dim} />
                ))}
              </div>
            )}
          </div>

          {/* 完整 behavior_signals 列表 */}
          {behaviorView.activeNegativeCount + behaviorView.activePositiveCount + behaviorView.improvedCount > 0 && (
            <>
              <div className="my-5 border-t border-border/60" />
              <div>
                <SectionHeader
                  icon={<Brain size={18} />}
                  title="模式清单"
                  caption="按维度分组的所有 behavior_signals，点开行可看证据片段。"
                />
                <div className="mt-4">
                  <BehaviorSignalList namespaces={behaviorView.namespaces} />
                </div>
              </div>
            </>
          )}

        </CardContent>
      </Card>

      {scoreHistory.length >= 2 && (
        <Card className="mt-5 animate-fade-in-up [animation-delay:0.2s]">
          <CardContent className="p-5 md:p-6">
            <SectionHeader
              icon={<TrendingUp size={18} />}
              title="成长趋势"
            />
            <div className="mt-5 rounded-[24px] border border-border/70 bg-black/[0.02] p-3 dark:bg-white/[0.02] md:p-4">
              <ScoreChart history={scoreHistory} />
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
