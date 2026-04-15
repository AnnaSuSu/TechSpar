import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Brain,
  Clock3,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";

import { getProfile, getTopics } from "../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import DomainTable from "./profile/DomainTable";
import EvidenceTable from "./profile/EvidenceTable";
import {
  CrossBlockerList,
  HabitTagList,
  PatternColumn,
  ScoreChart,
  SectionHeader,
  TopicPriorityCard,
} from "./profile/components";
import {
  buildDomainInsights,
  buildModeCounts,
  buildPriorityWeaknesses,
  buildTrainingModeStats,
  formatMinute,
  formatShortDate,
  getLatestEntry,
  getRealTopicSet,
  getTrendDelta,
  sortByDateDesc,
} from "./profile/derive";
import { MODE_META, PAGE_CLASS } from "./profile/meta";

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [canonicalTopics, setCanonicalTopics] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      getProfile().catch(() => null),
      getTopics().catch(() => ({})),
    ])
      .then(([nextProfile, topics]) => {
        setProfile(nextProfile);
        setCanonicalTopics(new Set(Object.keys(topics || {})));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={cn(PAGE_CLASS, "space-y-4")}>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-[220px] w-full rounded-[28px]" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
          <Skeleton className="h-[280px] rounded-[24px]" />
          <Skeleton className="h-[280px] rounded-[24px]" />
        </div>
        <Skeleton className="h-[260px] rounded-[24px]" />
      </div>
    );
  }

  const hasData = profile && (
    profile.stats?.total_sessions > 0 ||
    profile.stats?.total_answers > 0 ||
    (profile.weak_points || []).length > 0 ||
    (profile.strong_points || []).length > 0
  );

  if (!hasData) {
    return (
      <div className={PAGE_CLASS}>
        <div className="text-3xl font-display font-bold">个人画像</div>
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
              <Button variant="gradient" size="lg" className="mt-6" onClick={() => navigate("/")}>
                开始第一场面试
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = profile.stats || {};
  const scoreHistory = stats.score_history || [];
  const weakActive = (profile.weak_points || []).filter((item) => !item.improved && !item.archived);
  const weakImproved = sortByDateDesc(
    (profile.weak_points || []).filter((item) => item.improved),
    "improved_at",
    "last_seen"
  );
  const strongPoints = sortByDateDesc(profile.strong_points || [], "first_seen", "first_seen");
  const thinkingStrengths = profile.thinking_patterns?.strengths || [];
  const thinkingGaps = profile.thinking_patterns?.gaps || [];
  const communicationHabits = profile.communication?.habits || [];
  const communicationSuggestions = profile.communication?.suggestions || [];
  const masteryMap = profile.topic_mastery || {};
  const realTopicSet = getRealTopicSet(profile, scoreHistory, canonicalTopics);
  const priorityWeaknesses = buildPriorityWeaknesses(weakActive, masteryMap);
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
  const crossBlockers = priorityWeaknesses
    .filter((item) => !(item.topic && realTopicSet.has(item.topic)))
    .slice(0, 4);
  const visibleCrossBlockers = crossBlockers.slice(0, 2);
  const hiddenCrossBlockerCount = Math.max(crossBlockers.length - visibleCrossBlockers.length, 0);
  const modeCounts = buildModeCounts(stats, scoreHistory);
  const trainingModeStats = buildTrainingModeStats(stats, scoreHistory);
  const latestEntry = getLatestEntry(scoreHistory);
  const trendDelta = getTrendDelta(scoreHistory);

  return (
    <div className={PAGE_CLASS}>
      <div className="animate-fade-in">
        <div className="text-3xl font-display font-bold tracking-tight md:text-4xl">个人画像</div>
        <div className="mt-2 text-sm text-dim">
          {stats.total_answers || 0} 次回答分析
          {stats.total_sessions ? ` | ${stats.total_sessions} 次完整面试` : ""}
          {profile.updated_at ? ` | 上次更新 ${formatMinute(profile.updated_at)}` : ""}
        </div>
      </div>

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.04s]">
        <CardContent className="p-4 md:p-5">
          <SectionHeader icon={<TrendingUp size={18} />} title="练习统计" />

          <div className="mt-5 grid gap-6 lg:grid-cols-[auto_1px_1fr] items-center rounded-3xl border border-border/60 bg-black/[0.02] dark:bg-white/[0.02] p-5 md:p-6 lg:p-7 shadow-sm">
            <div className="flex gap-8 md:gap-14 lg:pl-2">
              <div className="flex flex-col gap-1.5">
                <div className="text-sm font-medium text-dim">总练习次数</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <div className="text-4xl font-bold tracking-tight text-primary drop-shadow-sm">{stats.total_sessions || 0}</div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-sm font-medium text-dim">综合平均分</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <div className="text-4xl font-bold tracking-tight text-green drop-shadow-sm">{stats.avg_score ?? "-"}</div>
                </div>
              </div>
            </div>

            <div className="h-full w-px bg-border/60 hidden lg:block" />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 w-full lg:pl-6">
              {trainingModeStats.map((item) => (
                <div
                  key={item.mode}
                  className={cn(
                    "flex flex-col rounded-2xl border border-border/80 border-l-[4px] px-4 py-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.92))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.04))]",
                    item.borderClassName,
                    item.glowClassName
                  )}
                >
                  <div className={cn("text-xs font-medium md:text-sm", item.accentClassName)}>{item.title}</div>
                  <div className="mt-2.5 flex items-baseline gap-3">
                    <div>
                      <span className={cn("text-xl font-semibold tracking-tight", item.accentClassName)}>{item.count}</span>
                      <span className="ml-0.5 text-[10px] text-dim">次</span>
                    </div>
                    <div className="text-border/60 text-xs">/</div>
                    <div>
                      <span className={cn("text-xl font-semibold tracking-tight", item.accentClassName)}>{item.avgScore ?? "-"}</span>
                      <span className="ml-0.5 text-[10px] text-dim">分</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.38fr)_minmax(360px,0.82fr)] 2xl:grid-cols-[minmax(0,1.5fr)_minmax(400px,0.86fr)]">
        <Card className="animate-fade-in-up [animation-delay:0.08s]">
          <CardContent className="p-5 md:p-6">
            <SectionHeader
              icon={<Target size={18} />}
              title="当前重点"
              caption="把真实训练领域和跨领域阻塞拆开，避免继续混成同一类卡片。"
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
                  variant="featured"
                  label="主推荐领域"
                />
              ) : (
                <div className="rounded-[24px] border border-dashed border-border/80 px-5 py-8 text-sm text-dim">
                  目前没有可继续追踪的真实训练领域。
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="text-sm font-semibold">下一顺位</div>
                    <Badge variant="secondary">{secondaryTopic ? 1 : 0}</Badge>
                  </div>

                  {secondaryTopic ? (
                    <TopicPriorityCard
                      item={secondaryTopic}
                      onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
                      label="次推荐"
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-sm text-dim">
                      当前没有第二优先级领域，先把主推荐打透。
                    </div>
                  )}

                  {extraTopicCount > 0 && (
                    <div className="mt-3 rounded-2xl border border-border/70 bg-black/[0.02] px-4 py-3 text-xs leading-5 text-dim dark:bg-white/[0.02]">
                      还有 {extraTopicCount} 个领域在排队，完整列表放在下方能力地图，不再挤进首页主视图。
                    </div>
                  )}
                </div>

                <div className="rounded-[24px] border border-border/80 bg-card/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">共性阻塞</div>
                      <div className="mt-1 text-xs leading-5 text-dim">
                        这些问题会跨多个场景反复出现，不属于单一领域，所以单独收口，不再伪装成可点击的 topic。
                      </div>
                    </div>
                    <Badge variant="destructive">{crossBlockers.length}</Badge>
                  </div>

                  <div className="mt-4">
                    <CrossBlockerList items={visibleCrossBlockers} />
                  </div>

                  {hiddenCrossBlockerCount > 0 && (
                    <div className="mt-3 text-xs leading-5 text-dim">
                      其余 {hiddenCrossBlockerCount} 条保留在证据库里，避免首页继续堆叠重复诊断。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 animate-fade-in-up [animation-delay:0.12s]">
          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={<Sparkles size={18} />}
                title="最近信号"
                caption="把进步、稳定得分点和最新表现放在同一侧栏里。"
              />

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl bg-green/8 p-4">
                  <div className="text-sm font-semibold text-green">最近改善</div>
                  <div className="mt-3 space-y-2">
                    {weakImproved.slice(0, 2).map((item) => (
                      <div key={item.point} className="rounded-xl bg-card/90 px-3 py-2 text-sm leading-6">
                        <div className="flex items-center justify-between gap-3">
                          <span>{item.point}</span>
                          <Badge variant="success">已改善</Badge>
                        </div>
                      </div>
                    ))}
                    {weakImproved.length === 0 && (
                      <div className="rounded-xl bg-card/90 px-3 py-2 text-sm text-dim">
                        还没有形成明确的改善闭环。
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-primary/8 p-4">
                  <div className="text-sm font-semibold text-primary">稳定得分点</div>
                  <div className="mt-3 space-y-2">
                    {strongPoints.slice(0, 3).map((item) => (
                      <div key={item.point} className="rounded-xl bg-card/90 px-3 py-2 text-sm leading-6">
                        <div className="flex items-center justify-between gap-3">
                          <span>{item.point}</span>
                          {item.topic && <Badge variant="outline">{item.topic}</Badge>}
                        </div>
                      </div>
                    ))}
                    {strongPoints.length === 0 && (
                      <div className="rounded-xl bg-card/90 px-3 py-2 text-sm text-dim">
                        还没有记录到稳定的优势信号。
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/80 bg-card/80 p-4">
                    <div className="text-xs font-medium text-dim">最近一次评分</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {latestEntry?.avg_score != null ? `${latestEntry.avg_score}/10` : "--"}
                    </div>
                    <div className="mt-2 text-xs text-dim">
                      {latestEntry ? `${(MODE_META[latestEntry.mode] || MODE_META.topic_drill).label} · ${formatShortDate(latestEntry.date)}` : "暂无评分记录"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/80 bg-card/80 p-4">
                    <div className="text-xs font-medium text-dim">趋势变化</div>
                    <div className={cn(
                      "mt-2 text-2xl font-semibold",
                      trendDelta == null ? "text-text" : trendDelta >= 0 ? "text-green" : "text-red"
                    )}>
                      {trendDelta == null ? "--" : trendDelta > 0 ? `+${trendDelta}` : trendDelta}
                    </div>
                    <div className="mt-2 text-xs text-dim">相比上一条评分记录</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <SectionHeader
                icon={<Activity size={18} />}
                title="训练结构"
                caption="训练类型分布决定了画像的信号来源。"
              />

              <div className="mt-5 space-y-3">
                {modeCounts.length > 0 ? modeCounts.map((item) => (
                  <div key={item.mode}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{item.label}</span>
                      <span className="text-dim">{item.count} 次</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-border/80 px-3 py-4 text-sm text-dim">
                    暂无训练分布数据。
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-black/4 px-4 py-3 dark:bg-white/[0.04]">
                  <div className="text-xs text-dim">回答分析</div>
                  <div className="mt-1 text-xl font-semibold">{stats.total_answers || 0}</div>
                </div>
                <div className="rounded-2xl bg-black/4 px-4 py-3 dark:bg-white/[0.04]">
                  <div className="text-xs text-dim">覆盖主题</div>
                  <div className="mt-1 text-xl font-semibold">{domains.length}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.16s]">
        <CardContent className="p-5 md:p-6">
          <SectionHeader
            icon={<Clock3 size={18} />}
            title="证据库"
            caption="原始条目提前到摘要之后，方便你快速核对判断依据。"
          />
          <EvidenceTable
            weakItems={priorityWeaknesses}
            strongItems={strongPoints}
            improvedItems={weakImproved}
          />
        </CardContent>
      </Card>

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.2s]">
        <CardContent className="p-5 md:p-6">
          <SectionHeader
            icon={<Target size={18} />}
            title="能力地图"
            caption="这里只显示真实训练主题，不再把画像标签误当成领域。"
          />
          <DomainTable
            items={topicPriorities}
            onSelect={(topic) => navigate(`/profile/topic/${topic}`)}
          />
        </CardContent>
      </Card>

      <Card className="mt-5 animate-fade-in-up [animation-delay:0.24s]">
        <CardContent className="p-5 md:p-6">
          <SectionHeader
            icon={<Brain size={18} />}
            title="答题模式"
            caption="模式层解释，不再拆成四张一级卡片和前面的诊断抢权重。"
          />

          <div className="mt-5 text-sm leading-7 text-dim">
            {profile.communication?.style || "暂时没有形成明确的表达侧总结。"}
          </div>
          {communicationHabits.length > 0 && (
            <div className="mt-3">
              <HabitTagList items={communicationHabits} />
            </div>
          )}

          {(thinkingGaps.length > 0 || thinkingStrengths.length > 0 || communicationSuggestions.length > 0) && (
            <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-3">
              <PatternColumn title="风险" color="text-red" items={thinkingGaps} />
              <PatternColumn title="优势" color="text-green" items={thinkingStrengths} />
              <PatternColumn title="训练" color="text-primary" items={communicationSuggestions} />
            </div>
          )}
        </CardContent>
      </Card>

      {scoreHistory.length >= 2 && (
        <Card className="mt-5 animate-fade-in-up [animation-delay:0.28s]">
          <CardContent className="p-5 md:p-6">
            <SectionHeader
              icon={<TrendingUp size={18} />}
              title="成长趋势"
              caption="趋势保留在后面，作为历史参考，而不是首页主判断。"
            />
            <div className="mt-5 rounded-[24px] border border-border/70 bg-black/[0.02] p-3 dark:bg-white/[0.02] md:p-4">
              <ScoreChart history={scoreHistory} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
