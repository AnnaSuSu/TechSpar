import { useCallback, useEffect, useState } from "react";
import { Brain, Building2, Clock, Loader2, Plus, Radio, Trash2 } from "lucide-react";

import { deleteCopilotPrep, listCopilotPreps } from "../../api/copilot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { PAGE_CLASS, formatTime } from "./shared";

export default function ListView({ onNew, onSelect }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await listCopilotPreps();
      setItems(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const hasRunning = items.some((item) => item.status === "running");
    if (!hasRunning) return;

    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [items, load]);

  const handleDelete = async (prepId, event) => {
    event.stopPropagation();
    if (!window.confirm("删除这份准备及其所有实战记录？已生成的复盘、对话副本和长期画像会保留。")) return;
    try {
      await deleteCopilotPrep(prepId);
      setItems((prev) => prev.filter((item) => item.prep_id !== prepId));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={PAGE_CLASS}>
      <Card className="overflow-hidden border-border/80 bg-card/76 mb-6">
        <CardContent className="p-5 md:p-6 xl:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">面试辅助</div>
              <div className="mt-2 text-2xl font-display font-bold tracking-tight md:text-3xl">面试 Copilot</div>
              <div className="mt-1.5 max-w-2xl text-sm leading-6 text-dim">
                提前准备好面试分析，面试时一键开启实时辅助。多 Agent 预测 HR 提问走向，实时给出回答建议。
              </div>
            </div>
            <Button variant="gradient" size="lg" className="shrink-0" onClick={onNew}>
              <Plus size={18} /> 新建面试准备
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-dim">
          <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
        </div>
      ) : items.length === 0 ? (
        <Card className="border-dashed border-border/80 bg-card/55">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Brain size={20} />
            </div>
            <div className="mt-4 text-lg font-semibold">还没有面试准备</div>
            <div className="mt-2 text-sm leading-6 text-dim">
              点击「新建面试准备」，填写 JD 和目标公司，Copilot 会为你分析 HR 的提问策略。
            </div>
            <Button variant="gradient" className="mt-5" onClick={onNew}>
              <Plus size={16} /> 新建面试准备
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card
              key={item.prep_id}
              className="border-border/80 hover:border-primary/30 transition-colors cursor-pointer group"
              onClick={() => onSelect(item.prep_id)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 size={16} className="text-primary shrink-0" />
                    <span className="font-semibold truncate">
                      {item.company || item.position || "未命名"}
                    </span>
                  </div>
                  <Badge
                    variant={
                      item.status === "done"
                        ? "green"
                        : item.status === "running"
                          ? "blue"
                          : "destructive"
                    }
                    className="text-xs shrink-0"
                  >
                    {item.status === "done" ? "已就绪" : item.status === "running" ? "准备中" : "失败"}
                  </Badge>
                </div>

                {item.position && item.company && (
                  <div className="text-sm text-dim mb-2">{item.position}</div>
                )}

                {item.jd_excerpt && (
                  <div className="text-[13px] text-dim/70 leading-5 line-clamp-2 mb-3">
                    {item.jd_excerpt}...
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-dim/60">
                    <Clock size={12} />
                    {formatTime(item.created_at)}
                  </div>
                  <div className="flex items-center gap-1">
                    {item.status === "done" && (
                      <Badge variant="outline" className="text-xs group-hover:border-primary/30 group-hover:text-primary transition-colors">
                        <Radio size={10} className="mr-1" /> 可开始面试
                      </Badge>
                    )}
                    {item.status === "running" && (
                      <span className="text-xs text-blue-300 flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> {item.progress}
                      </span>
                    )}
                    <button
                      onClick={(event) => handleDelete(item.prep_id, event)}
                      className="ml-2 p-1 rounded-lg text-dim/40 hover:text-red hover:bg-red/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
