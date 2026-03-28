import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ChevronRight, Sparkles, Target, BookOpen, Mic, TrendingUp, Zap, BriefcaseBusiness } from "lucide-react";
import TopicCard from "../components/TopicCard";
import { getTopics, startInterview, getResumeStatus, uploadResume, getProfile } from "../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const MODE_CARDS = [
  {
    mode: "resume",
    icon: FileText,
    gradient: "from-amber-500/20 via-orange-500/10 to-transparent",
    iconBg: "bg-amber-500/15 text-amber-400",
    borderActive: "border-amber-500/50",
    badgeVariant: "default",
    title: "简历模拟面试",
    desc: "AI 读取你的简历，模拟真实面试官。从自我介绍到项目深挖，完整走一遍面试流程。",
    tag: "全流程模拟",
  },
  {
    mode: "topic_drill",
    icon: Target,
    gradient: "from-emerald-500/20 via-green-500/10 to-transparent",
    iconBg: "bg-emerald-500/15 text-emerald-400",
    borderActive: "border-emerald-500/50",
    badgeVariant: "success",
    title: "专项强化训练",
    desc: "选一个领域集中刷题，AI 根据你的回答动态调整难度，精准定位薄弱点。",
    tag: "针对强化",
  },
  {
    mode: "job_prep",
    icon: BriefcaseBusiness,
    gradient: "from-sky-500/20 via-cyan-500/10 to-transparent",
    iconBg: "bg-sky-500/15 text-sky-400",
    borderActive: "border-sky-500/50",
    badgeVariant: "blue",
    title: "JD 定向备面",
    desc: "贴入岗位 JD，AI 拆解岗位重点，结合简历生成高概率问题和岗位匹配复盘。",
    tag: "岗位针对",
  },
  {
    mode: "recording",
    icon: Mic,
    gradient: "from-blue-500/20 via-cyan-500/10 to-transparent",
    iconBg: "bg-blue-500/15 text-blue-400",
    borderActive: "border-blue-500/50",
    badgeVariant: "blue",
    title: "录音复盘",
    desc: "上传面试录音或粘贴文字，AI 自动转写分析，帮你复盘每一场真实面试。",
    tag: "录音分析",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [topics, setTopics] = useState({});
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resumeFile, setResumeFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getTopics().catch(() => ({})),
      getResumeStatus().catch(() => ({})),
      getProfile().catch(() => null),
    ]).then(([t, s, p]) => {
      setTopics(t);
      if (s.has_resume) setResumeFile({ filename: s.filename, size: s.size });
      setProfile(p);
    }).finally(() => setPageLoading(false));
  }, []);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadResume(file);
      setResumeFile({ filename: data.filename, size: data.size });
    } catch (err) {
      alert("上传失败: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleStart = async () => {
    if (!mode) return;
    if (mode === "job_prep") { navigate("/job-prep"); return; }
    if (mode === "recording") { navigate("/recording"); return; }
    if (mode === "topic_drill" && !selectedTopic) return;
    setLoading(true);
    try {
      const data = await startInterview(mode, selectedTopic);
      navigate(`/interview/${data.session_id}`, { state: data });
    } catch (err) {
      alert("启动失败: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const canStart = (mode === "resume" && resumeFile) || (mode === "topic_drill" && selectedTopic) || mode === "recording" || mode === "job_prep";

  function renderStats() {
    if (pageLoading) {
      return (
        <div className="w-full max-w-[700px] mb-10">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-5 w-24" />
            <div className="flex gap-6">
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 flex-1" />
            </div>
          </div>
        </div>
      );
    }
    if (!profile?.stats?.total_sessions > 0 || mode) return null;
    const s = profile.stats;
    const lastEntry = (s.score_history || []).slice(-1)[0];
    const mastery = profile.topic_mastery || {};
    const topTopics = Object.entries(mastery)
      .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
      .slice(0, 3);
    return (
      <Card className="w-full max-w-[700px] mb-10 hover:shadow-md transition-shadow">
        <CardContent className="p-5 md:p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              <span className="text-[15px] font-semibold">训练概览</span>
            </div>
            <button
              className="text-[13px] text-primary flex items-center gap-1 hover:underline cursor-pointer"
              onClick={() => navigate("/profile")}
            >
              查看画像 <ChevronRight size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-4 md:gap-6">
            <StatBox value={s.total_sessions} label="总练习" color="text-primary" />
            <StatBox value={s.avg_score || "-"} label="综合平均" color="text-green" />
            {topTopics.length > 0 && (
              <div className="flex-1 min-w-[120px]">
                <div className="text-[11px] text-dim mb-2">领域掌握</div>
                {topTopics.map(([t, d]) => (
                  <div key={t} className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs w-[70px] text-text truncate">{t}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-accent-light transition-all duration-500"
                        style={{ width: `${d.score || 0}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-dim w-7 text-right">{d.score || 0}</span>
                  </div>
                ))}
              </div>
            )}
            {lastEntry && (
              <StatBox
                value={lastEntry.avg_score}
                label="上次得分"
                color={lastEntry.avg_score >= 6 ? "text-green" : "text-orange"}
              />
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center px-4 pt-8 pb-10 md:px-6 md:pt-12">
      {/* Hero */}
      <div className="text-center mb-10 md:mb-12 relative">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[500px] h-[250px] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-4">
            <Sparkles size={14} className="animate-float" />
            AI-Powered Mock Interview
          </div>
          <h1 className="text-3xl md:text-[44px] font-display font-bold mb-3 bg-gradient-to-r from-accent-light via-accent to-orange bg-clip-text text-transparent">
            TechSpar
          </h1>
          <p className="text-base text-dim max-w-[500px]">
            越练越懂你的 AI 面试教练——追踪你的成长轨迹，精准命中薄弱点
          </p>
        </div>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-10 md:mb-12 w-full max-w-[1320px] stagger-children">
        {MODE_CARDS.map((card) => {
          const Icon = card.icon;
          const isActive = mode === card.mode;
          return (
            <div
              key={card.mode}
              className={cn(
                "w-full relative overflow-hidden cursor-pointer transition-all text-left border-2 rounded-xl",
                isActive
                  ? `border-current ${card.borderActive} bg-card shadow-lg`
                  : "border-border bg-card hover:border-border hover:shadow-md hover:-translate-y-0.5"
              )}
              onClick={() => { setMode(card.mode); if (card.mode !== "topic_drill") setSelectedTopic(null); }}
            >
              {isActive && (
                <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none", card.gradient)} />
              )}
              <div className="relative px-6 py-7">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-all", card.iconBg)}>
                    <Icon size={20} />
                  </div>
                  <Badge variant={card.badgeVariant}>{card.tag}</Badge>
                </div>
                <div className="text-xl font-semibold mb-2">{card.title}</div>
                <div className="text-sm text-dim leading-relaxed">{card.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick stats */}
      {renderStats()}

      {/* Resume upload */}
      {mode === "resume" && (
        <div className="w-full max-w-[700px] mb-8 animate-fade-in">
          {resumeFile ? (
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 md:p-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-sm text-text">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText size={18} className="text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{resumeFile.filename}</div>
                    <div className="text-xs text-dim">{(resumeFile.size / 1024).toFixed(0)} KB</div>
                  </div>
                </div>
                <label className={cn("cursor-pointer", uploading && "opacity-50 pointer-events-none")}>
                  <Button variant="outline" size="sm" asChild>
                    <span>{uploading ? "上传中..." : "重新上传"}</span>
                  </Button>
                  <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
              </CardContent>
            </Card>
          ) : (
            <label className={cn(
              "flex flex-col items-center gap-3 px-5 py-8 bg-card border-2 border-dashed border-border rounded-xl cursor-pointer transition-all text-sm text-dim hover:border-primary/50 hover:bg-card/80",
              uploading && "opacity-50 pointer-events-none"
            )}>
              <div className="w-12 h-12 rounded-xl bg-hover flex items-center justify-center">
                <FileText size={24} className="text-dim" />
              </div>
              <div>
                <span className="font-medium text-text">{uploading ? "正在上传..." : "点击上传简历（PDF）"}</span>
              </div>
              <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          )}
        </div>
      )}

      {/* Topic selection */}
      {mode === "topic_drill" && (
        <div className="w-full max-w-[700px] animate-fade-in">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-green" />
            <span className="text-lg font-semibold">选择训练领域</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 mb-8 stagger-children">
            {Object.entries(topics).map(([key, info]) => (
              <TopicCard
                key={key}
                topicKey={key}
                name={info.name || key}
                icon={info.icon}
                selected={selectedTopic === key}
                onClick={() => setSelectedTopic(key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Start button */}
      {mode && (
        <div className="w-full max-w-[700px] animate-fade-in-up">
          <Button
            variant="gradient"
            size="lg"
            className="w-full"
            disabled={!canStart || loading}
            onClick={handleStart}
          >
            {loading ? "正在初始化面试..." : mode === "job_prep" ? "进入 JD 备面" : "开始面试"}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatBox({ value, label, color }) {
  return (
    <div className="text-center min-w-[60px]">
      <div className={cn("text-2xl font-bold", color)}>{value}</div>
      <div className="text-[11px] text-dim mt-0.5">{label}</div>
    </div>
  );
}
