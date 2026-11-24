import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import ScorePill from "@/components/ScorePill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { calculateRepulsionImpulse, getBoundedPosition, getNodeSway, limitVector } from "../graphMotion.js";
import { clamp, getEntityId, getLinkKey, getNodeRadius, roundScore, scoreToColor, truncate, type getGraphSelection } from "./graphUtils";
import type { GraphData, GraphLink, GraphNode, GraphNodeId } from "./types";

const SIMILARITY_THRESHOLD = 0.65;
const GRAPH_MIN_HEIGHT = 480;
const GRAPH_STACKED_MAX_HEIGHT = 760;
const REPULSION_STOP_SPEED = 0.045;

// 普通模式保留完整的拖拽排斥反馈；减少动态效果模式只缩短和减弱位移，不取消功能性交互反馈。
const DEFAULT_MOTION_CONFIG = {
  maxImpulse: 3.8,
  maxSpeed: 7,
  maxDisplacement: 54,
  draggingDamping: 0.78,
  releasedDamping: 0.84,
};
const REDUCED_MOTION_CONFIG = {
  maxImpulse: 1.9,
  maxSpeed: 3.5,
  maxDisplacement: 27,
  draggingDamping: 0.61,
  releasedDamping: 0.71,
};

type GraphHandle = ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>>;

interface Vector {
  x: number;
  y: number;
}

interface NodeMotion {
  frameId: number | null;
  lastFrameTime: number | null;
  draggedNodeId: GraphNodeId | null;
  velocities: Map<GraphNodeId, Vector>;
  origins: Map<GraphNodeId, Vector>;
}

interface GraphCanvasProps {
  pageRef: RefObject<HTMLDivElement | null>;
  detailsColumnRef: RefObject<HTMLDivElement | null>;
  selectedTopic: string | null;
  graphData: GraphData | null;
  activeGraph: GraphData;
  loading: boolean;
  errorState?: ReactNode;
  selectedNodeId: GraphNodeId | null;
  setSelectedNodeId: (id: GraphNodeId | null) => void;
  selectionMeta: ReturnType<typeof getGraphSelection>;
  onClearFilters: () => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
}

export default function GraphCanvas({
  pageRef, detailsColumnRef, selectedTopic, graphData, activeGraph, loading, errorState,
  selectedNodeId, setSelectedNodeId, selectionMeta, onClearFilters, zoomLevel, setZoomLevel,
}: GraphCanvasProps) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<{ graph: GraphData; node: GraphNode } | null>(null);
  const [graphReady, setGraphReady] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState === "visible");
  const [isGraphInViewport, setIsGraphInViewport] = useState(true);
  const [isNodeMotionActive, setIsNodeMotionActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<GraphHandle>(undefined);
  const initialFitPendingRef = useRef(true);
  const revealFrameRef = useRef<number | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const nodeMotionRef = useRef<NodeMotion>({
    frameId: null,
    lastFrameTime: null,
    draggedNodeId: null,
    velocities: new Map(),
    origins: new Map(),
  });
  const motionConfigRef = useRef(
    prefersReducedMotion ? REDUCED_MOTION_CONFIG : DEFAULT_MOTION_CONFIG,
  );
  const [dimensions, setDimensions] = useState({ width: 960, height: 620 });

  const isGraphVisible = isPageVisible && isGraphInViewport;
  const needsContinuousRedraw = isGraphVisible
    && (!prefersReducedMotion || isNodeMotionActive);

  const stopNodeMotion = useCallback(() => {
    const motion = nodeMotionRef.current;
    if (motion.frameId != null) cancelAnimationFrame(motion.frameId);
    motion.frameId = null;
    motion.lastFrameTime = null;
    motion.draggedNodeId = null;
    motion.velocities.clear();
    motion.origins.clear();
    setIsNodeMotionActive(false);
  }, []);

  // 自定义 RAF 通过 ref 读取最新参数，确保用户运行中切换系统偏好时无需中断当前拖拽反馈。
  useEffect(() => {
    motionConfigRef.current = prefersReducedMotion
      ? REDUCED_MOTION_CONFIG
      : DEFAULT_MOTION_CONFIG;
  }, [prefersReducedMotion]);


  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);
    return () => mediaQuery.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    const updatePageVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      if (!isVisible) stopNodeMotion();
      setIsPageVisible(isVisible);
    };

    document.addEventListener("visibilitychange", updatePageVisibility);
    return () => document.removeEventListener("visibilitychange", updatePageVisibility);
  }, [stopNodeMotion]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // 完全离开视口后才暂停，避免图谱贴近视口边缘时频繁启停渲染循环。
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) stopNodeMotion();
      setIsGraphInViewport(entry.isIntersecting);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [stopNodeMotion]);

  useEffect(() => {
    const motion = nodeMotionRef.current;
    return () => {
      if (revealFrameRef.current != null) cancelAnimationFrame(revealFrameRef.current);
      if (zoomFrameRef.current != null) cancelAnimationFrame(zoomFrameRef.current);
      if (motion.frameId != null) cancelAnimationFrame(motion.frameId);
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateDimensions = () => {
      const { width } = element.getBoundingClientRect();
      const detailsColumnHeight = detailsColumnRef.current?.getBoundingClientRect().height ?? 0;
      const isTwoColumnLayout = window.matchMedia("(min-width: 1280px)").matches;

      // 双栏布局以右侧“图谱摘要 + 操作提示”整列为高度基准，保证左右底部始终对齐。
      // 单列布局继续使用宽高比例，避免右侧内容堆叠后把图谱画布异常拉长。
      const height = isTwoColumnLayout && detailsColumnHeight > 0
        ? Math.max(GRAPH_MIN_HEIGHT, detailsColumnHeight)
        : Math.max(GRAPH_MIN_HEIGHT, Math.min(width * 0.62, GRAPH_STACKED_MAX_HEIGHT));

      setDimensions((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };

    const observer = new ResizeObserver(updateDimensions);

    observer.observe(element);
    if (detailsColumnRef.current) observer.observe(detailsColumnRef.current);
    if (pageRef.current) observer.observe(pageRef.current);
    window.addEventListener("resize", updateDimensions);
    updateDimensions();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDimensions);
    };
  }, [detailsColumnRef, pageRef]);

  const configureGraphLayout = useCallback(() => {
    const graph = fgRef.current;
    if (!graph) return;

    graph.d3Force("charge")?.strength(-150);
    graph.d3Force("link")?.distance(76);
    graph.d3ReheatSimulation?.();
  }, []);

  const fitGraphToView = useCallback((nodes: GraphNode[], duration = 500) => {
    const graph = fgRef.current;
    if (!graph || !nodes.length) return;

    // 单节点没有可供 zoomToFit 计算的有效跨度，直接居中可避免节点被推到画布边缘后遭到裁切。
    if (nodes.length === 1) {
      const [node] = nodes;
      graph.centerAt(node.x ?? 0, node.y ?? 0, duration);
      graph.zoom(1.8, duration);
      return;
    }

    graph.zoomToFit(duration, 56);
  }, []);

  const hoveredNode = hover?.graph === activeGraph ? hover.node : null;
  const graphHasData = activeGraph.nodes.length > 0;

  useEffect(() => {
    if (!graphHasData || graphReady) return;
    const timeout = setTimeout(configureGraphLayout, 80);
    return () => clearTimeout(timeout);
  }, [graphHasData, graphReady, configureGraphLayout]);

  // 节点集合变化时必须终止旧动画，避免筛选或切换领域后继续修改已经离开画布的对象。
  useEffect(() => stopNodeMotion, [activeGraph.nodes, stopNodeMotion]);

  const runNodeMotionFrame = useCallback(function runNodeMotionFrame(time: number) {
    const motion = nodeMotionRef.current;
    const motionConfig = motionConfigRef.current;
    const elapsed = motion.lastFrameTime == null ? 16.67 : Math.min(time - motion.lastFrameTime, 33.34);
    const frameScale = elapsed / 16.67;
    const damping = Math.pow(
      motion.draggedNodeId == null
        ? motionConfig.releasedDamping
        : motionConfig.draggingDamping,
      frameScale,
    );
    let hasMovingNode = false;
    const nodesById = new Map(activeGraph.nodes.map((node) => [node.id, node]));

    motion.lastFrameTime = time;

    for (const [nodeId, velocity] of motion.velocities) {
      const node = nodesById.get(nodeId);
      const origin = motion.origins.get(nodeId);

      if (node?.x == null || node.y == null || !origin) {
        motion.velocities.delete(nodeId);
        motion.origins.delete(nodeId);
        continue;
      }

      const nextPosition = getBoundedPosition(
        origin,
        node,
        velocity,
        frameScale,
        motionConfig.maxDisplacement,
      );
      node.x = nextPosition.x;
      node.y = nextPosition.y;

      const nextVelocity = { x: velocity.x * damping, y: velocity.y * damping };
      if (Math.hypot(nextVelocity.x, nextVelocity.y) > REPULSION_STOP_SPEED) {
        motion.velocities.set(nodeId, nextVelocity);
        hasMovingNode = true;
      } else {
        motion.velocities.delete(nodeId);
      }
    }

    if (hasMovingNode) {
      motion.frameId = requestAnimationFrame(runNodeMotionFrame);
      return;
    }

    // 多保留一个持续绘制帧，让本帧写入的最终坐标一定能落到 Canvas；若期间收到新冲量则直接续跑。
    motion.frameId = requestAnimationFrame((finalFrameTime) => {
      if (motion.velocities.size > 0) {
        runNodeMotionFrame(finalFrameTime);
        return;
      }

      motion.frameId = null;
      motion.lastFrameTime = null;
      if (motion.draggedNodeId == null) motion.origins.clear();
      setIsNodeMotionActive(false);
    });
  }, [activeGraph.nodes]);

  const ensureNodeMotionFrame = useCallback(() => {
    const motion = nodeMotionRef.current;
    if (motion.frameId == null) {
      motion.lastFrameTime = null;
      setIsNodeMotionActive(true);
      motion.frameId = requestAnimationFrame(runNodeMotionFrame);
    }
  }, [runNodeMotionFrame]);

  const handleNodeDrag = useCallback((draggedNode: GraphNode) => {
    // 直接按住节点拖动也视为选中，避免必须先单击一次、再进行第二次拖动才触发互斥反馈。
    if (draggedNode.id !== selectedNodeId) setSelectedNodeId(draggedNode.id);

    const motion = nodeMotionRef.current;
    if (motion.draggedNodeId == null) {
      motion.draggedNodeId = draggedNode.id;
      motion.origins.clear();
    }

    const motionConfig = motionConfigRef.current;
    let receivedImpulse = false;
    for (const nearbyNode of activeGraph.nodes) {
      if (nearbyNode.id === draggedNode.id || nearbyNode.x == null || nearbyNode.y == null) continue;

      const impulse = calculateRepulsionImpulse({
        draggedNode,
        nearbyNode,
        draggedRadius: getNodeRadius(draggedNode),
        nearbyRadius: getNodeRadius(nearbyNode),
        maxImpulse: motionConfig.maxImpulse,
      });
      if (impulse.strength === 0) continue;

      if (!motion.origins.has(nearbyNode.id)) {
        motion.origins.set(nearbyNode.id, { x: nearbyNode.x, y: nearbyNode.y });
      }
      const currentVelocity = motion.velocities.get(nearbyNode.id) || { x: 0, y: 0 };
      motion.velocities.set(nearbyNode.id, limitVector({
        x: currentVelocity.x + impulse.x,
        y: currentVelocity.y + impulse.y,
      }, motionConfig.maxSpeed));
      receivedImpulse = true;
    }

    if (receivedImpulse) ensureNodeMotionFrame();
  }, [activeGraph.nodes, ensureNodeMotionFrame, selectedNodeId, setSelectedNodeId]);

  const handleNodeDragEnd = useCallback((draggedNode: GraphNode) => {
    const motion = nodeMotionRef.current;
    if (motion.draggedNodeId !== draggedNode.id) return;

    motion.draggedNodeId = null;
    if (motion.velocities.size > 0) ensureNodeMotionFrame();
    else motion.origins.clear();
  }, [ensureNodeMotionFrame]);

  const paintNode = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D) => {
    if (node.x == null || node.y == null) return;
    const nodeId = node.id;
    const baseRadius = getNodeRadius(node);
    const selected = nodeId === selectedNodeId;
    const hovered = hoveredNode?.id === nodeId;
    const connected = selectionMeta.connectedNodeIds.has(nodeId);
    const dimmed = selectedNodeId != null && !selected && !connected;
    const color = scoreToColor(node.score);
    const isLight = !document.documentElement.classList.contains("dark");
    const textColor = isLight ? "#18181B" : "#FAFAF9";
    const radius = baseRadius + (selected ? 2.5 : hovered ? 1.2 : 0);
    const sway = getNodeSway(nodeId, performance.now(), selected || prefersReducedMotion);

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.2 : 1;

    if (selected || hovered) {
      ctx.shadowColor = color;
      ctx.shadowBlur = selected ? 24 : 14;
    }

    // 形变始终以节点中心为原点，视觉摇摆不会污染力导向坐标、连线位置或点击命中区域。
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.rotate(sway.angle);
    if (sway.active) {
      // 动态虚线模拟掠过节点边缘的风痕，增强小尺寸节点上的可感知度，同时保持几何中心不动。
      ctx.save();
      ctx.globalAlpha *= 0.2 + Math.abs(sway.wind) * 0.045;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.9;
      ctx.setLineDash([radius * 0.72, radius * 1.08]);
      ctx.lineDashOffset = sway.dashOffset;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius + 3.4, radius + 2.4, sway.angle * 0.65, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    // 剪切与非等比缩放共同形成摇曳感；所有变换都围绕 (0, 0)，不会让节点中心漂移。
    ctx.transform(1, sway.shear, sway.shear * 0.32, 1, 0, 0);
    ctx.scale(sway.scaleX, sway.scaleY);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (selected || hovered) {
      ctx.strokeStyle = selected ? textColor : "rgba(250,250,249,0.85)";
      ctx.lineWidth = selected ? 2.2 : 1.4;
      ctx.stroke();
    }
    // 恢复 force-graph 当前的缩放和平移变换，确保标签仍在原始坐标系绘制。
    ctx.restore();
    ctx.shadowBlur = 0;

    const label = node.focus_area || truncate(node.question, 18);
    ctx.font = `${selected || hovered ? 12 : 10}px DM Sans, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = textColor;
    ctx.globalAlpha = dimmed ? 0.28 : selected || hovered ? 1 : 0.76;
    ctx.fillText(label, node.x, node.y - radius - 7);
    ctx.restore();
  }, [hoveredNode, prefersReducedMotion, selectedNodeId, selectionMeta.connectedNodeIds]);

  const paintLink = useCallback((link: GraphLink, ctx: CanvasRenderingContext2D) => {
    const { source, target } = link;
    if (typeof source !== "object" || typeof target !== "object"
      || source.x == null || source.y == null || target.x == null || target.y == null) return;

    const sourceId = getEntityId(link.source);
    const targetId = getEntityId(link.target);
    const selected = selectionMeta.connectedLinkKeys.has(getLinkKey(sourceId, targetId));
    const alphaBase = Math.max(0.08, (link.similarity - SIMILARITY_THRESHOLD) * 3);
    const alpha = selectedNodeId == null ? alphaBase : selected ? Math.max(alphaBase, 0.46) : 0.035;

    ctx.save();
    ctx.strokeStyle = selected ? `rgba(245,158,11,${alpha})` : `rgba(161,161,170,${alpha})`;
    ctx.lineWidth = selected ? 1.4 + link.similarity * 1.2 : 0.5 + link.similarity * 1.3;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }, [selectedNodeId, selectionMeta.connectedLinkKeys]);

  const hoveredPreview = hoveredNode && hoveredNode.id !== selectedNodeId ? hoveredNode : null;

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNodeId(node.id);
    fgRef.current?.centerAt(node.x, node.y, 400);
    fgRef.current?.zoom(Math.max(fgRef.current?.zoom?.() || 1, 2.1), 500);
  };

  const handleZoom = (factor: number) => {
    const graph = fgRef.current;
    if (!graph) return;
    const current = graph.zoom?.() || zoomLevel || 1;
    graph.zoom(clamp(current * factor, 0.45, 6), 250);
  };

  const handleZoomChange = useCallback(({ k }: { k: number }) => {
    // ForceGraph 可能在自身渲染阶段同步派发 onZoom；合并到下一帧可避免跨组件 render-phase 更新。
    if (zoomFrameRef.current != null) cancelAnimationFrame(zoomFrameRef.current);
    zoomFrameRef.current = requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      setZoomLevel(roundScore(k));
    });
  }, [setZoomLevel]);

  const handleResetView = () => {
    setSelectedNodeId(null);
    fitGraphToView(activeGraph.nodes);
  };

  // 数据返回后仍保持构建提示，直到力导向布局完成并适配好视口。
  // 图谱画布会在提示层背后完成准备，二者在同一次渲染中切换，避免中间空白造成闪烁。
  const graphIsBuilding = loading || (graphHasData && !graphReady);

  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;

    if (isGraphVisible) {
      graph.resumeAnimation?.();
      return;
    }

    // 页面或图谱不可见时，停止底层循环并丢弃旧动量，避免返回页面后节点突然继续位移。
    graph.pauseAnimation?.();
  }, [graphHasData, isGraphVisible]);

  return (
    <Card
      ref={containerRef}
      className="relative overflow-hidden rounded-[28px] border-border/80 bg-card/86"
      style={{ height: dimensions.height }}
    >
      <CardContent className="relative h-full p-0">
        {selectedTopic && graphHasData && (
          <>
            <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[320px] rounded-[20px] border border-border/80 bg-background/82 px-4 py-3 shadow-sm backdrop-blur-sm">
              <div className="text-sm font-semibold text-text">图例</div>
              <div className="mt-2 space-y-2 text-xs leading-5 text-dim">
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {[
                    { label: "待补题 <4", color: "bg-red" },
                    { label: "临界题 4-6", color: "bg-orange" },
                    { label: "熟悉题 6-8", color: "bg-primary" },
                    { label: "稳定题 8+", color: "bg-green" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span className={cn("inline-block h-2.5 w-2.5 rounded-full", item.color)} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div>节点越大，题目难度越高。线越亮，题目语义越接近。</div>
                <div>滚轮缩放，拖动画布，点击节点锁定右侧详情。</div>
              </div>
            </div>

            <div className="absolute right-3 top-3 z-10 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handleZoom(0.82)}>缩小</Button>
              <Button variant="outline" size="sm" onClick={() => handleZoom(1.22)}>放大</Button>
              <Button variant="outline" size="sm" onClick={handleResetView}>适配视图</Button>
            </div>
          </>
        )}

        {!selectedTopic && !errorState && (
          <EmptyGraphState
            title="先选择一个领域"
            description="图谱只展示某个训练领域下的关联题。先切换领域，再看题目之间的相似关系。"
          />
        )}

        {errorState && <div className="p-5">{errorState}</div>}

        {graphIsBuilding && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center gap-2 bg-card text-sm text-dim"
            role="status"
            aria-live="polite"
          >
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.2s]" />
            正在构建图谱...
          </div>
        )}

        {selectedTopic && !loading && graphData && graphData.nodes.length === 0 && (
          <EmptyGraphState
            title="该领域还没有图谱"
            description="当前还没有可用于建图的已评分专项训练题。先完成几次专项训练，再回来查看关联图谱。"
            action={(
              <Button variant="gradient" onClick={() => navigate("/")}>
                去开始专项训练
              </Button>
            )}
          />
        )}

        {selectedTopic && !loading && graphData && graphData.nodes.length > 0 && !graphHasData && (
          <EmptyGraphState
            title="没有匹配的题目"
            description="当前搜索或筛选条件把所有节点都排除了。清空条件后再看全图。"
            action={(
              <Button variant="outline" onClick={onClearFilters}>
                清空筛选
              </Button>
            )}
          />
        )}

        {selectedTopic && !loading && graphHasData && (
          <div className={graphReady ? "opacity-100" : "pointer-events-none opacity-0"}>
            <ForceGraph2D<GraphNode, GraphLink>
              ref={fgRef}
              graphData={activeGraph}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="transparent"
              // 装饰性摇摆需要持续绘制；减少动态效果时仅在拖拽排斥运行期间临时保持逐帧刷新。
              autoPauseRedraw={!needsContinuousRedraw}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node, color, ctx) => {
                if (node.x == null || node.y == null) return;
                const radius = getNodeRadius(node) + 6;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkCanvasObject={paintLink}
              onNodeHover={(node) => setHover(node ? { graph: activeGraph, node } : null)}
              onNodeClick={handleNodeClick}
              onNodeDrag={handleNodeDrag}
              onNodeDragEnd={handleNodeDragEnd}
              onBackgroundClick={() => setSelectedNodeId(null)}
              onZoom={handleZoomChange}
              onEngineStop={() => {
                if (!initialFitPendingRef.current) return;
                initialFitPendingRef.current = false;
                fitGraphToView(activeGraph.nodes, 0);
                revealFrameRef.current = requestAnimationFrame(() => {
                  revealFrameRef.current = null;
                  setGraphReady(true);
                });
              }}
              // 初始阶段保留力导向布局计算；布局稳定并显示后，将后续模拟计算立即停止。
              // react-force-graph 会在拖动节点时自动重新加热 simulation，如果继续执行 tick，
              // 其他节点会被排斥力推离。设为 0 不影响被拖节点的坐标更新，只阻止其余节点重排。
              cooldownTicks={graphReady ? 0 : 100}
              d3AlphaDecay={0.026}
              d3VelocityDecay={0.33}
            />
          </div>
        )}

        {hoveredPreview && graphHasData && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[360px] rounded-[20px] border border-border/80 bg-background/84 px-4 py-3 shadow-lg backdrop-blur-sm">
            <div className="text-sm font-medium leading-6 text-text">{hoveredPreview.question}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-dim">
              <ScorePill score={hoveredPreview.score} size="compact" />
              {hoveredPreview.focus_area && <Badge variant="outline">{hoveredPreview.focus_area}</Badge>}
              {hoveredPreview.date && <span>{hoveredPreview.date}</span>}
              <span>难度 {hoveredPreview.difficulty || 3}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyGraphState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[480px] items-center justify-center px-6 py-12">
      <div className="max-w-md rounded-[26px] border border-dashed border-border/80 bg-background/55 px-6 py-8 text-center">
        <div className="text-lg font-semibold text-text">{title}</div>
        <div className="mt-2 text-sm leading-6 text-dim">{description}</div>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
