import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Menu, X, Sparkles, Upload, ChevronRight, ChevronDown } from "lucide-react";
import { getTopicIcon } from "../utils/topicIcons";
import { getTopics, deleteTopic, type TopicsResponse } from "../api/topics";
import {
  getCoreKnowledge,
  updateCoreKnowledge,
  createCoreKnowledge,
  deleteCoreKnowledge,
  getHighFreq,
  updateHighFreq,
  generateKnowledge,
  uploadKnowledgeDoc,
  type CoreKnowledgeFile,
} from "../api/knowledge";
import AddTopicDialog from "../components/AddTopicDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import ErrorState from "@/components/ErrorState";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function Knowledge() {
  const [topics, setTopics] = useState<TopicsResponse>({});
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicsReloadNonce, setTopicsReloadNonce] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"core" | "high_freq">("core");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [coreFiles, setCoreFiles] = useState<CoreKnowledgeFile[]>([]);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentReloadNonce, setContentReloadNonce] = useState(0);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [coreSaving, setCoreSaving] = useState<string | null>(null);
  const [coreEditing, setCoreEditing] = useState<string | null>(null);

  const [highFreq, setHighFreq] = useState("");
  const [highFreqDraft, setHighFreqDraft] = useState("");
  const [hfSaving, setHfSaving] = useState(false);
  const [hfEditing, setHfEditing] = useState(false);

  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showAddTopic, setShowAddTopic] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: "file"; filename: string }
    | { kind: "topic"; key: string; name: string }
    | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const refreshTopics = useCallback(async () => {
    const nextTopics = await getTopics();
    setTopics(nextTopics);
    setTopicsError(null);
    return nextTopics;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getTopics({ signal: controller.signal })
      .then((nextTopics) => {
        if (controller.signal.aborted) return;
        setTopics(nextTopics);
        setTopicsError(null);
        const keys = Object.keys(nextTopics);
        setSelected((current) => (current && nextTopics[current] ? current : (keys[0] ?? null)));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTopicsError(errorMessage(error, "加载领域列表失败"));
        }
      });
    return () => controller.abort();
  }, [topicsReloadNonce]);

  const loadCore = useCallback(async (topic: string) => {
    try {
      const files = await getCoreKnowledge(topic);
      setCoreFiles(files);
      setContentError(null);
      setExpandedFile(files[0]?.filename ?? null);
      setCoreEditing(null);
      setEditContent(Object.fromEntries(files.map((file) => [file.filename, file.content])));
    } catch (error) {
      setContentError(errorMessage(error, "加载核心知识失败"));
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    Promise.all([
      getCoreKnowledge(selected, { signal: controller.signal }),
      getHighFreq(selected, { signal: controller.signal }),
    ])
      .then(([files, highFreqData]) => {
        if (controller.signal.aborted) return;
        const highFreqContent = highFreqData.content || "";
        setCoreFiles(files);
        setContentError(null);
        setExpandedFile(files[0]?.filename ?? null);
        setCoreEditing(null);
        setEditContent(Object.fromEntries(files.map((file) => [file.filename, file.content])));
        setHighFreq(highFreqContent);
        setHighFreqDraft(highFreqContent);
        setHfEditing(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setContentError(errorMessage(error, "加载该领域知识内容失败"));
      });
    return () => controller.abort();
  }, [selected, contentReloadNonce]);

  const handleSaveCore = async (filename: string) => {
    if (!selected) return;
    setCoreSaving(filename);
    try {
      await updateCoreKnowledge(selected, filename, editContent[filename] || "");
      setCoreFiles((prev) => prev.map((f) => (f.filename === filename ? { ...f, content: editContent[filename] } : f)));
      setCoreEditing(null);
      toast.success("已保存");
    } catch (e) {
      toast.error("保存失败: " + errorMessage(e));
    }
    setTimeout(() => setCoreSaving(null), 1500);
  };

  const handleSaveHighFreq = async () => {
    if (!selected) return;
    setHfSaving(true);
    try {
      await updateHighFreq(selected, highFreqDraft);
      setHighFreq(highFreqDraft);
      setHfEditing(false);
      toast.success("已保存");
    } catch (e) {
      toast.error("保存失败: " + errorMessage(e));
    }
    setTimeout(() => setHfSaving(false), 1500);
  };

  const handleCreateFile = async () => {
    if (!selected) return;
    const name = newFileName.trim();
    if (!name) return;
    const fname = name.endsWith(".md") ? name : name + ".md";
    try {
      await createCoreKnowledge(selected, fname, "");
      setNewFileName("");
      setShowNewFile(false);
      await loadCore(selected);
      toast.success(`已创建 ${fname}`);
    } catch (e) {
      toast.error("创建失败: " + errorMessage(e));
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!selected || files.length === 0) return;
    setUploading(true);
    const failed: string[] = [];
    let lastUploaded: string | null = null;
    for (const file of files) {
      try {
        const result = await uploadKnowledgeDoc(selected, file);
        lastUploaded = typeof result.filename === "string" ? result.filename : file.name;
      } catch (e) {
        failed.push(`${file.name}: ${errorMessage(e)}`);
      }
    }
    await loadCore(selected);
    if (lastUploaded) setExpandedFile(lastUploaded);
    if (failed.length) {
      toast.error(`部分文件导入失败（${failed.length} 个）`, {
        description: failed.join("；"),
      });
    } else if (lastUploaded) {
      toast.success("文档已导入");
    }
    setUploading(false);
  };

  const handleGenerate = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      await generateKnowledge(selected);
      await loadCore(selected);
      setExpandedFile("README.md");
      toast.success("已生成基础内容");
    } catch (e) {
      toast.error("生成失败: " + errorMessage(e));
    }
    setGenerating(false);
  };

  const coreIsEmpty = coreFiles.length === 0 ||
    (coreFiles.length === 1 && coreFiles[0].filename === "README.md" && (coreFiles[0].content?.length || 0) <= 20);

  const handleTopicCreated = async (key: string) => {
    await refreshTopics();
    setSelected(key);
  };

  const handleConfirmDelete = async () => {
    if (!confirmTarget || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (confirmTarget.kind === "file") {
        if (!selected) return;
        await deleteCoreKnowledge(selected, confirmTarget.filename);
        setCoreFiles((prev) => prev.filter((f) => f.filename !== confirmTarget.filename));
        if (expandedFile === confirmTarget.filename) setExpandedFile(null);
        toast.success(`已删除「${confirmTarget.filename}」`);
      } else {
        await deleteTopic(confirmTarget.key);
        const nextTopics = await refreshTopics();
        const keys = Object.keys(nextTopics);
        if (selected === confirmTarget.key) setSelected(keys.length > 0 ? keys[0] : null);
        toast.success(`已删除领域「${confirmTarget.name}」`);
      }
      setConfirmTarget(null);
    } catch (e) {
      toast.error("删除失败: " + errorMessage(e));
    } finally {
      setConfirmBusy(false);
    }
  };

  const topicKeys = Object.keys(topics);

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      <Button
        variant="gradient"
        size="icon"
        aria-label={sidebarOpen ? "收起领域列表" : "展开领域列表"}
        className="fixed bottom-4 right-4 z-40 md:hidden rounded-full w-12 h-12"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </Button>

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-[212px] border-r border-border bg-bg p-4 flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex justify-between items-center mb-3 px-2">
          <h1 className="text-[13px] font-semibold text-dim">领域管理</h1>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-base"
            title="新增领域"
            aria-label="新增领域"
            onClick={() => setShowAddTopic(true)}
          >
            +
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {topicsError ? (
            <ErrorState
              compact
              title="领域加载失败"
              message={topicsError}
              onRetry={() => setTopicsReloadNonce((n) => n + 1)}
            />
          ) : (
            topicKeys.map((key) => (
              <div key={key} className="relative mb-0.5 group">
                <button
                  type="button"
                  className={cn(
                    "w-full px-3 py-2.5 pr-8 rounded-lg text-sm text-left flex items-center gap-2 transition-all cursor-pointer",
                    selected === key ? "bg-hover text-text font-medium" : "text-dim hover:bg-hover",
                  )}
                  onClick={() => {
                    setSelected(key);
                    setSidebarOpen(false);
                  }}
                >
                  <span className="text-dim">{getTopicIcon(topics[key]?.icon, 16)}</span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {topics[key]?.name || key}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`删除领域 ${topics[key]?.name || key}`}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-dim text-sm px-1.5 py-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red hover:bg-red/10 transition-all cursor-pointer"
                  title="删除领域"
                  onClick={() =>
                    setConfirmTarget({
                      kind: "topic",
                      key,
                      name: topics[key]?.name || key,
                    })}
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <AddTopicDialog
        open={showAddTopic}
        onClose={() => setShowAddTopic(false)}
        onCreated={handleTopicCreated}
      />

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        onOpenChange={(next) => {
          if (!next) setConfirmTarget(null);
        }}
        title={
          confirmTarget?.kind === "file"
            ? `删除「${confirmTarget.filename}」？`
            : `删除领域「${confirmTarget?.name || ""}」？`
        }
        description={
          confirmTarget?.kind === "file"
            ? "删除后该知识文件无法恢复。"
            : "删除后该领域的知识库与高频题库将被移除，此操作不可撤销。"
        }
        confirmLabel="确认删除"
        destructive
        busy={confirmBusy}
        onConfirm={handleConfirmDelete}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex border-b border-border px-4 md:px-6 bg-card">
          {(["core", "high_freq"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "px-4 py-3 md:px-5 text-sm border-b-2 transition-all cursor-pointer",
                tab === t ? "text-text border-b-primary font-medium" : "text-dim border-b-transparent hover:text-text",
              )}
              onClick={() => setTab(t)}
            >
              {t === "core" ? "核心知识库" : "高频题库"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {!selected ? (
            <div className="text-center py-15 text-dim text-sm">
              {topicsError ? "领域列表加载失败，请先点击左侧重试。" : "选择一个领域"}
            </div>
          ) : contentError ? (
            <ErrorState
              title="知识内容加载失败"
              message={contentError}
              onRetry={() => setContentReloadNonce((n) => n + 1)}
            />
          ) : tab === "core" ? (
            <div>
              <div className="text-[13px] text-dim mb-3">
                AI 出题和评分的参考依据，编辑后影响该领域的题目质量。支持 Markdown 编辑，也可导入 md / txt / pdf / docx 文档。
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt,.pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  void handleUploadFiles(files);
                }}
              />
              <div className="flex gap-2 mb-4">
                {showNewFile ? (
                  <div className="flex flex-wrap gap-2 flex-1">
                    <Input
                      className="flex-1 min-w-[200px]"
                      placeholder="文件名 (例: 装饰器.md)"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleCreateFile();
                      }}
                    />
                    <Button variant="gradient" size="sm" onClick={handleCreateFile}>创建</Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowNewFile(false); setNewFileName(""); }}>取消</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowNewFile(true)}>+ 新增文件</Button>
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? "导入中..." : <><Upload size={14} /> 导入文档</>}
                    </Button>
                    {coreIsEmpty && (
                      <Button variant="outline" size="sm" className="border-primary/40 text-primary" onClick={handleGenerate} disabled={generating}>
                        {generating ? "正在生成..." : <><Sparkles size={14} /> AI 生成基础内容</>}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {coreFiles.length === 0 ? (
                <div className="text-center py-15 text-dim text-sm">该领域暂无知识文件</div>
              ) : (
                <div className="flex flex-col gap-3 stagger-children">
                  {coreFiles.map((f) => (
                    <Card key={f.filename} className="overflow-hidden">
                      <div
                        className="flex justify-between items-center px-4 py-3 cursor-pointer text-sm font-medium hover:bg-hover/50 transition-colors"
                        onClick={() => {
                          setExpandedFile(expandedFile === f.filename ? null : f.filename);
                          setCoreEditing(null);
                        }}
                      >
                        <span className="truncate">{f.filename}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-dim flex items-center gap-1">
                            {expandedFile === f.filename ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {(f.content?.length || 0)} 字
                          </span>
                          <button
                            type="button"
                            aria-label={`删除文件 ${f.filename}`}
                            className="text-dim cursor-pointer p-1 rounded opacity-50 hover:text-red hover:opacity-100 transition-all"
                            title="删除文件"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmTarget({ kind: "file", filename: f.filename });
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      {expandedFile === f.filename && (
                        <div className="border-t border-border p-4 animate-fade-in">
                          {coreEditing === f.filename ? (
                            <>
                              <textarea
                                className="w-full min-h-[300px] p-3 rounded-lg border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-primary"
                                value={editContent[f.filename] ?? f.content}
                                onChange={(e) => setEditContent((prev) => ({ ...prev, [f.filename]: e.target.value }))}
                                autoFocus
                              />
                              <div className="flex gap-2 mt-3 justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditContent((prev) => ({ ...prev, [f.filename]: f.content }));
                                    setCoreEditing(null);
                                  }}
                                >
                                  取消
                                </Button>
                                <Button variant="gradient" size="sm" onClick={() => handleSaveCore(f.filename)}>保存</Button>
                              </div>
                            </>
                          ) : (
                            <>
                              {(editContent[f.filename] ?? f.content)?.trim() ? (
                                <div className="md-content text-sm leading-6 text-text">
                                  <ReactMarkdown>{editContent[f.filename] ?? f.content}</ReactMarkdown>
                                </div>
                              ) : (
                                <div className="text-dim text-sm py-6 text-center">空文件，点「编辑」添加内容</div>
                              )}
                              <div className="flex gap-2 mt-3 justify-end items-center">
                                {coreSaving === f.filename && <span className="text-xs text-green mr-1">已保存</span>}
                                <Button variant="outline" size="sm" onClick={() => setCoreEditing(f.filename)}>编辑</Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[13px] text-dim mb-3">
                标记的高频面试考点，出题时会优先覆盖。建议一行一题，或一个「##」标题一题，方便出题精准覆盖。
              </div>
              {hfEditing ? (
                <>
                  <textarea
                    className="w-full min-h-[500px] p-3 rounded-xl border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-primary"
                    value={highFreqDraft}
                    onChange={(e) => setHighFreqDraft(e.target.value)}
                    placeholder={"# 高频题\n\n## 1. xxx原理是什么？为什么这样设计？\n\n## 2. 实际项目中遇到xxx问题怎么解决？"}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3 justify-end">
                    {hfSaving && <span className="text-xs text-green self-center mr-3">已保存</span>}
                    {highFreqDraft !== highFreq && (
                      <Button variant="outline" size="sm" onClick={() => setHighFreqDraft(highFreq)}>撤销修改</Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => { setHighFreqDraft(highFreq); setHfEditing(false); }}>取消</Button>
                    <Button variant="gradient" size="sm" onClick={handleSaveHighFreq} disabled={highFreqDraft === highFreq}>保存</Button>
                  </div>
                </>
              ) : (
                <>
                  {highFreq.trim() ? (
                    <div className="md-content text-sm leading-6 text-text rounded-xl border border-border bg-bg p-4">
                      <ReactMarkdown>{highFreq}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-dim text-sm py-10 text-center rounded-xl border border-border bg-bg">
                      暂无高频题，点「编辑」添加
                    </div>
                  )}
                  <div className="flex gap-2 mt-3 justify-end items-center">
                    {hfSaving && <span className="text-xs text-green mr-1">已保存</span>}
                    <Button variant="outline" size="sm" onClick={() => setHfEditing(true)}>编辑</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
