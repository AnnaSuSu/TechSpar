import { useMemo, useRef, useState } from "react";
import { GitFork } from "lucide-react";
import ErrorState from "@/components/ErrorState";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import GraphCanvas from "./graph/GraphCanvas";
import GraphFilterBar from "./graph/GraphFilterBar";
import GraphSidebar from "./graph/GraphSidebar";
import { GraphHeadlineStats } from "./graph/GraphSummaryPanel";
import { DEFAULT_FILTERS, EMPTY_GRAPH, filterGraphData, getGraphInsights, getGraphSelection, matchesGraphFilters } from "./graph/graphUtils";
import type { GraphFilters, GraphNodeId } from "./graph/types";
import { useGraphResources } from "./graph/useGraphResources";

export default function Graph() {
  const {
    topics, topicsError, retryTopics, selectedTopic, requestVersion, selectTopic, graphData, graphError, loading,
  } = useGraphResources();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedNodeId, setSelectedNodeId] = useState<GraphNodeId | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const pageRef = useRef<HTMLDivElement>(null);
  const detailsColumnRef = useRef<HTMLDivElement>(null);

  const { searchQuery, scoreFilter, areaFilter } = filters;
  const focusAreas = useMemo(() => [...new Set(
    graphData?.nodes.map((node) => node.focus_area?.trim()).filter((area): area is string => Boolean(area)),
  )].sort((a, b) => a.localeCompare(b, "zh-CN")), [graphData]);
  const activeGraph = useMemo(() => graphData ? filterGraphData(graphData, filters) : EMPTY_GRAPH, [filters, graphData]);
  const graphInsights = useMemo(() => getGraphInsights(activeGraph), [activeGraph]);
  const selectionMeta = useMemo(() => getGraphSelection(activeGraph, selectedNodeId), [activeGraph, selectedNodeId]);
  const selectedNode = activeGraph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const hasActiveFilters = Boolean(searchQuery.trim() || scoreFilter !== "all" || areaFilter !== "all");

  const handleSelectTopic = (topic: string) => {
    setFilters(DEFAULT_FILTERS);
    setSelectedNodeId(null);
    selectTopic(topic);
  };

  const applyFilters = (next: GraphFilters) => {
    setFilters(next);
    if (selectedNode && !matchesGraphFilters(selectedNode, next.searchQuery, next.scoreFilter, next.areaFilter)) {
      setSelectedNodeId(null);
    }
  };

  return (
    <PageContainer size="wide">
      <div ref={pageRef}>
        <PageHeader
          icon={<GitFork size={21} />}
          title="题目图谱"
          description="查看专项训练题之间的关联，定位薄弱题并打开复盘。"
          actions={<GraphHeadlineStats topicCount={Object.keys(topics).length} graphInsights={graphInsights} selectedTopic={selectedTopic} />}
        />
        {topicsError ? (
          <ErrorState className="mt-4" title="领域加载失败" message={topicsError} onRetry={retryTopics} />
        ) : (
          <GraphFilterBar
            topics={topics}
            selectedTopic={selectedTopic}
            focusAreas={focusAreas}
            filters={filters}
            onSelectTopic={handleSelectTopic}
            onFilterChange={applyFilters}
          />
        )}
        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.36fr)_380px] 2xl:grid-cols-[minmax(0,1.42fr)_400px]">
          <GraphCanvas
            key={requestVersion}
            pageRef={pageRef}
            detailsColumnRef={detailsColumnRef}
            selectedTopic={selectedTopic}
            graphData={graphData}
            activeGraph={activeGraph}
            loading={loading}
            errorState={graphError && selectedTopic ? (
              <ErrorState title="图谱加载失败" message={graphError} onRetry={() => selectTopic(selectedTopic)} />
            ) : null}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            selectionMeta={selectionMeta}
            onClearFilters={() => applyFilters(DEFAULT_FILTERS)}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
          />
          <GraphSidebar
            detailsColumnRef={detailsColumnRef}
            selectedNode={selectedNode}
            relatedNodes={selectionMeta.relatedNodes}
            zoomLevel={zoomLevel}
            graphInsights={graphInsights}
            selectedTopicInfo={selectedTopic ? topics[selectedTopic] : null}
            scoreFilter={scoreFilter}
            areaFilter={areaFilter}
            hasActiveFilters={hasActiveFilters}
            onClear={() => setSelectedNodeId(null)}
          />
        </div>
      </div>
    </PageContainer>
  );
}
