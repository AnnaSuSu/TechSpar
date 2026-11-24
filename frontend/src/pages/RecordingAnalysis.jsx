import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2, Mic, Upload, User, Users } from "lucide-react";
import { transcribeRecording, analyzeRecording } from "../api/interview";
import useTaskStatus from "../hooks/useTaskStatus";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import { HintChip, StepRow } from "@/components/WorkflowPrimitives";
import { statusToneClasses } from "@/lib/statusTone";

const RECORDING_MODES = [
  {
    key: "dual",
    label: "双人对话",
    sub: "面试官 + 你",
    Icon: Users,
    tone: "blue",
    note: "适合完整面试录音，系统会按对话结构识别追问和回答。",
  },
  {
    key: "solo",
    label: "单人录音",
    sub: "只有你",
    Icon: User,
    tone: "green",
    note: "适合技术表达、自我介绍或复盘独白，重点看表达质量和内容完整度。",
  },
];

function modeClasses(selected, tone) {
  if (!selected) return "border-border/75 bg-card/72 hover:border-border";
  if (tone === "green") return "border-green/30 bg-green/8";
  return "border-blue-500/30 bg-blue-500/8";
}

function formatFileSize(size) {
  if (!size) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildStatus({ inputTab, audioFile, transcriptCount, transcribing, analyzing }) {
  if (analyzing) return { label: "分析中", tone: "blue", hint: "正在生成复盘结果" };
  if (transcribing) return { label: "转写中", tone: "blue", hint: "正在把录音转成文本" };
  if (transcriptCount > 0) return { label: "可分析", tone: "green", hint: "文本已准备好" };
  if (inputTab === "upload" && audioFile) return { label: "待转写", tone: "amber", hint: "先把录音转成文本" };
  if (inputTab === "paste") return { label: "待粘贴", tone: "neutral", hint: "先输入可分析文本" };
  return { label: "待上传", tone: "neutral", hint: "先选择录音文件" };
}

function buildSourceLabel({ inputTab, audioFile, transcriptCount }) {
  if (audioFile && transcriptCount > 0) return "录音转写";
  if (audioFile) return "上传录音";
  if (inputTab === "paste" || transcriptCount > 0) return "文本输入";
  return "待选择";
}

export default function RecordingAnalysis() {
  const navigate = useNavigate();
  const { startTask } = useTaskStatus();
  const fileRef = useRef(null);

  const [recordingMode, setRecordingMode] = useState("dual");
  const [inputTab, setInputTab] = useState("upload");
  const [transcript, setTranscript] = useState("");
  const [audioFile, setAudioFile] = useState(null);
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const currentMode = RECORDING_MODES.find((item) => item.key === recordingMode) || RECORDING_MODES[0];
  const transcriptCount = transcript.trim().length;
  const canTranscribe = inputTab === "upload" && !!audioFile && transcriptCount === 0 && !transcribing && !analyzing;
  const canAnalyze = transcriptCount > 0 && !transcribing && !analyzing && !submitted;
  const status = buildStatus({ inputTab, audioFile, transcriptCount, transcribing, analyzing });
  const sourceLabel = buildSourceLabel({ inputTab, audioFile, transcriptCount });

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setTranscript("");
    setInputTab("upload");
    setError(null);
  };

  const handleTranscribe = async () => {
    if (!audioFile) return;
    setTranscribing(true);
    setError(null);
    try {
      const data = await transcribeRecording(audioFile, recordingMode);
      setTranscript(data.transcript || "");
    } catch (err) {
      setError("转写失败: " + err.message);
    } finally {
      setTranscribing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!transcript.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeRecording(transcript, recordingMode, company || null, position || null);
      setSubmitted(true);
      startTask(data.session_id, "recording", "录音复盘生成中");
    } catch (err) {
      setError("分析失败: " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <PageContainer size="wide">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_380px] 2xl:grid-cols-[minmax(0,1.65fr)_400px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden border-border/80 bg-card/76">
            <CardContent className="p-5 md:p-6 xl:p-7">
              <div className="flex flex-col gap-6">
                <PageHeader
                  icon={<Mic size={21} />}
                  eyebrow="录音复盘工作区"
                  title="录音复盘"
                  description="上传面试录音或直接粘贴文本，先拿到可分析文本，再进入 AI 复盘。"
                  bordered
                />

                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">录音模式</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {RECORDING_MODES.map((item) => {
                      const selected = recordingMode === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={cn(
                            "rounded-[24px] border p-4 text-left transition-colors",
                            modeClasses(selected, item.tone)
                          )}
                          onClick={() => setRecordingMode(item.key)}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                "flex h-11 w-11 items-center justify-center rounded-2xl",
                                selected
                                  ? item.tone === "green"
                                    ? "bg-green/15 text-green"
                                    : "bg-blue-500/15 text-blue-400"
                                  : "bg-hover text-dim"
                              )}
                            >
                              <item.Icon size={20} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold">{item.label}</div>
                                {selected && <Badge variant={item.tone === "green" ? "success" : "blue"}>当前模式</Badge>}
                              </div>
                              <div className="mt-0.5 text-xs text-dim">{item.sub}</div>
                              <div className="mt-2 text-[13px] leading-6 text-dim">{item.note}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">公司</Label>
                    <Input
                      className="h-12 rounded-2xl bg-card/90"
                      placeholder="例：字节跳动"
                      value={company}
                      onChange={(event) => setCompany(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">岗位</Label>
                    <Input
                      className="h-12 rounded-2xl bg-card/90"
                      placeholder="例：后端开发实习"
                      value={position}
                      onChange={(event) => setPosition(event.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/80 bg-background/65 p-4 md:p-5">
                  <div className="flex flex-col gap-3 border-b border-border/70 pb-4 md:flex-row md:items-end md:justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">输入方式</div>
                      <div className="mt-1 text-sm text-dim">
                        上传录音适合完整面试复盘，粘贴文字适合已有转写稿或手动整理后的内容。
                      </div>
                    </div>
                    <div className="inline-flex shrink-0 self-start gap-1 rounded-xl bg-card/92 p-1 md:self-auto">
                      {["upload", "paste"].map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={cn(
                            "shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors",
                            inputTab === tab ? "bg-background text-text shadow-sm font-medium" : "text-dim hover:text-text"
                          )}
                          onClick={() => {
                            setInputTab(tab);
                            setError(null);
                          }}
                        >
                          {tab === "upload" ? "上传录音" : "粘贴文字"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {inputTab === "upload" ? (
                    <div className="mt-4 space-y-3">
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-[24px] border p-6 text-left transition-colors",
                          audioFile ? "border-primary/30 bg-primary/5" : "border-dashed border-border/80 bg-card/55 hover:bg-card/72"
                        )}
                        onClick={() => fileRef.current?.click()}
                      >
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl", audioFile ? "bg-primary/12 text-primary" : "bg-hover text-dim")}>
                            {audioFile ? <FileText size={24} /> : <Upload size={24} />}
                          </div>
                          {audioFile ? (
                            <div>
                              <div className="text-base font-semibold">{audioFile.name}</div>
                              <div className="mt-1 text-sm text-dim">
                                {formatFileSize(audioFile.size)} · 点击可重新选择文件
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="text-base font-semibold">点击上传音频文件</div>
                              <div className="mt-1 text-sm text-dim">支持 mp3、wav、m4a、webm 等常见格式</div>
                            </div>
                          )}
                        </div>
                        <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
                      </button>

                      <div className="grid gap-3 md:grid-cols-3">
                        <HintChip title="完整录音优先" description="不要只截最后几分钟，否则上下文会断掉。" />
                        <HintChip title="先转写再分析" description="分析基于文本，不是直接读音频内容。" />
                        <HintChip title="音质越稳越好" description="背景噪音越少，转写误差越小。" />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">待分析文本</div>
                        <div className="text-xs text-dim tabular-nums">{transcriptCount} 字</div>
                      </div>
                      <Textarea
                        className="min-h-[340px] rounded-[24px] border-border/70 bg-background/80 px-4 py-4 text-[15px] leading-7 resize-y"
                        placeholder={
                          recordingMode === "dual"
                            ? "粘贴面试对话记录。\n\n示例：\n面试官：请介绍一下你自己\n我：我是..."
                            : "粘贴你的技术表达、项目复盘或自我介绍内容。"
                        }
                        value={transcript}
                        onChange={(event) => setTranscript(event.target.value)}
                      />
                    </div>
                  )}
                </div>

                {inputTab === "upload" && transcriptCount > 0 && (
                  <Card className="border-border/80 bg-card/72">
                    <CardContent className="p-4 md:p-5">
                      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
                        <div>
                          <div className="text-sm font-semibold">转写结果</div>
                          <div className="mt-1 text-[13px] leading-6 text-dim">可直接编辑修正后再开始分析。</div>
                        </div>
                        <div className="text-xs text-dim tabular-nums">{transcriptCount} 字</div>
                      </div>
                      <Textarea
                        className="mt-4 min-h-[340px] rounded-[24px] border-border/70 bg-background/80 px-4 py-4 text-[15px] leading-7 resize-y"
                        value={transcript}
                        onChange={(event) => setTranscript(event.target.value)}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-2xl border border-red/20 bg-red/10 px-4 py-3 text-sm text-red">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden border-primary/15 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.1),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,255,0.92))] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_34%),linear-gradient(180deg,rgba(24,24,27,0.98),rgba(30,41,59,0.84))]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">决策面板</div>
                  <div className="mt-1 text-lg font-semibold">先拿到可分析文本</div>
                </div>
                <div className={cn("shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm", statusToneClasses(status.tone))}>
                  {status.label}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <StepRow
                  index="01"
                  title="选择录音模式"
                  description={currentMode.label}
                  done={!!recordingMode}
                />
                <StepRow
                  index="02"
                  title="准备输入内容"
                  description={
                    inputTab === "upload"
                      ? audioFile
                        ? "录音文件已选择。"
                        : "先选择一段可复盘的录音。"
                      : transcriptCount > 0
                        ? "文本内容已填写。"
                        : "先粘贴可分析文本。"
                  }
                  done={inputTab === "upload" ? !!audioFile : transcriptCount > 0}
                  active={inputTab === "upload" ? !audioFile : transcriptCount === 0}
                />
                <StepRow
                  index="03"
                  title="获取可分析文本"
                  description={
                    transcriptCount > 0
                      ? "文本已就绪，可以直接进入 AI 复盘。"
                      : inputTab === "upload"
                        ? "上传录音后需要先做转写。"
                        : "粘贴文字本身就是可分析文本。"
                  }
                  done={transcriptCount > 0}
                  active={inputTab === "upload" && !!audioFile && transcriptCount === 0}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <MiniMetric label="输入来源" value={sourceLabel} />
                <MiniMetric label="文本长度" value={transcriptCount} />
                <MiniMetric label="音频文件" value={audioFile ? "已选" : "未选"} />
                <MiniMetric label="当前模式" value={currentMode.label} />
              </div>

              <div className="mt-5 space-y-3">
                <Button
                  variant={canAnalyze ? "gradient" : "outline"}
                  size="lg"
                  className="w-full"
                  disabled={!canTranscribe && !canAnalyze}
                  onClick={canTranscribe ? handleTranscribe : handleAnalyze}
                >
                  {transcribing ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      转写中...
                    </>
                  ) : analyzing ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      AI 分析中...
                    </>
                  ) : canTranscribe ? (
                    "先转写这段录音"
                  ) : (
                    "开始分析"
                  )}
                </Button>

                <div className="rounded-2xl border border-border/75 bg-card/72 px-3.5 py-3 text-[13px] leading-6 text-dim">
                  {status.hint}
                </div>

                <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
                  返回首页
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80">
            <CardContent className="p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80">当前设置</div>
              <div className="mt-3 space-y-3 text-sm">
                <InfoRow label="录音模式" value={currentMode.label} />
                <InfoRow label="输入来源" value={sourceLabel} />
                <InfoRow label="公司" value={company.trim() || "未填写"} />
                <InfoRow label="岗位" value={position.trim() || "未填写"} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-border/75 bg-card/75 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.16em] text-dim/80">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
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
