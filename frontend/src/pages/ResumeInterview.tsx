import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  History,
  Loader2,
  MessageCircle,
  Play,
  Sparkles,
} from "lucide-react";
import { getHistory, startInterview, type InterviewHistoryItem } from "../api/sessions";
import { getProfile, inferTargetRole } from "../api/profile";
import { getResumeStatus } from "../api/resume";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import ScorePill from "@/components/ScorePill";
import useTaskStatus from "../hooks/useTaskStatus";

const INTERVIEW_STEPS = [
  { title: "自我介绍", desc: "建立候选人画像" },
  { title: "项目深挖", desc: "围绕真实经历动态追问" },
  { title: "能力考察", desc: "结合岗位要求探测边界" },
  { title: "总结反馈", desc: "生成评分与改进建议" },
];

interface ResumeInterviewProps {
  embedded?: boolean;
}

interface ResumeFile {
  filename: string;
  size: number;
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function ResumeInterview({ embedded = false }: ResumeInterviewProps) {
  const navigate = useNavigate();
  const [resumeFile, setResumeFile] = useState<ResumeFile | null>(null);
  const [resumeSelected, setResumeSelected] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [history, setHistory] = useState<InterviewHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [targetRole, setTargetRole] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [targetRoleInferring, setTargetRoleInferring] = useState(false);
  const { creatingSessionMode, setCreatingSessionMode } = useTaskStatus();
  const loading = creatingSessionMode === "resume";
  const ready = Boolean(resumeFile && resumeSelected && targetRole.trim() && !targetRoleInferring);

  const autoInferRole = async () => {
    setTargetRoleInferring(true);
    try {
      const { target_role } = await inferTargetRole();
      if (target_role) setTargetRole(target_role);
    } catch {
      // 用户仍可手动输入岗位，推断失败不阻断页面。
    } finally {
      setTargetRoleInferring(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getResumeStatus({ signal: controller.signal }).catch(() => ({ has_resume: false, filename: undefined, size: undefined })),
      getProfile({ signal: controller.signal }).catch(() => ({ target_role: undefined })),
    ])
      .then(([status, profile]) => {
        if (controller.signal.aborted) return;
        if (status.has_resume) {
          setResumeFile({
            filename: status.filename || "resume.pdf",
            size: status.size || 0,
          });
          setResumeSelected(true);
        }
        const existingRole = (profile.target_role || "").trim();
        if (existingRole) {
          setTargetRole(existingRole);
        } else if (status.has_resume) {
          void autoInferRole();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPageLoading(false);
      });

    getHistory(3, 0, "resume", null, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setHistory(data.items || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });

    return () => controller.abort();
  }, []);

  const handleStart = async () => {
    if (!ready) return;
    setCreatingSessionMode("resume");
    try {
      const data = await startInterview("resume", null, {
        targetRole: targetRole.trim(),
        jobDescription: jobDescription.trim() || undefined,
      });
      navigate(`/interview/${data.session_id}`, { state: data });
    } catch (error) {
      toast.error("启动失败: " + errorMessage(error));
    } finally {
      setCreatingSessionMode(null);
    }
  };

  return (
    <div className={cn(
      "w-full animate-in fade-in duration-300",
      embedded ? "pb-10 pt-4" : "mx-auto max-w-[1180px] px-4 py-8 md:px-7 xl:px-8"
    )}>
      {!embedded && (
        <header className="mb-6">
          <h1 className="text-3xl font-display font-bold tracking-tight text-text">实时模拟</h1>
          <p className="mt-2 text-sm leading-6 text-dim">补充面试资料，开始一轮会根据回答动态追问的完整模拟。</p>
        </header>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden border-border/80 bg-card/70 shadow-sm">
          <CardContent className="p-5 md:p-6 xl:p-7">
            <div className="flex flex-col gap-2 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-text">面试资料</h2>
                  <p className="mt-1 text-[13px] leading-5 text-dim">简历与目标岗位决定本轮追问的方向和深度。</p>
                </div>
              </div>
              <Badge variant={resumeFile ? "success" : "secondary"} className="self-start rounded-full">
                {resumeFile ? "已关联简历" : "缺少简历"}
              </Badge>
            </div>

            <section className="pt-5">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <label className="text-[13px] font-semibold text-text">本次面试简历</label>
                <button
                  type="button"
                  onClick={() => navigate("/resume-manager")}
                  className="flex items-center gap-1 text-[12px] font-medium text-dim transition-colors hover:text-primary"
                >
                  简历管理 <ArrowUpRight size={13} />
                </button>
              </div>

              {pageLoading ? (
                <Skeleton className="h-[104px] w-full rounded-2xl" />
              ) : resumeFile ? (
                <label className={cn(
                  "flex cursor-pointer items-center gap-3.5 rounded-2xl border p-4 transition-all",
                  resumeSelected
                    ? "border-primary/35 bg-primary/8 shadow-sm shadow-primary/5"
                    : "border-border/80 bg-background/45 hover:border-primary/25"
                )}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={resumeSelected}
                    onChange={(event) => setResumeSelected(event.target.checked)}
                  />
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-primary">
                    <FileText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">{resumeFile.filename}</div>
                    <div className="mt-1 text-[12px] text-dim">
                      {(resumeFile.size / 1024).toFixed(0)} KB · {resumeSelected ? "用于本次面试" : "未选中"}
                    </div>
                  </div>
                  <CheckCircle2 size={18} className={resumeSelected ? "text-primary" : "text-dim/40"} />
                </label>
              ) : (
                <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-border/80 bg-background/35 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-text">还没有面试简历</div>
                    <div className="mt-1 text-[12px] leading-5 text-dim">上传一份 PDF，返回后会自动选中。</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/resume-manager")}>
                    上传简历
                  </Button>
                </div>
              )}
            </section>

            <section className="mt-5 border-t border-border/60 pt-5">
              <div className="mb-2.5 flex items-center gap-2">
                <Briefcase size={14} className="text-dim" />
                <label className="text-[13px] font-semibold text-text">本次面试目标岗位</label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={targetRole}
                  onChange={(event) => setTargetRole(event.target.value)}
                  placeholder={targetRoleInferring ? "正在根据简历推断..." : "如：AI 应用开发工程师"}
                  disabled={targetRoleInferring}
                  className="h-11 flex-1 rounded-xl bg-background/55"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-xl"
                  disabled={!resumeFile || targetRoleInferring}
                  onClick={autoInferRole}
                  title="根据简历推断岗位"
                >
                  {targetRoleInferring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                </Button>
              </div>
            </section>

            <section className="mt-5 border-t border-border/60 pt-5">
              <div className="mb-2.5 flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <label className="text-[13px] font-semibold text-text">目标岗位 JD</label>
                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">选填</Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-dim">粘贴职责、要求和技术栈，追问会更贴近真实岗位。</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-dim">{jobDescription.length} 字</span>
              </div>
              <Textarea
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                maxLength={12000}
                placeholder="粘贴完整 JD，包括岗位职责、任职要求、业务背景和加分项。"
                className="min-h-[220px] resize-y rounded-2xl bg-background/55 px-4 py-3.5 leading-6"
              />
            </section>
          </CardContent>
        </Card>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.11),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,248,248,0.94))] shadow-sm dark:bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_38%),linear-gradient(180deg,rgba(24,24,27,0.98),rgba(20,20,22,0.96))]">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim/70">实时模拟</div>
                  <h2 className="mt-1 text-lg font-semibold text-text">本轮面试流程</h2>
                </div>
                <Badge variant={ready ? "success" : "secondary"} className="rounded-full">
                  {ready ? "可以开始" : "待完善"}
                </Badge>
              </div>

              <div className="mt-5 space-y-2.5">
                {INTERVIEW_STEPS.map((step, index) => (
                  <div key={step.title} className="flex items-start gap-3 rounded-xl border border-border/65 bg-card/55 px-3.5 py-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text">{step.title}</div>
                      <div className="mt-0.5 text-[12px] leading-5 text-dim">{step.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-border/65 pt-5">
                <Button
                  variant="gradient"
                  size="lg"
                  className="h-12 w-full rounded-xl font-semibold"
                  disabled={!ready || loading}
                  onClick={handleStart}
                >
                  {loading ? (
                    <><Loader2 size={17} className="animate-spin" /> 正在创建面试...</>
                  ) : (
                    <><Play size={17} className="fill-current" /> 开始实时模拟</>
                  )}
                </Button>
                <p className="mt-2.5 text-center text-[11px] leading-5 text-dim">
                  开始前请确认简历和目标岗位信息准确。
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Card className="mt-5 border-border/80 bg-card/55">
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-dim">
                <History size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text">最近面试</h2>
                <p className="mt-0.5 text-[11px] text-dim">继续未完成的面试，或查看最近复盘。</p>
              </div>
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => navigate("/history")}
                className="flex items-center gap-1 text-[12px] font-medium text-dim transition-colors hover:text-primary"
              >
                查看全部 <ChevronRight size={13} />
              </button>
            )}
          </div>

          <div className="mt-4">
            {historyLoading ? (
              <div className="grid gap-3 lg:grid-cols-3">
                {[1, 2, 3].map((item) => <Skeleton key={item} className="h-[92px] rounded-2xl" />)}
              </div>
            ) : history.length === 0 ? (
              <div className="flex min-h-[112px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/25 px-5 text-center">
                <MessageCircle size={20} className="text-dim/60" />
                <div className="mt-2 text-sm font-medium text-text">完成第一轮面试后，复盘会显示在这里</div>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-3">
                {history.map((session) => {
                  const reviewed = (session.status || "reviewed") === "reviewed";
                  const title = reviewed
                    ? "实时模拟"
                    : session.status === "review_failed"
                      ? "复盘生成失败"
                      : session.status === "reviewing"
                        ? "正在生成复盘"
                        : "面试未完成";
                  return (
                    <button
                      key={session.session_id}
                      type="button"
                      className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 p-3.5 text-left transition-all hover:border-primary/30 hover:bg-card"
                      onClick={() => navigate(reviewed ? `/review/${session.session_id}` : `/interview/${session.session_id}`)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card text-dim transition-colors group-hover:text-primary">
                        <Clock size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-text">{title}</div>
                        <div className="mt-1 text-[11px] tabular-nums text-dim">{formatDate(session.created_at)}</div>
                      </div>
                      <ScorePill score={session.avg_score} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
