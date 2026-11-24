import { useEffect, useState } from "react";
import type { IndexRebuildProgress } from "@techspar/contracts/events";
import { AlertTriangle, Boxes, Check, Eye, EyeOff, Loader2, RotateCw } from "lucide-react";
import { rebuildEmbeddingIndex, testEmbeddingConnection } from "@/api/settings";
import { errorMessage } from "@/lib/errorMessage";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EMBEDDING_BACKEND_OPTIONS, inputClass, labelClass } from "./constants";
import ConnectionTestRow from "./ConnectionTestRow";
import type { ConnectionTestResult, SettingsSectionProps } from "./types";

interface EmbeddingSectionProps extends SettingsSectionProps<"embedding"> {
  indexRevision: number;
  initialLastReindexAt: string;
}

interface RebuildResult {
  revision: number;
  error?: string;
}

export default function EmbeddingSection({
  value,
  onChange,
  indexRevision,
  initialLastReindexAt,
}: EmbeddingSectionProps) {
  const {
    backend: embBackend,
    api_base: embApiBase,
    api_key: embApiKey,
    api_model: embApiModel,
    api_batch_size: embApiBatchSize,
    local_model: embLocalModel,
    local_path: embLocalPath,
  } = value;
  const [showEmbKey, setShowEmbKey] = useState(false);
  const [embTest, setEmbTest] = useState<ConnectionTestResult | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<IndexRebuildProgress | null>(null);
  const [rebuildResult, setRebuildResult] = useState<RebuildResult | null>(null);
  const [rebuiltRevision, setRebuiltRevision] = useState(0);
  const [forceNeedsReindex, setForceNeedsReindex] = useState(false);
  const [lastReindexAt, setLastReindexAt] = useState(initialLastReindexAt);

  const needsReindex = forceNeedsReindex || indexRevision !== rebuiltRevision;
  const currentResult = rebuildResult?.revision === indexRevision ? rebuildResult : null;
  const reindexDone = currentResult !== null && !currentResult.error;
  const reindexError = currentResult?.error;

  useEffect(() => {
    if (!reindexDone) return;
    const timer = window.setTimeout(() => setRebuildResult(null), 3000);
    return () => window.clearTimeout(timer);
  }, [reindexDone, currentResult]);

  async function handleTestEmbedding() {
    setEmbTest({ status: "testing" });
    try {
      const result = await testEmbeddingConnection(value);
      setEmbTest(result.ok ? { status: "ok" } : { status: "fail", error: result.error });
    } catch (error) {
      setEmbTest({ status: "fail", error: errorMessage(error, "连接失败") });
    }
  }

  async function handleRebuildIndex() {
    setReindexing(true);
    setRebuildResult(null);
    setReindexProgress(null);
    let rebuildFailed = false;
    try {
      await rebuildEmbeddingIndex({
        onProgress: (p) => {
          setReindexProgress(p);
          if (p.status === "error") {
            rebuildFailed = true;
            setForceNeedsReindex(true);
            setRebuildResult({ revision: indexRevision, error: `${p.label}重建失败: ${p.error}` });
          }
        },
        onDone: (result) => {
          if (rebuildFailed) return;
          setForceNeedsReindex(false);
          setRebuiltRevision(indexRevision);
          setLastReindexAt(result.last_rebuild_at || "");
          setRebuildResult({ revision: indexRevision });
        },
      });
    } catch (error) {
      setRebuildResult({ revision: indexRevision, error: "重建失败：" + errorMessage(error) });
    } finally {
      setReindexing(false);
      setReindexProgress(null);
    }
  }

  return (
    <Card id="settings-embedding" data-tab-id="embedding" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Boxes size={16} className="text-primary" />
          <h2 className="text-base font-semibold">Embedding 模型</h2>
        </div>
        <div className="text-[13px] text-dim mb-6">
          你自己的 Embedding，仅对你生效；用于题库、知识库、个人资料库和记忆的向量化，必须配置。简历会直接读取全文，不使用 Embedding。
          <span className="text-amber-500/90">更换模型后请点下方「更新向量索引」重建。历史会话记忆正文会保留，重建成功后恢复检索。</span>
        </div>

        <div className="space-y-2.5 mb-5">
          <Label className={labelClass}>后端模式</Label>
          <div className="flex flex-wrap gap-2">
            {EMBEDDING_BACKEND_OPTIONS.map((opt) => (
              <button
                key={opt.value || "auto"}
                type="button"
                onClick={() => onChange({ backend: opt.value })}
                className={cn(
                  "px-4 py-2 rounded-xl border text-sm transition-all",
                  embBackend === opt.value
                    ? "bg-primary/12 text-primary border-primary/50 font-medium"
                    : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="text-[12px] text-dim/70 mt-1 min-h-[18px]">
            {EMBEDDING_BACKEND_OPTIONS.find((o) => o.value === embBackend)?.hint}
          </div>
        </div>

        {(embBackend === "" || embBackend === "api") && (
          <div className="space-y-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/60">API 模式</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className={labelClass}>API Base URL</Label>
                <Input
                  className={inputClass}
                  placeholder="例：https://api.openai.com/v1（OpenAI 官方留空亦可）"
                  value={embApiBase}
                  onChange={(e) => onChange({ api_base: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Embedding Model</Label>
                <Input
                  className={inputClass}
                  placeholder="例：BAAI/bge-m3"
                  value={embApiModel}
                  onChange={(e) => onChange({ api_model: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className={labelClass}>API Key</Label>
              <div className="relative">
                <Input
                  className={cn(inputClass, "pr-11")}
                  masked={!showEmbKey}
                  placeholder="sk-..."
                  value={embApiKey}
                  onChange={(e) => onChange({ api_key: e.target.value })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                  onClick={() => setShowEmbKey((v) => !v)}
                >
                  {showEmbKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={labelClass}>单批文本数 (Batch Size)</Label>
              <Input
                className={cn(inputClass, "max-w-[160px]")}
                type="number"
                min={1}
                max={2048}
                value={embApiBatchSize}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  onChange({ api_batch_size: Number.isNaN(v) ? 1 : Math.min(2048, Math.max(1, v)) });
                }}
              />
              <div className="text-[12px] text-dim/70">
                每次请求的文本条数上限，因服务商而异（如 DashScope 10、OpenAI 可上千）。默认 10 最稳妥，按你的服务商上限调大；超限会报 400。
              </div>
            </div>
          </div>
        )}

        {(embBackend === "" || embBackend === "local") && (
          <div className={cn("space-y-4", embBackend === "" && "mt-6 border-t border-border/40 pt-5")}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/60">本地模式</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className={labelClass}>Model Name</Label>
                <Input
                  className={inputClass}
                  placeholder="例：Xenova/bge-m3"
                  value={embLocalModel}
                  onChange={(e) => onChange({ local_model: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>本地路径 (可选)</Label>
                <Input
                  className={inputClass}
                  placeholder="留空时按 model name 在线下载"
                  value={embLocalPath}
                  onChange={(e) => onChange({ local_path: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        <ConnectionTestRow test={embTest} onTest={handleTestEmbedding} />

        {needsReindex && (
          <div className="mt-6 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-[13px] text-amber-500/90">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              你更换了 Embedding 模型，旧向量已失效。点击下方按钮重建知识库 / 个人资料库 / 记忆向量；
              在重建前，相关检索结果会暂时为空。
            </span>
          </div>
        )}

        <div className="mt-6 space-y-3 border-t border-border/40 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={handleRebuildIndex}
              disabled={reindexing}
              className="h-10 rounded-xl"
            >
              {reindexing ? (
                <>
                  <Loader2 size={15} className="mr-1.5 animate-spin" /> 重建中…
                </>
              ) : (
                <>
                  <RotateCw size={15} className="mr-1.5" /> 更新向量索引
                </>
              )}
            </Button>
            {!reindexing &&
              (reindexDone ? (
                <span className="flex items-center gap-1.5 text-[13px] text-emerald-500">
                  <Check size={15} /> 已重建
                </span>
              ) : reindexError ? (
                  <span role="alert" className="min-w-0 break-words text-[13px] text-red-500">{reindexError}</span>
              ) : lastReindexAt ? (
                <span className="text-[12px] text-dim">
                  上次更新：{lastReindexAt.replace("T", " ").slice(0, 16)}
                </span>
              ) : (
                <span className="text-[12px] text-dim">
                  更换 Embedding 模型并保存后，点此用新模型重建知识库 / 个人资料库 / 记忆向量
                </span>
              ))}
          </div>

          {reindexing && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px] text-dim">
                <span className="truncate">
                  {reindexProgress
                    ? `${reindexProgress.label}${reindexProgress.status === "error" ? "（失败，已跳过）" : "…"}`
                    : "准备中…"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {reindexProgress ? `${reindexProgress.completed}/${reindexProgress.total}` : ""}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: reindexProgress?.total
                      ? `${Math.round((reindexProgress.completed / reindexProgress.total) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
