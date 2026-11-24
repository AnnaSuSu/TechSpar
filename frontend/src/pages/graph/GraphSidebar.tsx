import type { Ref } from "react";
import { useNavigate } from "react-router-dom";
import type { TopicInfo } from "@/api/topics";
import { Card, CardContent } from "@/components/ui/card";
import GraphSummaryPanel from "./GraphSummaryPanel";
import NodeDetailPanel from "./NodeDetailPanel";
import type { GraphInsights, GraphNode, ScoreFilter } from "./types";

interface GraphSidebarProps {
  detailsColumnRef: Ref<HTMLDivElement>;
  selectedNode: GraphNode | null;
  relatedNodes: GraphNode[];
  zoomLevel: number;
  graphInsights: GraphInsights;
  selectedTopicInfo?: TopicInfo | null;
  scoreFilter: ScoreFilter;
  areaFilter: string;
  hasActiveFilters: boolean;
  onClear: () => void;
}

export default function GraphSidebar({
  detailsColumnRef, selectedNode, relatedNodes, zoomLevel, graphInsights, selectedTopicInfo,
  scoreFilter, areaFilter, hasActiveFilters, onClear,
}: GraphSidebarProps) {
  const navigate = useNavigate();

  return (
    <div ref={detailsColumnRef} className="space-y-4">
      <Card className="rounded-[28px] border-border/80 bg-card/88">
        <CardContent className="p-5 md:p-6">
          <PanelHeader
            title={selectedNode ? "节点详情" : "图谱摘要"}
            caption={selectedNode
              ? "点击空白处可取消选中。"
              : "先从右侧看全局，再点击节点查看具体题目。"}
          />

          {selectedNode ? (
            <NodeDetailPanel
              node={selectedNode}
              relatedNodes={relatedNodes}
              zoomLevel={zoomLevel}
              onOpenReview={() => selectedNode.session_id && navigate(`/review/${selectedNode.session_id}`)}
              onClear={onClear}
            />
          ) : (
            <GraphSummaryPanel
              graphInsights={graphInsights}
              selectedTopicInfo={selectedTopicInfo}
              scoreFilter={scoreFilter}
              areaFilter={areaFilter}
              hasActiveFilters={Boolean(hasActiveFilters)}
            />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-border/80 bg-card/88">
        <CardContent className="p-5 md:p-6">
          <PanelHeader
            title="操作提示"
            caption="把这张图当工作台，不是海报。"
          />

          <div className="mt-4 space-y-3 text-sm leading-6 text-text">
            <HintRow title="怎么读颜色" body="红色和橙色优先复盘，绿色表示已经相对稳定，黄色是还需要继续巩固的中间状态。" />
            <HintRow title="怎么用点击" body="点击节点后，右侧会显示题目详情、出现次数、推荐动作和最近一次复盘入口。" />
            <HintRow title="怎么收窄范围" body="优先用搜索 + 得分筛选，把图谱先压缩到你当前要处理的题目集合。" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PanelHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-text">{title}</div>
      {caption && <div className="mt-1 text-sm leading-6 text-dim">{caption}</div>}
    </div>
  );
}

function HintRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[20px] border border-border/80 bg-background/70 px-4 py-3.5">
      <div className="text-sm font-semibold text-text">{title}</div>
      <div className="mt-1 text-sm leading-6 text-dim">{body}</div>
    </div>
  );
}
