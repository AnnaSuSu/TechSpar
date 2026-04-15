import { MODE_META, TRAINING_MODE_META } from "./meta";

export function getMasteryScore(data) {
  const value = data?.score ?? (data?.level ? data.level * 20 : null);
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(1));
}

function toTimestamp(value) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function formatMinute(value) {
  if (!value) return "--";
  return value.replace("T", " ").slice(0, 16);
}

export function formatShortDate(value) {
  if (!value) return "--";
  if (value.length >= 10) return value.slice(5, 10);
  return value;
}

export function sortByDateDesc(list, primaryKey, fallbackKey) {
  return [...list].sort((a, b) => {
    const aTime = toTimestamp(a[primaryKey] || a[fallbackKey]);
    const bTime = toTimestamp(b[primaryKey] || b[fallbackKey]);
    return bTime - aTime;
  });
}

export function buildPriorityWeaknesses(weakPoints, masteryMap) {
  return [...weakPoints]
    .map((item) => {
      const masteryScore = getMasteryScore(masteryMap[item.topic]);
      const reasons = [`重复出现 ${item.times_seen || 1} 次`];
      if (item.last_seen || item.first_seen) {
        reasons.push(`最近暴露 ${formatShortDate(item.last_seen || item.first_seen)}`);
      }

      return {
        ...item,
        masteryScore,
        domainNote: masteryMap[item.topic]?.notes || "",
        reason: reasons.join(" · "),
      };
    })
    .sort((a, b) => {
      const seenDiff = (b.times_seen || 1) - (a.times_seen || 1);
      if (seenDiff !== 0) return seenDiff;

      const masteryA = a.masteryScore ?? -1;
      const masteryB = b.masteryScore ?? -1;
      if (masteryA !== masteryB) return masteryA - masteryB;

      return toTimestamp(b.last_seen || b.first_seen) - toTimestamp(a.last_seen || a.first_seen);
    });
}

export function getRealTopicSet(profile, history, canonicalTopics) {
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

export function buildDomainInsights(profile, realTopics) {
  const domainMap = new Map();
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
    .filter((item) => !item.improved && !item.archived && item.topic && realTopics.has(item.topic))
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
      existing.lastSignal = [existing.lastSignal, item.last_seen || item.first_seen].sort((a, b) => toTimestamp(b) - toTimestamp(a))[0];
      domainMap.set(item.topic, existing);
    });

  (profile.strong_points || [])
    .filter((item) => item.topic && realTopics.has(item.topic))
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
      existing.lastSignal = [existing.lastSignal, item.first_seen].sort((a, b) => toTimestamp(b) - toTimestamp(a))[0];
      domainMap.set(item.topic, existing);
    });

  return [...domainMap.values()]
    .map((item) => {
      let zone = "build";
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
      if (zoneOrder[a.zone] !== zoneOrder[b.zone]) return zoneOrder[a.zone] - zoneOrder[b.zone];

      const scoreA = a.score ?? -1;
      const scoreB = b.score ?? -1;
      if (scoreA !== scoreB) return scoreA - scoreB;

      const weakDiff = b.weakCount - a.weakCount;
      if (weakDiff !== 0) return weakDiff;

      return toTimestamp(b.lastSignal) - toTimestamp(a.lastSignal);
    });
}

export function buildModeCounts(stats, history) {
  const counts = history.length
    ? history.reduce((acc, entry) => {
      const mode = entry.mode || "topic_drill";
      acc[mode] = (acc[mode] || 0) + 1;
      return acc;
    }, {})
    : {
      resume: stats.resume_sessions || 0,
      topic_drill: stats.drill_sessions || 0,
      jd_prep: stats.job_prep_sessions || 0,
    };

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1;
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

export function buildTrainingModeStats(stats, history) {
  return Object.entries(TRAINING_MODE_META).map(([mode, meta]) => {
    const historyEntries = (history || []).filter((entry) => (entry.mode || "topic_drill") === mode);
    const historyScores = historyEntries
      .map((entry) => entry.avg_score)
      .filter((value) => typeof value === "number");
    const count = Math.max(stats[meta.countKey] || 0, historyEntries.length);
    const avgScore = typeof stats[meta.avgKey] === "number"
      ? stats[meta.avgKey]
      : historyScores.length
        ? Number((historyScores.reduce((sum, value) => sum + value, 0) / historyScores.length).toFixed(1))
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

export function getTrendDelta(history) {
  if (!history || history.length < 2) return null;
  const current = history[history.length - 1]?.avg_score;
  const previous = history[history.length - 2]?.avg_score;
  if (typeof current !== "number" || typeof previous !== "number") return null;
  return Number((current - previous).toFixed(1));
}

export function getLatestEntry(history) {
  return history && history.length > 0 ? history[history.length - 1] : null;
}
