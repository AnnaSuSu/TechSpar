import type { ApiResponse } from "../../api/client";
import {
  DIMENSION_SCORE_META,
  MODE_META,
  TRAINING_MODE_META,
  PERFORMANCE_DIMENSIONS,
} from "./meta";

// HTTP types are generated from the response contracts; UI enrichment stays local.
export type ProfileData = ApiResponse<"/api/profile", "get">;
export type ExposurePoint = Partial<ProfileData["weak_points"][number]>;
export type BehaviorSignalData = ProfileData["behavior_signals"][string];
export type BehaviorSignal = BehaviorSignalData & { id: string };
export type TopicMasteryData = ProfileData["topic_mastery"][string];
export type ProfileStats = ProfileData["stats"];
export type ViewMarker = NonNullable<ProfileData["view_marker"]>;
export type HistoryEntry = ProfileStats["score_history"][number];

// 知识轴 weak/strong 过滤:排除老数据里的 axis=performance 条目
// (表现轴现在走 behavior_signals,不再混进 weak_points)
export function isKnowledgeAxis(item: ExposurePoint | null | undefined) {
  return item?.axis !== "performance";
}

export function getMasteryScore(
  data: TopicMasteryData | null | undefined
): number | null {
  const value = data?.score ?? (data?.level ? data.level * 20 : null);
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(1));
}

function toTimestamp(value: string | undefined | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

// 显著性:recency × frequency 衰减,与后端 _weak_point_weight 对齐。
// 知识轴 weak_points 和表现轴 behavior_signals 字段同构,共用这个权重。
// 长期不再暴露的点逐渐沉底而非被硬切,纯排序信号。
const WEAK_POINT_HALF_LIFE_DAYS = 30;

export function weakPointWeight(item: ExposurePoint, now = Date.now()) {
  const lastSeen = toTimestamp(item.last_seen || item.first_seen);
  const days = lastSeen ? Math.max(0, (now - lastSeen) / 86400000) : 0;
  const recency = Math.pow(0.5, days / WEAK_POINT_HALF_LIFE_DAYS);
  const timesSeen = item.times_seen || 1;
  const freqMult = 1 + Math.min(Math.log2(timesSeen > 0 ? timesSeen : 1), 2);
  return recency * freqMult;
}

export function formatMinute(value: string | undefined | null) {
  if (!value) return "--";
  return value.replace("T", " ").slice(0, 16);
}

export function formatShortDate(value: string | undefined | null) {
  if (!value) return "--";
  if (value.length >= 10) return value.slice(5, 10);
  return value;
}

export function sortByDateDesc<T extends Record<string, unknown>>(
  list: T[],
  primaryKey: keyof T & string,
  fallbackKey: keyof T & string
): T[] {
  return [...list].sort((a, b) => {
    const aTime = toTimestamp((a[primaryKey] || a[fallbackKey]) as string);
    const bTime = toTimestamp((b[primaryKey] || b[fallbackKey]) as string);
    return bTime - aTime;
  });
}

export function buildPriorityWeaknesses(
  weakPoints: ExposurePoint[],
  masteryMap: Record<string, TopicMasteryData>
) {
  const now = Date.now();
  return [...weakPoints]
    .map((item) => {
      const masteryScore = getMasteryScore(
        item.topic ? masteryMap[item.topic] : null
      );
      const reasons = [`重复出现 ${item.times_seen || 1} 次`];
      if (item.last_seen || item.first_seen) {
        reasons.push(
          `最近暴露 ${formatShortDate(item.last_seen || item.first_seen)}`
        );
      }

      return {
        ...item,
        masteryScore,
        weight: weakPointWeight(item, now),
        domainNote: (item.topic && masteryMap[item.topic]?.notes) || "",
        reason: reasons.join(" · "),
      };
    })
    .sort((a, b) => {
      if (Math.abs(a.weight - b.weight) > 1e-9) return b.weight - a.weight;

      const masteryA = a.masteryScore ?? -1;
      const masteryB = b.masteryScore ?? -1;
      if (masteryA !== masteryB) return masteryA - masteryB;

      return (
        toTimestamp(b.last_seen || b.first_seen) -
        toTimestamp(a.last_seen || a.first_seen)
      );
    });
}

interface SignalBuckets {
  negative: BehaviorSignal[];
  positive: BehaviorSignal[];
  improved: BehaviorSignal[];
}

// 表现轴: 从 profile.behavior_signals 派生分组视图
//
// 返回:
//   - byNamespace: { [namespace]: { negative: [], positive: [], improved: [] } }
//                  每个数组已按 (times_seen desc, last_seen desc) 排序
//   - namespaces: Object.keys(PERFORMANCE_DIMENSIONS) 顺序的数组,
//                 即使该 namespace 没有数据也保留一个空槽,方便前端按四个固定卡渲染
//   - featured: 最显著的活跃负向信号(times_seen 最高的那条),或 null
//   - activeNegativeCount / activePositiveCount / improvedCount: 顶级摘要数字
export function buildBehaviorSignals(profile: ProfileData | null | undefined) {
  const raw = profile?.behavior_signals || {};
  const ids = Object.keys(raw);

  const byNamespace: Record<string, SignalBuckets> = {};
  for (const ns of Object.keys(PERFORMANCE_DIMENSIONS)) {
    byNamespace[ns] = { negative: [], positive: [], improved: [] };
  }

  let activeNegativeCount = 0;
  let activePositiveCount = 0;
  let improvedCount = 0;

  for (const id of ids) {
    const data = raw[id] || {};
    const ns = data.namespace || "other";
    if (!byNamespace[ns]) {
      // 异常 namespace 也保留,但前端只渲染 PERFORMANCE_DIMENSIONS 里有的那四个
      byNamespace[ns] = { negative: [], positive: [], improved: [] };
    }
    const signal: BehaviorSignal = { id, ...data };
    if (signal.improved) {
      byNamespace[ns].improved.push(signal);
      improvedCount += 1;
    } else if ((signal.polarity || "negative") === "positive") {
      byNamespace[ns].positive.push(signal);
      activePositiveCount += 1;
    } else {
      byNamespace[ns].negative.push(signal);
      activeNegativeCount += 1;
    }
  }

  // 时近衰减排序,与后端 _top_behavior_signals 对齐:旧高频信号不再永远压住新信号
  const now = Date.now();
  const sortSignals = (list: BehaviorSignal[]) =>
    list.sort((a, b) => weakPointWeight(b, now) - weakPointWeight(a, now));

  for (const ns of Object.keys(byNamespace)) {
    sortSignals(byNamespace[ns].negative);
    sortSignals(byNamespace[ns].positive);
    sortSignals(byNamespace[ns].improved);
  }

  // featured 在所有 namespace 的活跃负向里挑显著性最高的一条
  let featured: BehaviorSignal | null = null;
  for (const ns of Object.keys(byNamespace)) {
    const top = byNamespace[ns].negative[0];
    if (!top) continue;
    if (
      !featured ||
      weakPointWeight(top, now) > weakPointWeight(featured, now)
    ) {
      featured = top;
    }
  }

  const namespaces = Object.entries(PERFORMANCE_DIMENSIONS).map(
    ([key, meta]) => ({
      key,
      ...meta,
      ...byNamespace[key],
    })
  );

  return {
    byNamespace,
    namespaces,
    featured,
    activeNegativeCount,
    activePositiveCount,
    improvedCount,
  };
}

// "自上次访问"delta: 与后端 view_marker 基线对比,全部确定性派生,不依赖 LLM。
// 返回 null 表示没有基线或没有任何变化(首次访问 / 两次访问之间没训练)。
export function buildVisitDelta(
  profile: ProfileData,
  canonicalTopics?: Set<string> | null
) {
  const marker = profile?.view_marker;
  const since = toTimestamp(marker?.at);
  if (!since || !marker) return null;

  const weakPoints = profile.weak_points || [];
  const isActive = (item: ExposurePoint) =>
    !item.improved && !item.archived && isKnowledgeAxis(item);

  const newWeak = weakPoints.filter(
    (item) =>
      item.source !== "consolidated" &&
      isActive(item) &&
      toTimestamp(item.first_seen) > since
  );
  const newPatterns = weakPoints.filter(
    (item) =>
      item.source === "consolidated" &&
      isActive(item) &&
      toTimestamp(item.first_seen) > since
  );
  const newlyImproved = weakPoints.filter(
    (item) => item.improved && toTimestamp(item.improved_at) > since
  );

  const masteryChanges: Array<{
    topic: string;
    from: number;
    to: number;
    diff: number;
  }> = [];
  const baseScores = marker.topic_scores || {};
  for (const [topic, data] of Object.entries(profile.topic_mastery || {})) {
    if (canonicalTopics && canonicalTopics.size > 0 && !canonicalTopics.has(topic))
      continue;
    const current = getMasteryScore(data);
    const base = baseScores[topic];
    if (current == null || typeof base !== "number") continue;
    const diff = Number((current - base).toFixed(1));
    if (Math.abs(diff) >= 1)
      masteryChanges.push({ topic, from: base, to: current, diff });
  }
  masteryChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const sessionsDelta = Math.max(
    0,
    (profile.stats?.total_sessions || 0) - (marker.total_sessions || 0)
  );

  if (
    !sessionsDelta &&
    !newWeak.length &&
    !newPatterns.length &&
    !newlyImproved.length &&
    !masteryChanges.length
  ) {
    return null;
  }
  return {
    since: marker.at,
    sessionsDelta,
    newWeak,
    newPatterns,
    newlyImproved,
    masteryChanges,
  };
}

export function getRealTopicSet(
  profile: ProfileData,
  history?: HistoryEntry[] | null,
  canonicalTopics?: Set<string> | null
): Set<string> {
  const candidates = new Set(Object.keys(profile.topic_mastery || {}));

  (history || []).forEach((entry) => {
    if (entry?.topic) candidates.add(entry.topic);
  });

  if (canonicalTopics && canonicalTopics.size > 0) {
    for (const topic of candidates) {
      if (!canonicalTopics.has(topic)) candidates.delete(topic);
    }
  }

  return candidates;
}

interface DomainInsight {
  topic: string;
  score: number | null;
  note: string;
  weakCount: number;
  strongCount: number;
  lastSignal: string;
}

export function buildDomainInsights(
  profile: ProfileData,
  realTopics: Set<string>
) {
  const domainMap = new Map<string, DomainInsight>();
  const mastery = profile.topic_mastery || {};

  [...realTopics].forEach((topic) => {
    const data = mastery[topic] || {};
    domainMap.set(topic, {
      topic,
      score: getMasteryScore(data),
      note: data.notes || "",
      weakCount: 0,
      strongCount: 0,
      lastSignal: data.last_assessed || "",
    });
  });

  (profile.weak_points || [])
    .filter(
      (item): item is ProfileData["weak_points"][number] & { topic: string } =>
        !item.improved && !item.archived && !!item.topic && realTopics.has(item.topic)
    )
    .forEach((item) => {
      const existing = domainMap.get(item.topic) || {
        topic: item.topic,
        score: null,
        note: "",
        weakCount: 0,
        strongCount: 0,
        lastSignal: "",
      };
      existing.weakCount += 1;
      existing.lastSignal = [
        existing.lastSignal,
        item.last_seen || item.first_seen || "",
      ].sort((a, b) => toTimestamp(b) - toTimestamp(a))[0];
      domainMap.set(item.topic, existing);
    });

  (profile.strong_points || [])
    .filter(
      (item): item is ProfileData["strong_points"][number] & { topic: string } =>
        !!item.topic && realTopics.has(item.topic)
    )
    .forEach((item) => {
      const existing = domainMap.get(item.topic) || {
        topic: item.topic,
        score: null,
        note: "",
        weakCount: 0,
        strongCount: 0,
        lastSignal: "",
      };
      existing.strongCount += 1;
      existing.lastSignal = [existing.lastSignal, item.first_seen || ""].sort(
        (a, b) => toTimestamp(b) - toTimestamp(a)
      )[0];
      domainMap.set(item.topic, existing);
    });

  return [...domainMap.values()]
    .map((item) => {
      let zone: "focus" | "build" | "strong" = "build";
      if (item.score != null) {
        if (item.score < 40) zone = "focus";
        else if (item.score >= 70) zone = "strong";
      } else if (item.weakCount > 0) {
        zone = "focus";
      } else if (item.strongCount > 0) {
        zone = "strong";
      }

      return {
        ...item,
        topWeakness: "",
        zone,
      };
    })
    .sort((a, b) => {
      const zoneOrder = { focus: 0, build: 1, strong: 2 };
      if (zoneOrder[a.zone] !== zoneOrder[b.zone])
        return zoneOrder[a.zone] - zoneOrder[b.zone];

      const scoreA = a.score ?? -1;
      const scoreB = b.score ?? -1;
      if (scoreA !== scoreB) return scoreA - scoreB;

      const weakDiff = b.weakCount - a.weakCount;
      if (weakDiff !== 0) return weakDiff;

      return toTimestamp(b.lastSignal) - toTimestamp(a.lastSignal);
    });
}

export function buildModeCounts(stats: ProfileStats, history: HistoryEntry[]) {
  const counts: Record<string, number> = history.length
    ? history.reduce((acc: Record<string, number>, entry) => {
        const mode = entry.mode || "topic_drill";
        acc[mode] = (acc[mode] || 0) + 1;
        return acc;
      }, {})
    : {
        resume: stats.resume_sessions || 0,
        topic_drill: stats.drill_sessions || 0,
        jd_prep: stats.job_prep_sessions || 0,
      };

  const total =
    Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(MODE_META)
    .map(([mode, meta]) => ({
      mode,
      label: meta.label,
      color: meta.color,
      count: counts[mode] || 0,
      percent: ((counts[mode] || 0) / total) * 100,
    }))
    .filter((item) => item.count > 0);
}

export function buildTrainingModeStats(
  stats: ProfileStats,
  history: HistoryEntry[]
) {
  return Object.entries(TRAINING_MODE_META).map(([mode, meta]) => {
    const historyEntries = (history || []).filter(
      (entry) => (entry.mode || "topic_drill") === mode
    );
    const historyScores = historyEntries
      .map((entry) => entry.avg_score)
      .filter((value): value is number => typeof value === "number");
    const count = Math.max(
      (stats[meta.countKey] as number) || 0,
      historyEntries.length
    );
    const avgScore =
      typeof stats[meta.avgKey] === "number"
        ? (stats[meta.avgKey] as number)
        : historyScores.length
          ? Number(
              (
                historyScores.reduce((sum, value) => sum + value, 0) /
                historyScores.length
              ).toFixed(1)
            )
          : null;

    return {
      mode,
      title: meta.label,
      count,
      avgScore,
      accentClassName: meta.accentClassName,
      borderClassName: meta.borderClassName,
      glowClassName: meta.glowClassName,
    };
  });
}

// 四维评分聚合:取最近 5 条带 dimension_scores 的评分记录,按维度取均值。
// 四维分只有简历面试 / JD 备面的复盘会产出;一条都没有时返回 null。
export function buildDimensionAverages(history: HistoryEntry[]) {
  const entries = (history || [])
    .filter(
      (entry): entry is HistoryEntry & { dimension_scores: Record<string, number> } =>
        !!entry.dimension_scores && typeof entry.dimension_scores === "object"
    )
    .slice(-5);
  if (!entries.length) return null;

  const dims = DIMENSION_SCORE_META.map(
    ({ key, label }: { key: string; label: string }) => {
      const values = entries
        .map((entry) => entry.dimension_scores[key])
        .filter((value): value is number => typeof value === "number");
      return {
        key,
        label,
        score: values.length
          ? Number(
              (
                values.reduce((sum, value) => sum + value, 0) / values.length
              ).toFixed(1)
            )
          : null,
        samples: values.length,
      };
    }
  );
  return dims.some((dim) => dim.score != null) ? dims : null;
}

export function getTrendDelta(history: HistoryEntry[] | null | undefined) {
  if (!history || history.length < 2) return null;
  const current = history[history.length - 1]?.avg_score;
  const previous = history[history.length - 2]?.avg_score;
  if (typeof current !== "number" || typeof previous !== "number") return null;
  return Number((current - previous).toFixed(1));
}

export function getLatestEntry(history: HistoryEntry[] | null | undefined) {
  return history && history.length > 0 ? history[history.length - 1] : null;
}
