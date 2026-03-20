import { useState, useEffect, useCallback } from "react";
import { Menu, X, Sparkles, ChevronRight, ChevronDown } from "lucide-react";
import {
  getTopics,
  getCoreKnowledge,
  updateCoreKnowledge,
  createCoreKnowledge,
  deleteCoreKnowledge,
  getHighFreq,
  updateHighFreq,
  createTopic,
  deleteTopic,
  generateKnowledge,
} from "../api/interview";

export default function Knowledge() {
  const [topics, setTopics] = useState({});
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("core");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [coreFiles, setCoreFiles] = useState([]);
  const [expandedFile, setExpandedFile] = useState(null);
  const [editContent, setEditContent] = useState({});
  const [coreSaving, setCoreSaving] = useState(null);

  const [highFreq, setHighFreq] = useState("");
  const [highFreqDraft, setHighFreqDraft] = useState("");
  const [hfSaving, setHfSaving] = useState(false);

  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);

  const [generating, setGenerating] = useState(false);

  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicKey, setNewTopicKey] = useState("");
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicIcon, setNewTopicIcon] = useState("📝");

  const refreshTopics = useCallback(async () => {
    const t = await getTopics();
    setTopics(t);
    return t;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshTopics().then((t) => {
      const keys = Object.keys(t);
      if (keys.length > 0) setSelected(keys[0]);
    });
  }, [refreshTopics]);

  const loadCore = useCallback(async (topic) => {
    try {
      const files = await getCoreKnowledge(topic);
      setCoreFiles(files);
      setExpandedFile(null);
      const buf = {};
      files.forEach((f) => { buf[f.filename] = f.content; });
      setEditContent(buf);
    } catch { setCoreFiles([]); }
  }, []);

  const loadHighFreq = useCallback(async (topic) => {
    try {
      const data = await getHighFreq(topic);
      setHighFreq(data.content || "");
      setHighFreqDraft(data.content || "");
    } catch { setHighFreq(""); setHighFreqDraft(""); }
  }, []);

  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCore(selected);
    loadHighFreq(selected);
  }, [selected, loadCore, loadHighFreq]);

  const handleSaveCore = async (filename) => {
    setCoreSaving(filename);
    try {
      await updateCoreKnowledge(selected, filename, editContent[filename] || "");
      setCoreFiles((prev) => prev.map((f) => f.filename === filename ? { ...f, content: editContent[filename] } : f));
    } catch (e) { alert("保存失败: " + e.message); }
    setTimeout(() => setCoreSaving(null), 1500);
  };

  const handleSaveHighFreq = async () => {
    setHfSaving(true);
    try {
      await updateHighFreq(selected, highFreqDraft);
      setHighFreq(highFreqDraft);
    } catch (e) { alert("保存失败: " + e.message); }
    setTimeout(() => setHfSaving(false), 1500);
  };

  const handleCreateFile = async () => {
    const name = newFileName.trim();
    if (!name) return;
    const fname = name.endsWith(".md") ? name : name + ".md";
    try {
      await createCoreKnowledge(selected, fname, "");
      setNewFileName("");
      setShowNewFile(false);
      loadCore(selected);
    } catch (e) { alert("创建失败: " + e.message); }
  };

  const handleDeleteFile = async (filename) => {
    if (!confirm(`确定删除「${filename}」？此操作不可撤销。`)) return;
    try {
      await deleteCoreKnowledge(selected, filename);
      setCoreFiles((prev) => prev.filter((f) => f.filename !== filename));
      if (expandedFile === filename) setExpandedFile(null);
    } catch (e) { alert("删除失败: " + e.message); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateKnowledge(selected);
      await loadCore(selected);
      setExpandedFile("README.md");
    } catch (e) { alert("生成失败: " + e.message); }
    setGenerating(false);
  };

  const coreIsEmpty = coreFiles.length === 0 ||
    (coreFiles.length === 1 && coreFiles[0].filename === "README.md" && (coreFiles[0].content?.length || 0) <= 20);

  const handleAddTopic = async () => {
    const key = newTopicKey.trim();
    const name = newTopicName.trim();
    if (!key || !name) return;
    try {
      await createTopic(key, name, newTopicIcon);
      setNewTopicKey(""); setNewTopicName(""); setNewTopicIcon("📝");
      setShowAddTopic(false);
      await refreshTopics();
      setSelected(key);
    } catch (e) { alert("添加失败: " + e.message); }
  };

  const handleDeleteTopic = async (key) => {
    if (!confirm(`确定删除「${topics[key]?.name || key}」？`)) return;
    try {
      await deleteTopic(key);
      const t = await refreshTopics();
      const keys = Object.keys(t);
      if (selected === key) setSelected(keys.length > 0 ? keys[0] : null);
    } catch (e) { alert("删除失败: " + e.message); }
  };

  const topicKeys = Object.keys(topics);

  const selectTopic = (key) => {
    setSelected(key);
    setSidebarOpen(false);
  };

  return (
    <div className="flex flex-1 overflow-hidden h-[calc(100vh-65px)]">
      {/* Mobile sidebar toggle */}
      <button
        className="fixed bottom-4 right-4 z-40 md:hidden w-12 h-12 rounded-full bg-accent text-white text-xl flex items-center justify-center shadow-lg"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
{sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-30 w-[200px] border-r border-border bg-bg p-4 flex flex-col transition-transform duration-200
        md:static md:translate-x-0 md:shrink-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="flex justify-between items-center mb-3 px-2">
          <div className="text-[13px] font-semibold text-dim">专项领域</div>
          <button
            className="w-6 h-6 rounded-md border border-border bg-transparent text-dim text-base flex items-center justify-center transition-all hover:bg-hover hover:text-text leading-none"
            title="新增领域"
            onClick={() => setShowAddTopic(true)}
          >+</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {topicKeys.map((key) => (
            <div key={key} className="relative mb-0.5 group">
              <button
                className={`w-full px-3 py-2.5 rounded-lg border-none text-sm text-left cursor-pointer flex items-center gap-2 transition-all
                  ${selected === key ? "bg-hover text-text" : "bg-transparent text-dim hover:bg-hover"}`}
                onClick={() => selectTopic(key)}
              >
                <span>{topics[key]?.icon || "📝"}</span>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{topics[key]?.name || key}</span>
              </button>
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-dim cursor-pointer text-sm px-1.5 py-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:text-red hover:bg-red/10"
                title="删除领域"
                onClick={() => handleDeleteTopic(key)}
              ><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Add topic modal */}
      {showAddTopic && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddTopic(false)}>
          <div className="bg-card border border-border rounded-2xl px-6 py-7 md:px-8 w-[380px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold mb-5">新增训练领域</div>
            <div className="mb-3.5">
              <label className="text-[13px] text-dim mb-1.5 block">标识（英文，用于 API 路径）</label>
              <input className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg text-text text-sm" placeholder="docker" value={newTopicKey} onChange={(e) => setNewTopicKey(e.target.value)} autoFocus />
            </div>
            <div className="mb-3.5">
              <label className="text-[13px] text-dim mb-1.5 block">显示名称</label>
              <input className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg text-text text-sm" placeholder="Docker 容器化" value={newTopicName} onChange={(e) => setNewTopicName(e.target.value)} />
            </div>
            <div className="mb-3.5">
              <label className="text-[13px] text-dim mb-1.5 block">图标 Emoji</label>
              <input className="w-20 px-3 py-2.5 rounded-lg border border-border bg-bg text-text text-sm" value={newTopicIcon} onChange={(e) => setNewTopicIcon(e.target.value)} maxLength={4} />
            </div>
            <div className="flex gap-2.5 justify-end mt-6">
              <button className="px-5 py-2 rounded-lg border border-border bg-hover text-text text-[13px] cursor-pointer" onClick={() => { setShowAddTopic(false); setNewTopicKey(""); setNewTopicName(""); setNewTopicIcon("📝"); }}>取消</button>
              <button className="px-5 py-2 rounded-lg bg-accent text-white text-[13px] cursor-pointer disabled:opacity-40" onClick={handleAddTopic} disabled={!newTopicKey.trim() || !newTopicName.trim()}>添加</button>
            </div>
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-border px-4 md:px-6 bg-card">
          <button
            className={`px-4 py-3 md:px-5 text-sm border-b-2 transition-all cursor-pointer ${tab === "core" ? "text-text border-b-accent" : "text-dim border-b-transparent bg-transparent"}`}
            onClick={() => setTab("core")}
          >核心知识库</button>
          <button
            className={`px-4 py-3 md:px-5 text-sm border-b-2 transition-all cursor-pointer ${tab === "high_freq" ? "text-text border-b-accent" : "text-dim border-b-transparent bg-transparent"}`}
            onClick={() => setTab("high_freq")}
          >高频题库</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {!selected ? (
            <div className="text-center py-15 text-dim text-sm">选择一个领域</div>
          ) : tab === "core" ? (
            <div>
              <div className="text-[13px] text-dim mb-3">
                AI 出题和评分的参考依据，编辑后影响该领域的题目质量。支持 Markdown 格式。
              </div>
              <div className="flex gap-2 mb-4">
                {showNewFile ? (
                  <>
                    <input className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-text text-[13px]" placeholder="文件名 (例: 装饰器.md)" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateFile()} />
                    <button className="px-5 py-2 rounded-lg bg-accent text-white text-[13px] cursor-pointer" onClick={handleCreateFile}>创建</button>
                    <button className="px-5 py-2 rounded-lg border border-border bg-hover text-text text-[13px] cursor-pointer" onClick={() => { setShowNewFile(false); setNewFileName(""); }}>取消</button>
                  </>
                ) : (
                  <>
                    <button className="px-5 py-2 rounded-lg border border-border bg-hover text-text text-[13px] cursor-pointer" onClick={() => setShowNewFile(true)}>+ 新增文件</button>
                    {coreIsEmpty && (
                      <button
                        className="px-5 py-2 rounded-lg bg-accent/15 border border-accent/40 text-accent-light text-[13px] cursor-pointer disabled:opacity-50"
                        onClick={handleGenerate}
                        disabled={generating}
                      >
                        {generating ? "正在生成..." : <><Sparkles size={14} className="inline -mt-0.5" /> AI 生成基础内容</>}
                      </button>
                    )}
                  </>
                )}
              </div>

              {coreFiles.length === 0 ? (
                <div className="text-center py-15 text-dim text-sm">该领域暂无知识文件</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {coreFiles.map((f) => (
                    <div key={f.filename} className="bg-card border border-border rounded-box overflow-hidden">
                      <div
                        className="flex justify-between items-center px-4 py-3 cursor-pointer text-sm font-medium"
                        onClick={() => setExpandedFile(expandedFile === f.filename ? null : f.filename)}
                      >
                        <span>{f.filename}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-dim flex items-center gap-1">{expandedFile === f.filename ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {(f.content?.length || 0)} 字</span>
                          <button
                            className="bg-transparent border-none text-dim cursor-pointer text-sm px-1.5 py-0.5 rounded opacity-50 transition-all hover:text-red hover:opacity-100"
                            title="删除文件"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.filename); }}
                          ><X size={14} /></button>
                        </div>
                      </div>
                      {expandedFile === f.filename && (
                        <div className="border-t border-border p-4">
                          <textarea
                            className="w-full min-h-[300px] p-3 rounded-lg border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y"
                            value={editContent[f.filename] ?? f.content}
                            onChange={(e) => setEditContent((prev) => ({ ...prev, [f.filename]: e.target.value }))}
                          />
                          <div className="flex gap-2 mt-3 justify-end">
                            {coreSaving === f.filename && <span className="text-xs text-green self-center mr-3">已保存</span>}
                            <button className="px-5 py-2 rounded-lg bg-accent text-white text-[13px] cursor-pointer" onClick={() => handleSaveCore(f.filename)}>保存</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[13px] text-dim mb-3">
                标记的高频面试考点，出题时会优先覆盖。支持 Markdown 格式。
              </div>
              <textarea
                className="w-full min-h-[500px] p-3 rounded-lg border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y"
                value={highFreqDraft}
                onChange={(e) => setHighFreqDraft(e.target.value)}
                placeholder={"# 高频题\n\n## 1. xxx原理是什么？为什么这样设计？\n\n## 2. 实际项目中遇到xxx问题怎么解决？"}
              />
              <div className="flex gap-2 mt-3 justify-end">
                {hfSaving && <span className="text-xs text-green self-center mr-3">已保存</span>}
                {highFreqDraft !== highFreq && (
                  <button className="px-5 py-2 rounded-lg border border-border bg-hover text-text text-[13px] cursor-pointer" onClick={() => setHighFreqDraft(highFreq)}>撤销修改</button>
                )}
                <button className="px-5 py-2 rounded-lg bg-accent text-white text-[13px] cursor-pointer disabled:opacity-40" onClick={handleSaveHighFreq} disabled={highFreqDraft === highFreq}>保存</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
