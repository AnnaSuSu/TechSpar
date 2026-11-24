import type { GraphResponse } from "@/api/graph";
import type { GraphData, GraphFilters, GraphInsights, GraphLink, GraphNode, GraphNodeId, ScoreFilter } from "./types";

export const DEFAULT_FILTERS: GraphFilters = { searchQuery: "", scoreFilter: "all", areaFilter: "all" };
export const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };
export const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "weak", label: "待补" },
  { key: "mid", label: "临界" },
  { key: "strong", label: "稳定" },
];

export function getNodeRadius(node: Pick<GraphNode, "difficulty">) {
  return 6 + (node.difficulty || 3) * 1.35;
}

export function matchesScoreFilter(node: Pick<GraphNode, "score">, filter: ScoreFilter) {
  if (filter === "all") return true;
  if (filter === "weak") return node.score < 4;
  if (filter === "mid") return node.score >= 4 && node.score < 8;
  if (filter === "strong") return node.score >= 8;
  return true;
}

export function matchesGraphFilters(
  node: Pick<GraphNode, "question" | "score" | "focus_area">,
  searchQuery: string,
  scoreFilter: ScoreFilter,
  areaFilter: string,
) {
  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = !query
    || node.question.toLowerCase().includes(query)
    || (node.focus_area || "").toLowerCase().includes(query);
  const matchesArea = areaFilter === "all" || (node.focus_area || "") === areaFilter;
  return matchesQuery && matchesScoreFilter(node, scoreFilter) && matchesArea;
}

export function buildScoreFilterLabel(filter: ScoreFilter) {
  return SCORE_FILTERS.find((item) => item.key === filter)?.label || "全部";
}

export function buildNodeRecommendation(node: Pick<GraphNode, "score">) {
  if (node.score < 4) {
    return "这是明确的薄弱题。先看最近一次复盘，按复盘建议把答案重讲一遍，再补一题同 focus area 的题验证是否真的补上。";
  }
  if (node.score < 6) {
    return "这题处于临界区，不是完全不会，而是表达和结构还不稳定。建议先压缩成 1 分钟答案，再补充关键遗漏点。";
  }
  if (node.score < 8) {
    return "这题已经有基础，但还不够稳。建议把答案做成固定结构，重点补上反例、边界和工程取舍，防止下一次掉分。";
  }
  return "这题已经比较稳定，可以保留为优势模板。下一步不是继续磨同一题，而是用它去带动相邻题型，验证知识迁移。";
}

export function getEntityId(value: GraphNodeId | GraphNode): GraphNodeId {
  return typeof value === "object" ? value.id : value;
}

export function getLinkKey(sourceId: GraphNodeId, targetId: GraphNodeId) {
  return sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
}

export function truncate(value: string, maxLength = 32) {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function roundScore(value: number) {
  const rounded = Number(Number(value).toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function scoreToColor(score: number) {
  if (score >= 8) return "#22C55E";
  if (score >= 6) return "#FBBF24";
  if (score >= 4) return "#FB923C";
  return "#EF4444";
}

export function getScoreBg(score: number) {
  if (score >= 8) return "rgba(34,197,94,0.15)";
  if (score >= 6) return "rgba(245,158,11,0.15)";
  if (score >= 4) return "rgba(251,146,60,0.16)";
  return "rgba(239,68,68,0.15)";
}

export function getGraphInsights({ nodes, links }: GraphData): GraphInsights {
  const weakCount = nodes.filter((node) => node.score < 6).length;
  const stableCount = nodes.filter((node) => node.score >= 8).length;
  const avgScore = nodes.length
    ? roundScore(nodes.reduce((sum, node) => sum + node.score, 0) / nodes.length)
    : null;

  const focusAreaMap = new Map<string, number>();
  for (const node of nodes) {
    const key = node.focus_area || "未标注";
    focusAreaMap.set(key, (focusAreaMap.get(key) || 0) + 1);
  }

  const topAreas = [...focusAreaMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  return {
    nodeCount: nodes.length,
    linkCount: links.length,
    weakCount,
    stableCount,
    avgScore,
    topAreas,
  };
}

export function getGraphSelection(data: GraphData, selectedNodeId: GraphNodeId | null) {
  const connectedNodeIds = new Set<GraphNodeId>();
  const connectedLinkKeys = new Set<string>();

  if (selectedNodeId == null) {
    return { connectedNodeIds, connectedLinkKeys, relatedNodes: [] };
  }

  for (const link of data.links) {
    const sourceId = getEntityId(link.source);
    const targetId = getEntityId(link.target);
    if (sourceId !== selectedNodeId && targetId !== selectedNodeId) continue;

    connectedNodeIds.add(sourceId);
    connectedNodeIds.add(targetId);
    connectedLinkKeys.add(getLinkKey(sourceId, targetId));
  }

  const relatedNodes = data.nodes
    .filter((node) => node.id !== selectedNodeId && connectedNodeIds.has(node.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return { connectedNodeIds, connectedLinkKeys, relatedNodes };
}

export function filterGraphData(data: GraphData, { searchQuery, scoreFilter, areaFilter }: GraphFilters): GraphData {
  const nodes = data.nodes.filter((node) => matchesGraphFilters(node, searchQuery, scoreFilter, areaFilter));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const links = data.links.filter((link) =>
    visibleIds.has(getEntityId(link.source)) && visibleIds.has(getEntityId(link.target)));
  return { nodes, links };
}

function isGraphNodeId(value: unknown): value is GraphNodeId {
  return typeof value === "string" || typeof value === "number";
}

export function readGraphData(data: GraphResponse): GraphData {
  const nodes = data.nodes.map((node): GraphNode => {
    if (!isGraphNodeId(node.id) || typeof node.question !== "string" || typeof node.score !== "number") {
      throw new Error("图谱返回了无效的题目节点");
    }
    return {
      id: node.id,
      question: node.question,
      score: node.score,
      focus_area: typeof node.focus_area === "string" ? node.focus_area : undefined,
      difficulty: typeof node.difficulty === "number" ? node.difficulty : undefined,
      avg_score: typeof node.avg_score === "number" ? node.avg_score : undefined,
      best_score: typeof node.best_score === "number" ? node.best_score : undefined,
      attempts: typeof node.attempts === "number" ? node.attempts : undefined,
      date: typeof node.date === "string" ? node.date : undefined,
      session_id: typeof node.session_id === "string" ? node.session_id : undefined,
    };
  });
  const links = data.links.map((link): GraphLink => {
    if (!isGraphNodeId(link.source) || !isGraphNodeId(link.target) || typeof link.similarity !== "number") {
      throw new Error("图谱返回了无效的题目连接");
    }
    return { source: link.source, target: link.target, similarity: link.similarity };
  });
  return { nodes, links };
}
