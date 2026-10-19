import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Loader2,
  Radio,
  Sparkles,
  User,
} from "lucide-react";

import { getCopilotPrepStatus, startCopilotPrep } from "../../api/copilot";
import { getProfile, getResumeStatus } from "../../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import SessionHistory from "./SessionHistory";
import PrepResultCards from "./PrepResultCards";
import { PAGE_CLASS, formatFileSize } from "./shared";

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

export default function DetailView({ prepId: initialPrepId, onBack, onStartInterview }) {
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
      .then((data) => {
        if (data.has_resume) {
          setResumeFile({ filename: data.filename, size: data.size });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingResume(false));

    getProfile()
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, []);

  useEffect(() => {
    if (!initialPrepId) return;

    const loadStatus = async () => {
      try {
        const data = await getCopilotPrepStatus(initialPrepId);
        setStatus(data);
        if (data.company) setCompany(data.company);
        if (data.position) setPosition(data.position);
      } catch (error) {
        setError(error.message);
      }
    };

    loadStatus();
  }, [initialPrepId]);

  useEffect(() => {
    if (!prepId || !isRunning) return;

    const poll = async () => {
      try {
        const data = await getCopilotPrepStatus(prepId);
        setStatus(data);
        if (data.status !== "running") clearInterval(pollRef.current);
        if (data.status === "error") setError(data.error || "Prep failed");
      } catch (error) {
        setError(error.message);
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
    } catch (error) {
      setError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={PAGE_CLASS}>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-dim hover:text-text transition-colors mb-5"
      >
        <ChevronLeft size={16} /> 返回列表
      </button>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_380px] 2xl:grid-cols-[minmax(0,1.65fr)_400px]">
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
                      : "查看 Copilot 的分析结果，准备好后点击「开始面试辅助」进入实时模式。"}
                  </div>
                </div>

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
                        onChange={(event) => setCompany(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">目标岗位</Label>
                      <Input
                        className="h-12 rounded-2xl border-border/60 bg-background/50 hover:bg-background focus-visible:bg-background transition-colors px-4"
                        placeholder="例：AI 后台开发实习生"
                        value={position}
                        onChange={(event) => setPosition(event.target.value)}
                      />
                    </div>
                  </div>
                )}

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
                      onChange={(event) => setJdText(event.target.value)}
                      disabled={!!prepId}
                    />
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <HintChip title="至少 50 字" description="低于这个长度分析价值有限。" />
                      <HintChip title="保留原始措辞" description="岗位关键词会影响策略树生成。" />
                      <HintChip title="加分项很重要" description="追问方向往往从加分项展开。" />
                    </div>
                  </div>
                )}

                <div className="mt-1 flex flex-col gap-1 rounded-2xl border border-border/40 bg-card/20 p-1.5">
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

                  <div className="mx-4 h-px bg-border/40" />

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

          {prepId && <SessionHistory prepId={prepId} />}

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
                  isDone ? "border-green/20 bg-green/8 text-green" : isRunning ? "border-blue-500/20 bg-blue-500/8 text-blue-300" : "border-border/80 bg-card/82 text-text"
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
                    isDone ? "公司搜索、JD 分析、匹配度评估均已完成。" : isRunning ? status.progress : "并行分析公司信息、JD 要求和简历匹配度。"
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
                    {submitting ? (
                      <><Loader2 size={18} className="animate-spin" /> 初始化中...</>
                    ) : (
                      <><Sparkles size={18} /> 开始准备</>
                    )}
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
