import { useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Database, Download, Loader2, Upload } from "lucide-react";
import { exportPersonalData, exportSystemData, importData } from "@/api/dataMigration";
import { errorMessage } from "@/lib/errorMessage";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IMPORT_DB_OPTIONS, labelClass } from "./constants";

export default function DataMigrationSection({ isAdmin }: { isAdmin: boolean }) {
  const [exporting, setExporting] = useState<"personal" | "system" | null>(null);
  const [includeSensitiveCredentials, setIncludeSensitiveCredentials] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDbStrategy, setImportDbStrategy] = useState<"skip" | "overwrite">("skip");
  const [importOverwriteFiles, setImportOverwriteFiles] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState("");
  const [migrationError, setMigrationError] = useState("");
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async (kind: "personal" | "system") => {
    setExporting(kind);
    setMigrationError("");
    setMigrationMessage("");
    try {
      const { filename, size } = kind === "system"
        ? await exportSystemData()
        : await exportPersonalData(includeSensitiveCredentials);
      const sizeMb = (size / 1024 / 1024).toFixed(2);
      setMigrationMessage(`已下载 ${filename} (${sizeMb} MB)`);
    } catch (err) {
      setMigrationError("导出失败：" + errorMessage(err, "未知错误"));
    } finally {
      setExporting(null);
    }
  };

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setImportFile(event.target.files?.[0] ?? null);
    setImportConfirming(false);
    setMigrationMessage("");
    setMigrationError("");
  };

  const handleImportClick = () => {
    if (!importFile) return;
    setImportConfirming(true);
  };

  const handleImportConfirm = async () => {
    if (!importFile || importBusy) return;
    setImportBusy(true);
    setMigrationError("");
    setMigrationMessage("");
    try {
      const r = await importData(importFile, {
        dbStrategy: importDbStrategy,
        overwriteFiles: importOverwriteFiles,
      });
      setMigrationMessage(
        `已导入：数据写入/更新 ${r.db_inserted} 条，跳过 ${r.db_skipped} 条；文件复制或合并 ${r.files_copied} 个，跳过 ${r.files_skipped} 个。个人画像已与本地画像合并，练习统计已按去重后的记录重新计算。向量索引未随备份迁移，请到 Embedding 设置中重建索引。`
      );
      setImportFile(null);
      setImportConfirming(false);
      if (importFileInputRef.current) importFileInputRef.current.value = "";
    } catch (err) {
      setMigrationError("导入失败：" + errorMessage(err, "未知错误"));
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <Card id="settings-migration" data-tab-id="migration" className="overflow-hidden border-border/40 bg-card/40 scroll-mt-4">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Database size={16} className="text-primary" />
          <h2 className="text-base font-semibold">数据迁移</h2>
        </div>
        <div className="text-[13px] text-dim mb-5">
          {isAdmin
            ? "每个账户都可导出或导入自己的数据；管理员还可导出整站全量备份。"
            : "导出你的画像、训练记录、简历、知识库、个人资料和成长 Agent 对话，也可以把个人备份导入当前账户。"}
        </div>

        <div className="space-y-5">
          {/* Personal export */}
          <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-medium mb-0.5">导出我的数据</div>
                <div className="text-[12px] text-dim/70">
                  包含画像、训练与错题、简历、知识库、上传文档和成长 Agent 对话
                </div>
              </div>
              <Button
                variant="outline"
                disabled={Boolean(exporting)}
                onClick={() => handleExport("personal")}
              >
                {exporting === "personal" ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Download size={14} className="mr-1.5" />
                )}
                {exporting === "personal" ? "导出中..." : "导出我的数据"}
              </Button>
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
              <input
                type="checkbox"
                checked={includeSensitiveCredentials}
                onChange={(event) => setIncludeSensitiveCredentials(event.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block text-[13px] text-text">包含敏感凭据</span>
                <span className="block text-[11px] leading-5 text-dim">
                  包括 LLM / Embedding API Key、外部服务密钥和声纹凭据；默认不导出
                </span>
              </span>
            </label>

            <div className="text-[11px] leading-5 text-dim/80">
              向量索引属于可重建缓存，不进入备份。导入后请重新构建索引。
            </div>
          </div>

          {/* Full-system export */}
          {isAdmin && (
            <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium mb-0.5">导出整站全量数据</div>
                  <div className="text-[12px] text-dim/70">
                    管理员专用：打包全部账户、数据库、用户文件及已保存凭据
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={Boolean(exporting)}
                  onClick={() => handleExport("system")}
                >
                  {exporting === "system" ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <Download size={14} className="mr-1.5" />
                  )}
                  {exporting === "system" ? "导出中..." : "导出整站数据"}
                </Button>
              </div>
            </div>
          )}

          {/* Import */}
          <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-4 space-y-4">
            <div>
              <div className="text-sm font-medium mb-0.5">从备份导入</div>
              <div className="text-[12px] text-dim/70">仅支持单账户备份，归档数据将归到当前登录账户</div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={importFileInputRef}
                type="file"
                accept=".gz,.tgz,application/gzip,application/x-gzip"
                onChange={handleImportFileChange}
                disabled={importBusy}
                className="min-w-0 max-w-full text-[12px] text-dim file:mr-3 file:rounded-lg file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:bg-hover"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className={labelClass}>练习与对话记录冲突策略</Label>
                <div className="flex gap-2">
                  {IMPORT_DB_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={importBusy}
                      onClick={() => setImportDbStrategy(opt.value)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-[13px] transition-all",
                        importDbStrategy === opt.value
                          ? "bg-primary/12 text-primary border-primary/50 font-medium"
                          : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>文件冲突</Label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={importOverwriteFiles}
                    disabled={importBusy}
                    onChange={(e) => setImportOverwriteFiles(e.target.checked)}
                    className="accent-primary"
                  />
                  <span className="text-[13px] text-dim">用归档文件覆盖本地（个人画像始终安全合并）</span>
                </label>
              </div>
            </div>

            {importConfirming ? (
              <div className="rounded-lg border border-amber-400/40 bg-amber-400/8 px-3 py-3">
                <div className="flex items-start gap-2 mb-2.5">
                  <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-[13px]">
                    将把 <span className="break-all font-medium">{importFile?.name}</span> 合并到当前账户。
                    {importDbStrategy === "overwrite" && "当前账户内同 ID 的数据会被覆盖。"}
                    {importOverwriteFiles && "除个人画像外，其他同名用户文件会被覆盖。"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={importBusy} onClick={() => setImportConfirming(false)}>
                    取消
                  </Button>
                  <Button variant="gradient" disabled={importBusy} onClick={handleImportConfirm}>
                    {importBusy && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                    {importBusy ? "导入中..." : "确认导入"}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button variant="outline" disabled={!importFile || importBusy} onClick={handleImportClick}>
                  <Upload size={14} className="mr-1.5" />
                  导入
                </Button>
              </div>
            )}
          </div>

          {(migrationMessage || migrationError) && (
            <div role={migrationError ? "alert" : "status"} className={cn("break-words text-[12px]", migrationError ? "text-red" : "text-dim")}>
              {migrationError || migrationMessage}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
