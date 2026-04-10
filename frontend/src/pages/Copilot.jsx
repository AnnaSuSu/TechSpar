import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Brain, CheckCircle2, ChevronRight, Loader2, Mic, MicOff,
  AlertTriangle, Send, Eye, Radio, Target,
  Sparkles, FileText, User, ShieldAlert, Plus, Trash2, Clock,
  ChevronLeft, Building2, Maximize2, Minimize2,
} from "lucide-react";
import {
  listCopilotPreps,
  startCopilotPrep,
  getCopilotPrepStatus,
  deleteCopilotPrep,
} from "../api/copilot";
import { getResumeStatus, getProfile } from "../api/interview";
import { getVoiceprintStatus } from "../api/voiceprint";
import useCopilotStream from "../hooks/useCopilotStream";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PAGE_CLASS = "flex-1 w-full max-w-[1600px] mx-auto px-4 py-6 md:px-7 md:py-8 xl:px-10 2xl:px-12";

/* ── Inject micro-animation keyframes once ── */
const COPILOT_STYLE_ID = "copilot-micro-animations";
if (typeof document !== "undefined" && !document.getElementById(COPILOT_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = COPILOT_STYLE_ID;
  style.textContent = `
    @keyframes copilot-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes copilot-pulse-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } 50% { box-shadow: 0 0 12px 2px rgba(239,68,68,0.15); } }
    @keyframes copilot-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes copilot-breathe { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.35); } }
    @keyframes copilot-connection-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); } 50% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } }
    @keyframes copilot-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
    .copilot-blink { animation: copilot-blink 0.9s step-end infinite; }
    .copilot-fade-up { animation: copilot-fade-up 0.45s cubic-bezier(0.16,1,0.3,1) both; }
    .copilot-stagger-1 { animation-delay: 0.05s; }
    .copilot-stagger-2 { animation-delay: 0.1s; }
    .copilot-stagger-3 { animation-delay: 0.15s; }
    .copilot-stagger-4 { animation-delay: 0.2s; }
    .copilot-danger-glow { animation: copilot-pulse-glow 2.5s ease-in-out infinite; }
    .copilot-shimmer-bg { background: linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%); background-size: 200% 100%; animation: copilot-shimmer 2s infinite linear; }
    .copilot-breathe { animation: copilot-breathe 2s ease-in-out infinite; }
    .copilot-connected-pulse { animation: copilot-connection-pulse 2s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

function formatFileSize(size) {
  if (!size) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch { return ""; }
}


// ══════════════════════════════════════════════════════════════
// Phase 0: List View (default)
// ══════════════════════════════════════════════════════════════

function ListView({ onNew, onSelect }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await listCopilotPreps();
      setItems(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll running items
  useEffect(() => {
    const hasRunning = items.some((i) => i.status === "running");
    if (!hasRunning) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [items, load]);

  const handleDelete = async (prepId, e) => {
    e.stopPropagation();
    try {
      await deleteCopilotPrep(prepId);
      setItems((prev) => prev.filter((i) => i.prep_id !== prepId));
    } catch { /* ignore */ }
  };

  return (
    <div className={PAGE_CLASS}>
      {/* Header */}
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

      {/* List */}
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
                  <Badge variant={
                    item.status === "done" ? "green"
                    : item.status === "running" ? "blue"
                    : "destructive"
                  } className="text-xs shrink-0">
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
                      onClick={(e) => handleDelete(item.prep_id, e)}
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


// ══════════════════════════════════════════════════════════════
// Phase 1: Create / Detail View
// ══════════════════════════════════════════════════════════════

function DetailView({ prepId: initialPrepId, onBack, onStartInterview }) {
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [jdText, setJdText] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [loadingResume, setLoadingResume] = useState(true);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [prepId, setPrepId] = useState(initialPrepId);
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const isNew = !initialPrepId;
  const charCount = jdText.trim().length;
  const resumeReady = !!resumeFile;
  const canSubmit = charCount >= 50 && !submitting && !prepId;
  const isRunning = status?.status === "running";
  const isDone = status?.status === "done";
  const weakPointCount = profile?.weak_points?.length || 0;
  const topicCount = Object.keys(profile?.topic_mastery || {}).length;

  useEffect(() => {
    getResumeStatus()
      .then((data) => { if (data.has_resume) setResumeFile({ filename: data.filename, size: data.size }); })
      .catch(() => {})
      .finally(() => setLoadingResume(false));
    getProfile()
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, []);

  // If viewing existing prep, load its status
  useEffect(() => {
    if (!initialPrepId) return;
    const loadStatus = async () => {
      try {
        const data = await getCopilotPrepStatus(initialPrepId);
        setStatus(data);
        if (data.company) setCompany(data.company);
        if (data.position) setPosition(data.position);
      } catch (e) { setError(e.message); }
    };
    loadStatus();
  }, [initialPrepId]);

  // Poll while running
  useEffect(() => {
    if (!prepId || !isRunning) return;
    const poll = async () => {
      try {
        const data = await getCopilotPrepStatus(prepId);
        setStatus(data);
        if (data.status !== "running") clearInterval(pollRef.current);
        if (data.status === "error") setError(data.error || "Prep failed");
      } catch (e) {
        setError(e.message);
        clearInterval(pollRef.current);
      }
    };
    pollRef.current = setInterval(poll, 1500);
    return () => clearInterval(pollRef.current);
  }, [prepId, isRunning]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const { prep_id } = await startCopilotPrep({ jdText, company, position });
      setPrepId(prep_id);
      setStatus({ status: "running", progress: "初始化中..." });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={PAGE_CLASS}>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-dim hover:text-text transition-colors mb-5"
      >
        <ChevronLeft size={16} /> 返回列表
      </button>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_380px] 2xl:grid-cols-[minmax(0,1.65fr)_400px]">
        {/* ── Left: Input Area ── */}
        <div className="space-y-5">
          <Card className="overflow-hidden border-border/80 bg-card/76">
            <CardContent className="p-5 md:p-6 xl:p-7">
              <div className="flex flex-col gap-6">
                <div className="border-b border-border/70 pb-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">
                    {isNew ? "新建面试准备" : "面试准备详情"}
                  </div>
                  <div className="mt-2 text-2xl font-display font-bold tracking-tight md:text-3xl">面试 Copilot</div>
                  <div className="mt-1.5 max-w-2xl text-sm leading-6 text-dim">
                    {isNew
                      ? "填写目标公司和 JD，Copilot 会并行分析公司信息、拆解岗位要求、评估简历匹配度，生成 HR 提问策略树。"
                      : "查看 Copilot 的分析结果，准备好后点击「开始面试辅助」进入实时模式。"
                    }
                  </div>
                </div>

                {/* Company + Position */}
                {prepId ? (
                  <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-border/40 bg-black/[0.01] dark:bg-white/[0.01] px-5 py-4">
                    <div className="flex flex-col gap-1 min-w-[120px]">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">目标公司</span>
                      <span className="text-[17px] font-semibold leading-none">{company || "---"}</span>
                    </div>
                    <div className="h-8 w-px bg-border/60 hidden md:block" />
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">目标岗位</span>
                      <span className="text-[17px] font-semibold leading-none">{position || "---"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">目标公司</Label>
                      <Input
                        className="h-12 rounded-2xl border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background transition-colors px-4"
                        placeholder="例：字节跳动"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">目标岗位</Label>
                      <Input
                        className="h-12 rounded-2xl border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background transition-colors px-4"
                        placeholder="例：AI 后台开发实习生"
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* JD */}
                {isNew && (
                  <div className="rounded-[28px] border border-border/80 bg-background/65 p-4 md:p-5">
                    <div className="flex flex-col gap-3 border-b border-border/70 pb-4 md:flex-row md:items-end md:justify-between">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">岗位 JD</div>
                        <div className="mt-1 text-sm text-dim">越完整，策略树越精准。</div>
                      </div>
                      <div className="rounded-full border border-border/80 bg-card/92 px-3 py-1 text-sm tabular-nums text-dim">
                        {charCount} 字
                      </div>
                    </div>
                    <Textarea
                      className="mt-4 min-h-[280px] rounded-[24px] border-border/70 bg-background/80 px-4 py-4 text-[15px] leading-7 resize-y md:min-h-[360px]"
                      placeholder="粘贴完整 JD。优先保留职责、任职要求、加分项、业务背景和技术栈。"
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      disabled={!!prepId}
                    />
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <HintChip title="至少 50 字" description="低于这个长度分析价值有限。" />
                      <HintChip title="保留原始措辞" description="岗位关键词会影响策略树生成。" />
                      <HintChip title="加分项很重要" description="追问方向往往从加分项展开。" />
                    </div>
                  </div>
                )}

                {/* Context Status Links */}
                <div className="mt-1 flex flex-col gap-1 rounded-2xl border border-border/40 bg-card/20 p-1.5">
                  {/* Resume Row */}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-3.5">
                      <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", resumeReady ? "bg-blue-500/10 text-blue-500" : "bg-dim/10 text-dim")}>
                        <FileText size={16} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-text">简历联动</span>
                        <span className="text-[12px] text-dim">
                          {resumeReady ? `对照经历生成策略树 · ${formatFileSize(resumeFile.size)}` : "未上传简历，将缺少匹配对照"}
                        </span>
                      </div>
                    </div>
                    <Badge variant={resumeReady ? "blue" : "secondary"} className="h-6 rounded-md px-2 text-[10px] uppercase font-bold tracking-wider shadow-sm">
                      {loadingResume ? "Checking" : resumeReady ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  
                  {/* Divider */}
                  <div className="mx-4 h-px bg-border/40" />

                  {/* Profile Row */}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-3.5">
                      <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", topicCount > 0 ? "bg-purple-500/10 text-purple-500" : "bg-dim/10 text-dim")}>
                        <User size={16} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-text">画像联动</span>
                        <span className="text-[12px] text-dim">
                          {topicCount > 0 ? `引入 ${topicCount} 个领域数据及 ${weakPointCount} 个弱点标记` : "暂无画像数据，完成模拟后累积"}
                        </span>
                      </div>
                    </div>
                    <Badge variant={topicCount > 0 ? "purple" : "secondary"} className="h-6 rounded-md px-2 text-[10px] uppercase font-bold tracking-wider shadow-sm">
                      {loadingProfile ? "Loading" : topicCount > 0 ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-2xl border border-red/20 bg-red/10 px-4 py-3 text-sm text-red">{error}</div>
          )}

          {/* Results Block moved inside Left Column */}
          {isDone && status ? (
            <div className="space-y-5">
              <PrepResultCards status={status} />
            </div>
          ) : !prepId && isNew && (
            <Card className="border-dashed border-border/80 bg-card/55">
              <CardContent className="p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Brain size={20} />
                </div>
                <div className="mt-4 text-lg font-semibold">分析结果会在这里展开</div>
                <div className="mt-2 text-sm leading-6 text-dim">
                  包括公司面试风格、岗位匹配度、HR 提问策略树和高危路径标注。
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right: Decision Panel ── */}
        <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden border-primary/15 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.1),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,255,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_34%),linear-gradient(180deg,rgba(24,24,27,0.98),rgba(30,41,59,0.84))]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">决策面板</div>
                  <div className="mt-1 text-lg font-semibold">{isNew ? "准备面试辅助" : "面试辅助状态"}</div>
                </div>
                <div className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  isDone ? "border-green/20 bg-green/8 text-green"
                    : isRunning ? "border-blue-500/20 bg-blue-500/8 text-blue-300"
                    : "border-border/80 bg-card/82 text-text"
                )}>
                  {isDone ? "已就绪" : isRunning ? "分析中" : "待开始"}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <StepRow
                  index="01"
                  title="填写岗位信息"
                  description={charCount >= 50 || !isNew ? "JD 内容已够用。" : "将 JD 补到至少 50 字。"}
                  done={charCount >= 50 || !!prepId}
                />
                <StepRow
                  index="02"
                  title="多 Agent 预处理"
                  description={
                    isDone ? "公司搜索、JD 分析、匹配度评估均已完成。"
                    : isRunning ? status.progress
                    : "并行分析公司信息、JD 要求和简历匹配度。"
                  }
                  done={isDone}
                  active={isRunning}
                />
                <StepRow
                  index="03"
                  title="开始面试辅助"
                  description={isDone ? "准备就绪，可以开启实时辅助。" : "策略树和风险分析完成后可开始。"}
                  done={false}
                  active={isDone}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <MiniMetric label="简历" value={resumeReady ? "On" : "Off"} />
                <MiniMetric label="画像领域" value={topicCount} />
                <MiniMetric label="弱点" value={weakPointCount} />
                <MiniMetric label="JD 长度" value={isNew ? charCount : "---"} />
              </div>

              <div className="mt-5 space-y-3">
                {isNew && !prepId && (
                  <Button variant="gradient" size="lg" className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
                    {submitting
                      ? <><Loader2 size={18} className="animate-spin" /> 初始化中...</>
                      : <><Sparkles size={18} /> 开始准备</>
                    }
                  </Button>
                )}

                {isDone && (
                  <Button variant="gradient" size="lg" className="w-full" onClick={() => onStartInterview(prepId, status)}>
                    <Radio size={18} /> 开始面试辅助
                  </Button>
                )}

                {isRunning && (
                  <div className="flex items-center justify-center gap-2 text-sm text-primary py-2">
                    <Loader2 size={16} className="animate-spin" /> {status.progress}
                  </div>
                )}

                <Button variant="ghost" className="w-full" onClick={onBack}>
                  返回列表
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Hide redundant 当前输入 card when analysis is complete */}
          {!isDone && (
            <Card className="border-border/80">
              <CardContent className="p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">当前输入</div>
                <div className="mt-3 space-y-3 text-sm">
                  <InfoRow label="公司" value={company.trim() || "未填写"} />
                  <InfoRow label="岗位" value={position.trim() || "未填写"} />
                  <InfoRow label="简历" value={resumeReady ? resumeFile.filename : "未检测到"} />
                  <InfoRow label="画像" value={topicCount > 0 ? `${topicCount} 领域 / ${weakPointCount} 弱点` : "暂无"} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>


    </div>
  );
}


function PrepResultCards({ status }) {
  const fitReport = status.fit_report || {};
  const riskMap = status.risk_map || [];
  const jdAnalysis = status.jd_analysis || {};
  const companyReport = (() => { try { return JSON.parse(status.company_report || "{}"); } catch { return {}; } })();

  const highlights = fitReport.highlights || [];
  const gaps = fitReport.gaps || [];
  const skills = jdAnalysis.required_skills || [];
  const dangerNodes = riskMap.filter((r) => r.risk_level === "danger");

  return (
    <>
      {/* ── 第一层：情报摘要，最醒目，第一眼看到 ── */}
      <Card className="copilot-fade-up overflow-hidden border-primary/25 bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.16),transparent_50%),linear-gradient(160deg,rgba(255,255,255,0.99),rgba(228,238,255,0.92))] dark:bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.22),transparent_50%),linear-gradient(160deg,rgba(20,20,28,0.99),rgba(24,32,50,0.92))]">
        <CardContent className="p-5 md:p-7 xl:p-8">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Brain size={20} />
            </div>
            <span className="text-xl font-bold tracking-tight">
              {companyReport.company_name
                ? `${companyReport.company_name} · ${jdAnalysis.role_title || "技术岗位"}`
                : jdAnalysis.role_title || "面试准备完成"}
            </span>
            <Badge variant={fitReport.overall_fit >= 0.7 ? "green" : fitReport.overall_fit >= 0.5 ? "blue" : "destructive"} className="text-xs px-3 py-1">
              匹配度 {Math.round((fitReport.overall_fit || 0) * 100)}%
            </Badge>
            {dangerNodes.length > 0 && (
              <Badge variant="destructive" className="text-xs px-3 py-1">{dangerNodes.length} 个高危区域</Badge>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {fitReport.coach_brief && (
              <div className="copilot-fade-up copilot-stagger-1 rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-primary/8 to-primary/4 px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2.5">
                  <Eye size={14} className="text-primary/70" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary/70">你需要知道</span>
                </div>
                <div className="text-[15px] leading-8 text-text/95">{fitReport.coach_brief}</div>
              </div>
            )}
            {status.risk_summary && (
              <div className="copilot-fade-up copilot-stagger-2 copilot-danger-glow rounded-2xl border-2 border-red/25 bg-gradient-to-br from-red/10 to-red/5 px-5 py-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <ShieldAlert size={14} className="text-red/80" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-red/80">高危区域</span>
                </div>
                <div className="text-[15px] leading-8 text-text/95">{status.risk_summary}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 第二层：公司情报 ── */}
      {(companyReport.interviewer_mindset || companyReport.main_business || companyReport.how_to_reference) && (
        <Card className="copilot-fade-up copilot-stagger-2 border-blue-500/15 bg-gradient-to-r from-blue-500/3 to-transparent">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/12 text-blue-400">
                <Building2 size={16} />
              </div>
              <div className="font-semibold">公司情报</div>
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              {companyReport.main_business && (
                <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-400/70 mb-2">主营业务</div>
                  <div className="text-sm leading-7 text-text/90">{companyReport.main_business}</div>
                </div>
              )}
              {companyReport.interviewer_mindset && (
                <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-400/70 mb-2">面试官关注点</div>
                  <div className="text-sm leading-7 text-text/90">{companyReport.interviewer_mindset}</div>
                </div>
              )}
              {companyReport.how_to_reference && (
                <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-400/70 mb-2">答题时怎么引用</div>
                  <div className="text-sm leading-7 text-text/90">{companyReport.how_to_reference}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 第三层：细节支撑 ── */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="copilot-fade-up copilot-stagger-3 border-green/15 bg-gradient-to-b from-green/3 to-transparent">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green/12 text-green">
                <Target size={16} />
              </div>
              <div className="font-semibold">匹配亮点 / 差距</div>
            </div>
            <div className="space-y-2">
              {highlights.map((h, i) => (
                <div key={i} className="copilot-fade-up rounded-2xl border border-green/20 bg-green/8 px-4 py-3 text-sm leading-7" style={{ animationDelay: `${i * 0.06}s` }}>
                  <span className="text-green mr-2">✓</span>
                  {typeof h === "string" ? h : h.point}
                </div>
              ))}
              {gaps.map((g, i) => (
                <div key={i} className="copilot-fade-up rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm leading-7" style={{ animationDelay: `${(highlights.length + i) * 0.06}s` }}>
                  <div><span className="text-amber-500 mr-2">△</span>{typeof g === "string" ? g : g.point}</div>
                  {g.mitigation && <div className="mt-1 text-[13px] text-dim ml-5">{g.mitigation}</div>}
                </div>
              ))}
              {highlights.length === 0 && gaps.length === 0 && (
                <div className="text-sm text-dim py-2">暂无匹配数据</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="copilot-fade-up copilot-stagger-4 border-red/15 bg-gradient-to-b from-red/3 to-transparent">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red/12 text-red">
                <ShieldAlert size={16} />
              </div>
              <div className="font-semibold">高危路径详情</div>
            </div>
            <div className="space-y-3">
              {riskMap.length > 0 ? riskMap.map((r, i) => (
                <div key={i} className={cn(
                  "copilot-fade-up rounded-2xl border px-4 py-3",
                  r.risk_level === "danger"
                    ? "border-red/25 bg-red/10 copilot-danger-glow"
                    : "border-amber-500/20 bg-amber-500/8"
                )} style={{ animationDelay: `${i * 0.08}s` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={r.risk_level === "danger" ? "destructive" : "secondary"} className="text-xs">{r.risk_level}</Badge>
                    <span className="text-sm font-semibold">{r.node_id}</span>
                  </div>
                  <div className="text-[13px] leading-6 text-dim">{r.reason}</div>
                  {r.avoidance_strategy && <div className="mt-2 text-[13px] leading-6 text-amber-300/80 font-medium">{r.avoidance_strategy}</div>}
                </div>
              )) : (
                <div className="rounded-2xl border border-green/20 bg-green/8 px-4 py-3 text-sm text-green flex items-center gap-2">
                  <CheckCircle2 size={15} /> 未发现高危路径，准备状态良好。
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 第四层：JD 技术栈参考 ── */}
      {skills.length > 0 && (
        <Card className="copilot-fade-up copilot-stagger-4 border-border/80">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <Sparkles size={16} />
              </div>
              <div className="font-semibold">JD 技术栈权重</div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {skills.map((s, i) => (
                <div key={i} className="copilot-fade-up rounded-2xl border border-border/75 bg-card/75 px-4 py-3 hover:border-primary/20 transition-colors" style={{ animationDelay: `${i * 0.04}s` }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{s.skill}</div>
                    <Badge variant={s.weight === "core" ? "blue" : s.weight === "preferred" ? "secondary" : "outline"}>
                      {s.weight}
                    </Badge>
                  </div>
                  {s.jd_evidence && <div className="mt-1 text-[13px] leading-6 text-dim">{s.jd_evidence}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}


// ══════════════════════════════════════════════════════════════
// Phase 2: Realtime
// ══════════════════════════════════════════════════════════════

function RealtimePhase({ prepId, onBack }) {
  const [sessionId] = useState(() => crypto.randomUUID().slice(0, 12));
  const [conversation, setConversation] = useState([]);
  const [manualInput, setManualInput] = useState("");
  const [currentUpdate, setCurrentUpdate] = useState(null);
  const [riskAlert, setRiskAlert] = useState(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerStreaming, setAnswerStreaming] = useState(false);
  const [hrProfile, setHrProfile] = useState(null);
  const [monitorData, setMonitorData] = useState(null);
  const [perfMetrics, setPerfMetrics] = useState(null);
  const [inputRole, setInputRole] = useState("hr");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progressMsg, setProgressMsg] = useState("连接中...");
  const [started, setStarted] = useState(false);
  const [voiceprintAuto, setVoiceprintAuto] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    getVoiceprintStatus()
      .then((s) => setVoiceprintAuto(Boolean(s?.configured && s?.enrolled)))
      .catch(() => {});
  }, []);

  const handleUpdate = useCallback((msg) => {
    switch (msg.type) {
      case "copilot_update":
        setCurrentUpdate(msg);
        setStreamingAnswer("");
        setAnswerLoading(true);
        setAnswerStreaming(false);
        setPerfMetrics(null);
        break;
      case "answer_chunk":
        setStreamingAnswer((prev) => prev + (msg.text || ""));
        setAnswerLoading(false);
        setAnswerStreaming(true);
        break;
      case "answer_meta":
        setPerfMetrics((prev) => ({ ...prev, warming: false, firstTokenMs: msg.first_token_ms }));
        break;
      case "answer_done":
        setAnswerLoading(false);
        setAnswerStreaming(false);
        setPerfMetrics((prev) => ({ ...prev, warming: false, totalMs: msg.total_ms, chunkCount: msg.chunk_count }));
        break;
      case "hr_profile_update": setHrProfile(msg); break;
      case "monitor_update": setMonitorData(msg); break;
      case "risk_alert": setRiskAlert(msg); break;
      case "progress": setProgressMsg(msg.message); break;
      case "started": setStarted(true); setProgressMsg(""); setPerfMetrics({ warming: true }); break;
      case "asr_final":
        if (msg.text) {
          const role = msg.role === "candidate" ? "candidate" : "hr";
          setConversation((prev) => [...prev, { role, text: msg.text }]);
        }
        break;
      case "error": setProgressMsg(`Error: ${msg.message}`); break;
    }
  }, []);

  const {
    connected, listening, asrText,
    connect, startListening, stopListening, sendManualText, sendCandidateResponse, disconnect,
  } = useCopilotStream({ prepId, onUpdate: handleUpdate });

  useEffect(() => { connect(sessionId); }, [connect, sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, currentUpdate]);

  // Fullscreen
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  const handleManualSend = () => {
    const text = manualInput.trim();
    if (!text) return;
    if (inputRole === "hr") {
      setConversation((prev) => [...prev, { role: "hr", text }]);
      sendManualText(text);
    } else {
      setConversation((prev) => [...prev, { role: "candidate", text }]);
      sendCandidateResponse(text);
    }
    setManualInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleManualSend(); }
  };

  const handleEnd = () => { disconnect(); onBack(); };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0 bg-card/50">
        <div className="flex items-center gap-3">
          <Brain size={20} className="text-primary" />
          <span className="font-semibold text-sm">面试 Copilot</span>
          <Badge variant={connected ? "green" : "destructive"} className={cn("text-xs", connected && "copilot-connected-pulse")}>
            <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1.5", connected ? "bg-green copilot-breathe" : "bg-red")} />
            {connected ? "已连接" : "未连接"}
          </Badge>
          {/* LLM 性能指标 */}
          {perfMetrics && (
            <div className="flex items-center gap-1.5 text-[11px] text-dim/70 tabular-nums ml-2 bg-card/80 border border-border/50 rounded-full px-2.5 py-1">
              {perfMetrics.warming ? (
                <>
                  <Loader2 size={10} className="animate-spin text-primary/50" />
                  <span>LLM 测速中...</span>
                </>
              ) : (
                <>
                  <Sparkles size={10} className="text-primary/50" />
                  <span>{(perfMetrics.firstTokenMs / 1000).toFixed(1)}s 首token</span>
                  {perfMetrics.totalMs > 0 && (
                    <>
                      <span className="text-border">·</span>
                      <span>{(perfMetrics.totalMs / 1000).toFixed(1)}s 总耗时</span>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={listening ? "destructive" : "outline"} className="rounded-2xl" onClick={listening ? stopListening : startListening} disabled={!connected || !started}>
            {listening ? <MicOff size={14} className="mr-1.5" /> : <Mic size={14} className="mr-1.5" />}
            {listening ? "停止录音" : "开始录音"}
          </Button>
          <Button size="icon" variant="ghost" className="rounded-2xl h-9 w-9" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button size="sm" variant="ghost" className="rounded-2xl" onClick={handleEnd}>
            结束面试
          </Button>
        </div>
      </div>

      {progressMsg && (
        <div className="px-5 py-2.5 bg-gradient-to-r from-primary/8 to-primary/3 border-b border-primary/10 text-sm text-primary flex items-center gap-2 shrink-0">
          <Loader2 size={14} className="animate-spin" /> {progressMsg}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Chat ── */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          {asrText && (
            <div className="px-5 py-2.5 bg-card/50 border-b border-border/50 text-sm text-dim shrink-0">
              <span className="inline-block w-2 h-2 rounded-full bg-red animate-pulse mr-2 align-middle" />
              HR: {asrText}
            </div>
          )}

          {/* Sticky 横条：顶部全息雷达区 (Top HUD) */}
          <div className="px-5 py-3 border-b border-border/40 bg-background/40 backdrop-blur-md shrink-0 grid grid-cols-2 gap-3 shadow-[0_1px_15px_rgba(0,0,0,0.02)] z-10">
            {/* Phase Radar Card */}
            <div className="min-w-0 rounded-xl border border-border/50 bg-card/65 px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", monitorData?.phase ? "bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "bg-dim/30")} />
                <span className="font-bold text-text uppercase tracking-[0.16em] text-[11px]">
                  {monitorData?.phase || "监听引擎"}
                </span>
              </div>
              <p className={cn("text-[12.5px] leading-[1.55] line-clamp-2", monitorData?.strategy_tip ? "text-cyan-400/95 font-medium" : "text-dim/40")}>
                {monitorData?.strategy_tip || "等待对话启动分析..."}
              </p>
            </div>

            {/* HR Baseline Card */}
            <div className="min-w-0 rounded-xl border border-border/50 bg-card/65 px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", hrProfile ? "bg-violet-500 animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.8)]" : "bg-dim/30")} />
                <span className="font-bold text-text uppercase tracking-[0.16em] text-[11px]">HR 行为基线</span>
              </div>
              <p className={cn("text-[12.5px] leading-[1.55] line-clamp-2", hrProfile ? "text-violet-400/95 font-medium" : "text-dim/40")}>
                {hrProfile ? `${hrProfile.style} · ${hrProfile.advice}` : "数据采集中 (0/3 轮)"}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 relative bg-card/10">
            {conversation.length === 0 && started && (
              <div className="flex flex-col items-center justify-center h-full text-dim text-sm relative">
                {/* Core Pulse Animation */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 dark:opacity-30">
                  <div className="w-[120px] h-[120px] rounded-full border border-primary/20 animate-ping" style={{ animationDuration: '3s' }} />
                  <div className="absolute w-[240px] h-[240px] rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '4s' }} />
                </div>
                
                <div className="relative mb-6 z-10 flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)]">
                  <Mic size={28} className="animate-pulse" />
                </div>
                <p className="font-medium tracking-widest uppercase text-[12px] z-10 text-text/80">AI Copilot 雷达已开启</p>
                <p className="text-[12px] text-dim/50 mt-1.5 z-10">开始录音或在下方手动输入 HR 的开场白...</p>
              </div>
            )}
            {conversation.length === 0 && !started && (
              <div className="flex flex-col items-center justify-center h-full">
                <Loader2 size={28} className="animate-spin text-primary/30 mb-3" />
                <p className="text-sm text-dim/50 uppercase tracking-widest text-[10px] font-bold">Initializing Engine...</p>
              </div>
            )}
            {conversation.map((msg, i) => (
              <div key={i} className={cn(
                "text-sm rounded-2xl px-4 py-3 max-w-[85%] shadow-sm",
                msg.role === "hr" ? "bg-background border border-border/60" : "bg-primary/15 ml-auto border border-primary/10"
              )}>
                <span className="text-[10px] uppercase tracking-widest text-dim/70 font-bold block mb-1">
                  {msg.role === "hr" ? "HR" : "You"}
                </span>
                <span className="leading-relaxed">{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3 bg-card/20 md:px-6">
            {voiceprintAuto ? (
              <div
                className="rounded-xl h-[46px] px-3 shrink-0 text-[11px] font-semibold min-w-[56px] shadow-sm flex items-center justify-center bg-primary/10 text-primary border border-primary/25"
                title="已启用声纹自动识别 HR/You"
              >
                <Radio size={14} className="mr-1" />
                Auto
              </div>
            ) : (
              <Button
                size="sm"
                variant={inputRole === "hr" ? "outline" : "secondary"}
                className="rounded-xl h-[46px] px-3 shrink-0 text-xs font-semibold min-w-[56px] shadow-sm transition-all"
                onClick={() => setInputRole(inputRole === "hr" ? "candidate" : "hr")}
                disabled={!connected || !started}
              >
                {inputRole === "hr" ? "HR" : "You"}
              </Button>
            )}
            <Input className="h-[46px] rounded-xl border-border/80 bg-background shadow-sm px-4 focus-visible:bg-card/50" placeholder={inputRole === "hr" ? "手动输入 HR 的问题..." : "记录你的回答..."} value={manualInput} onChange={(e) => setManualInput(e.target.value)} onKeyDown={handleKeyDown} disabled={!connected || !started} />
            <Button size="icon" className="rounded-xl h-[46px] w-[46px] shrink-0 shadow-sm" onClick={handleManualSend} disabled={!manualInput.trim() || !started}>
              <Send size={16} />
            </Button>
          </div>
        </div>

        {/* ── Right: Copilot Panel (始终显示) ── */}
        <div className="w-[340px] xl:w-[420px] shrink-0 overflow-y-auto bg-card/[0.03] border-l border-border/50">
          <CopilotPanel update={currentUpdate} riskAlert={riskAlert} streamingAnswer={streamingAnswer} answerLoading={answerLoading} answerStreaming={answerStreaming} monitorData={monitorData} />
        </div>
      </div>
    </div>
  );
}

function PanelEmptyState({ active = false }) {
  if (active) {
    return (
      <div className="space-y-2 mt-2">
        <div className="h-2 w-full rounded-full bg-primary/20 copilot-shimmer-bg" />
        <div className="h-2 w-2/3 rounded-full bg-primary/10 copilot-shimmer-bg" style={{ animationDelay: '0.2s' }} />
      </div>
    );
  }
  return (
    <div className="h-4 w-full flex items-center">
      <div className="h-[2px] w-full bg-dim/10 rounded-full" />
    </div>
  );
}

function CopilotPanel({ update, riskAlert, streamingAnswer, answerLoading, answerStreaming, monitorData }) {
  const recommendedPoints = update?.recommended_points || [];
  const children = update?.children || [];
  const prepHint = update?.prep_hint;
  const hasData = !!update;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-border/40">
        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-dim/50">Console Uplink</span>
        <div className="flex gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red/40" />
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" />
          <span className="w-1.5 h-1.5 rounded-full bg-green/40" />
        </div>
      </div>

      {/* 回答评价 */}
      <div className="copilot-fade-up group">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("flex items-center justify-center w-6 h-6 rounded-md", monitorData?.last_answer_feedback ? "bg-cyan-500/10 text-cyan-400" : "bg-dim/10 text-dim/40")}>
            <Eye size={12} />
          </div>
          <span className={cn("text-[11px] font-bold uppercase tracking-[0.15em]", monitorData?.last_answer_feedback ? "text-cyan-400/90" : "text-dim/40")}>回答评价</span>
        </div>
        <div className="pl-[34px]">
          {monitorData?.last_answer_feedback ? (
            <>
              <p className="text-[13px] leading-6 text-text/90 font-medium">{monitorData.last_answer_feedback}</p>
              {monitorData.uncovered_topics?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/30">
                  <span className="text-[11px] text-dim/60 mr-1.5">未覆盖:</span>
                  <span className="text-[11px] text-dim/80 font-medium">{monitorData.uncovered_topics.join("、")}</span>
                </div>
              )}
            </>
          ) : (
            <PanelEmptyState active={false} />
          )}
        </div>
      </div>

      <div className="w-full h-px bg-border/40 ml-[34px] my-4" />

      {/* 当前考察 */}
      <div className="copilot-fade-up copilot-stagger-1 group">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("flex items-center justify-center w-6 h-6 rounded-md", hasData ? "bg-violet-500/10 text-violet-400" : "bg-dim/10 text-dim/40")}>
            <Target size={12} />
          </div>
          <span className={cn("text-[11px] font-bold uppercase tracking-[0.15em]", hasData ? "text-violet-400/90" : "text-dim/40")}>当前考察</span>
        </div>
        <div className="pl-[34px]">
          {hasData ? (
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="border-violet-500/30 text-violet-400 bg-violet-500/5 h-[22px] px-2 shadow-sm rounded-md uppercase tracking-wider text-[10px]">{update.intent || "unknown"}</Badge>
              {update.topic && <span className="text-[13px] font-semibold">{update.topic}</span>}
              {update.confidence > 0 && (
                <span className="text-[11px] text-violet-400/60 ml-auto tabular-nums font-bold">{Math.round(update.confidence * 100)}% Match</span>
              )}
            </div>
          ) : (
            <PanelEmptyState active={false} />
          )}
        </div>
      </div>

      <div className="w-full h-px bg-border/40 ml-[34px] my-4" />

      {/* 回答要点 */}
      <div className="copilot-fade-up copilot-stagger-2 group">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("flex items-center justify-center w-6 h-6 rounded-md", recommendedPoints.length > 0 ? "bg-primary/10 text-primary" : "bg-dim/10 text-dim/40")}>
            <Sparkles size={12} />
          </div>
          <span className={cn("text-[11px] font-bold uppercase tracking-[0.15em]", recommendedPoints.length > 0 ? "text-primary/90" : "text-dim/40")}>核心要点建议</span>
        </div>
        <div className="pl-[34px]">
          {recommendedPoints.length > 0 ? (
            <>
              <ul className="space-y-2">
                {recommendedPoints.map((point, i) => (
                  <li key={i} className="text-[13px] leading-6 flex items-start gap-2.5 text-text/90">
                    <span className="text-primary/60 mt-1 shrink-0">-</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              {prepHint?.redirect_suggestion && (
                <div className="mt-3.5 pt-3 border-t border-border/30 text-[12px] leading-5 bg-primary/5 rounded-lg p-2.5">
                  <span className="font-bold text-primary/80 mr-2 uppercase tracking-wide text-[10px]">引导方向</span>
                  <span className="text-text/80">{prepHint.redirect_suggestion}</span>
                </div>
              )}
            </>
          ) : (
            <PanelEmptyState active={false} />
          )}
        </div>
      </div>

      <div className="w-full h-px bg-border/40 ml-[34px] my-4" />

      {/* 参考答案 */}
      <div className="copilot-fade-up copilot-stagger-3 group">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("flex items-center justify-center w-6 h-6 rounded-md transition-colors",
            answerLoading || answerStreaming ? "bg-green/15 text-green" :
            streamingAnswer ? "bg-green/10 text-green" : "bg-dim/10 text-dim/40")}>
            {answerLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          </div>
          <span className={cn("text-[11px] font-bold uppercase tracking-[0.15em]", (answerLoading || streamingAnswer) ? "text-green/90" : "text-dim/40")}>流式参考打样</span>
          {(answerLoading || answerStreaming) && (
            <span className="ml-auto flex items-center gap-1.5 text-[9px] font-bold tracking-[0.2em] text-green/80 bg-green/10 border border-green/25 rounded-md px-1.5 py-0.5 uppercase">
              <span className="inline-block w-1 h-1 rounded-full bg-green animate-pulse" />
              {answerLoading ? "Waiting" : "Streaming"}
            </span>
          )}
        </div>
        <div className="pl-[34px]">
          {answerLoading && !streamingAnswer ? (
            <div className="space-y-2">
              <div className="h-2.5 w-full rounded-full bg-green/15 copilot-shimmer-bg" />
              <div className="h-2.5 w-[92%] rounded-full bg-green/12 copilot-shimmer-bg" style={{ animationDelay: '0.15s' }} />
              <div className="h-2.5 w-[88%] rounded-full bg-green/10 copilot-shimmer-bg" style={{ animationDelay: '0.3s' }} />
              <div className="h-2.5 w-[62%] rounded-full bg-green/8 copilot-shimmer-bg" style={{ animationDelay: '0.45s' }} />
              <p className="text-[11px] text-green/65 font-medium pt-1 flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin" />
                Answer Coach 首 token 生成中...
              </p>
            </div>
          ) : streamingAnswer ? (
            <p className="text-[13px] leading-7 text-text/90 whitespace-pre-wrap font-medium">
              {streamingAnswer}
              {answerStreaming && <span className="copilot-blink inline-block w-[2px] h-[1em] bg-green/80 translate-y-[2px] ml-[1px]" />}
            </p>
          ) : (
            <PanelEmptyState active={false} />
          )}
        </div>
      </div>

      <div className="w-full h-px bg-border/40 ml-[34px] my-4" />

      {/* 可能追问 */}
      <div className="copilot-fade-up copilot-stagger-4 group">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("flex items-center justify-center w-6 h-6 rounded-md", children.length > 0 ? "bg-amber-500/10 text-amber-500" : "bg-dim/10 text-dim/40")}>
            <ChevronRight size={12} />
          </div>
          <span className={cn("text-[11px] font-bold uppercase tracking-[0.15em]", children.length > 0 ? "text-amber-500/90" : "text-dim/40")}>预测追问方向</span>
        </div>
        <div className="pl-[34px]">
          {children.length > 0 ? (
            <div className="space-y-3">
              {children.map((c, i) => (
                <div key={i} className="rounded-xl border border-border/60 bg-background/40 px-3.5 py-3 shadow-sm">
                  <div className="font-bold text-[12px] text-text border-b border-border/40 pb-1.5 mb-1.5">{c.topic}</div>
                  {c.question && (
                    <div className="text-[12px] text-dim/80 leading-5 italic">"{c.question}"</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <PanelEmptyState active={false} />
          )}
        </div>
      </div>

      {/* 风险提示 */}
      {riskAlert && (
        <>
          <div className="w-full h-px bg-border/40 ml-[34px] my-4" />
          <div className="copilot-fade-up copilot-danger-glow group">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/10 text-amber-400">
                <AlertTriangle size={12} />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-400">注意</span>
            </div>
            <div className="pl-[34px]">
              <p className="text-[13px] leading-6 text-amber-500 font-medium">{riskAlert.message}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════
// Shared UI Components
// ══════════════════════════════════════════════════════════════

function HintChip({ title, description }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/72 px-3.5 py-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-[13px] leading-6 text-dim">{description}</div>
    </div>
  );
}

function StepRow({ index, title, description, done = false, active = false }) {
  return (
    <div className={cn("rounded-2xl border px-3.5 py-3", done ? "border-green/20 bg-green/8" : active ? "border-primary/25 bg-primary/6" : "border-border/75 bg-card/72")}>
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold", done ? "bg-green/15 text-green" : active ? "bg-primary/12 text-primary" : "bg-hover text-dim")}>
          {done ? <CheckCircle2 size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : index}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-[13px] leading-6 text-dim">{description}</div>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-border/75 bg-card/75 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.16em] text-dim/80">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 bg-card/72 px-3.5 py-3">
      <div className="shrink-0 text-dim">{label}</div>
      <div className="min-w-0 text-right font-medium">{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Main Export — 路由状态机
// ══════════════════════════════════════════════════════════════

export default function Copilot() {
  const navigate = useNavigate();

  // Read state from URL search params (works reliably with nested routes)
  const readParams = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    return {
      view: sp.get("view") || "list",
      prep: sp.get("prep") || null,
    };
  }, []);

  const [state, setState] = useState(readParams);

  // Sync state when URL changes (e.g. browser back/forward)
  useEffect(() => {
    const onPop = () => setState(readParams());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [readParams]);

  const go = useCallback((view, prepId) => {
    const params = new URLSearchParams();
    if (view && view !== "list") params.set("view", view);
    if (prepId) params.set("prep", prepId);
    const qs = params.toString();
    const url = `/copilot${qs ? `?${qs}` : ""}`;
    navigate(url, { replace: true });
    setState({ view: view || "list", prep: prepId || null });
  }, [navigate]);

  const goList = useCallback(() => go("list", null), [go]);
  const goNew = useCallback(() => go("new", null), [go]);
  const goDetail = useCallback((prepId) => go("detail", prepId), [go]);
  const goRealtime = useCallback((prepId) => go("realtime", prepId), [go]);

  switch (state.view) {
    case "list":
      return <ListView onNew={goNew} onSelect={goDetail} />;
    case "new":
      return <DetailView prepId={null} onBack={goList} onStartInterview={(id) => goRealtime(id)} />;
    case "detail":
      return <DetailView prepId={state.prep} onBack={goList} onStartInterview={(id) => goRealtime(id)} />;
    case "realtime":
      return <RealtimePhase prepId={state.prep} onBack={goList} />;
    default:
      return <ListView onNew={goNew} onSelect={goDetail} />;
  }
}
