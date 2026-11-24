import ScorePill from "@/components/ScorePill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildNodeRecommendation, truncate } from "./graphUtils";
import type { GraphNode } from "./types";

export default function NodeDetailPanel({ node, relatedNodes, zoomLevel, onOpenReview, onClear }: {
  node: GraphNode;
  relatedNodes: GraphNode[];
  zoomLevel: number;
  onOpenReview: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm leading-7 text-text">{node.question}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ScorePill score={node.score} />
          <Badge variant="outline">平均 {node.avg_score ?? "--"}/10</Badge>
          <Badge variant="outline">最高 {node.best_score ?? "--"}/10</Badge>
          <Badge variant="outline">出现 {node.attempts || 1} 次</Badge>
          <Badge variant="outline">难度 {node.difficulty || 3}</Badge>
          {node.focus_area && <Badge variant="outline">{node.focus_area}</Badge>}
        </div>
        <div className="mt-3 text-xs text-dim">
          最近出现 {node.date || "--"} · 当前画布缩放 {zoomLevel}x
        </div>
      </div>

      <div className="rounded-[22px] border border-primary/20 bg-primary/8 p-4">
        <div className="text-sm font-semibold text-text">推荐动作</div>
        <div className="mt-2 text-sm leading-6 text-text">{buildNodeRecommendation(node)}</div>
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm font-semibold text-text">关联题</div>
        <div className="mt-3 space-y-2">
          {relatedNodes.length > 0 ? relatedNodes.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2.5">
              <div className="text-sm leading-6 text-text">{item.focus_area || truncate(item.question, 28)}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-dim">
                <span>{item.score}/10</span>
                {item.focus_area && <span>{item.focus_area}</span>}
              </div>
            </div>
          )) : (
            <div className="text-sm text-dim">当前节点没有达到阈值的相似题。</div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onClear}>取消选中</Button>
        {node.session_id && (
          <Button variant="gradient" onClick={onOpenReview}>
            查看最近一次复盘
          </Button>
        )}
      </div>
    </div>
  );
}
