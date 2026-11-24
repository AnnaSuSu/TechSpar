export type GraphNodeId = number | string;
export type ScoreFilter = "all" | "weak" | "mid" | "strong";

export interface GraphNode {
  id: GraphNodeId;
  question: string;
  score: number;
  focus_area?: string;
  difficulty?: number;
  avg_score?: number;
  best_score?: number;
  attempts?: number;
  date?: string;
  session_id?: string;
  // The force engine assigns coordinates when it initializes the simulation.
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: GraphNodeId | GraphNode;
  target: GraphNodeId | GraphNode;
  similarity: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphFilters {
  searchQuery: string;
  scoreFilter: ScoreFilter;
  areaFilter: string;
}

export interface GraphInsights {
  nodeCount: number;
  linkCount: number;
  weakCount: number;
  stableCount: number;
  avgScore: number | null;
  topAreas: { label: string; count: number }[];
}
