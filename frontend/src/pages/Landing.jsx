import { useNavigate } from "react-router-dom";
import { Sun, Moon, ArrowRight, Brain, Target, Mic, BarChart3, Repeat, BookOpen, BriefcaseBusiness } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: <Target size={20} />,
    color: "text-primary bg-primary/12",
    title: "简历模拟面试",
    desc: "AI 读取简历，模拟真实面试官。从自我介绍到项目深挖，完整走一遍。",
  },
  {
    icon: <BookOpen size={20} />,
    color: "text-green bg-green/12",
    title: "专项强化训练",
    desc: "选一个领域集中刷题，AI 根据回答动态调整难度，精准定位薄弱点。",
  },
  {
    icon: <Mic size={20} />,
    color: "text-teal bg-teal/12",
    title: "录音复盘",
    desc: "上传面试录音或粘贴文字，AI 自动转写分析，复盘每一场真实面试。",
  },
  {
    icon: <BriefcaseBusiness size={20} />,
    color: "text-blue-400 bg-blue-500/12",
    title: "JD 定向备面",
    desc: "贴入岗位 JD，AI 拆解考察重点，结合简历生成高概率追问和岗位匹配复盘。",
  },
];

const PILLS = [
  { icon: <BarChart3 size={14} />, text: "个性化画像" },
  { icon: <Repeat size={14} />, text: "间隔重复" },
  { icon: <Brain size={14} />, text: "语义记忆" },
];

export default function Landing() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="flex items-center justify-between px-6 md:px-10 py-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="TechSpar" className="w-8 h-8 rounded-lg object-contain" />
          <span className="text-lg font-display font-bold text-text">TechSpar</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Button variant="outline" onClick={() => navigate("/login")}>
            登录
          </Button>
        </div>
      </header>

      <section className="px-6 md:px-10 pt-10 md:pt-16 pb-12 md:pb-16 relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[300px] bg-gradient-to-b from-primary/10 to-transparent rounded-full blur-[80px] pointer-events-none" />

        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-10 md:gap-14 relative z-10">
          <div className="flex-1 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-5 animate-fade-in">
              <Brain size={14} className="animate-float" />
              AI-Powered Mock Interview
            </div>

            <h1 className="text-3xl md:text-5xl font-display font-bold leading-tight mb-4 animate-fade-in-up">
              <span className="bg-gradient-to-r from-accent-light via-accent to-orange bg-clip-text text-transparent">
                越练越懂你的
              </span>
              <br />
              <span className="text-text">AI 面试教练</span>
            </h1>

            <p className="text-sm md:text-base text-dim leading-relaxed mb-7 max-w-md animate-fade-in-up [animation-delay:0.1s]">
              追踪你的成长轨迹，精准命中薄弱点。基于间隔重复与语义记忆，每一次练习都比上一次更有针对性。
            </p>

            <Button variant="gradient" size="lg" className="animate-fade-in-up [animation-delay:0.2s]" onClick={() => navigate("/login")}>
              立即开始
              <ArrowRight size={16} />
            </Button>
          </div>

          <div className="flex-1 w-full max-w-md animate-fade-in-up [animation-delay:0.3s]">
            <Card className="overflow-hidden shadow-2xl">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
                <div className="w-2.5 h-2.5 rounded-full bg-red/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-primary/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green/80" />
                <span className="text-[11px] text-dim ml-2 font-mono">interview session</span>
              </div>
              <CardContent className="px-4 py-3.5">
                <div className="font-mono text-[13px] space-y-2">
                  <div>
                    <span className="text-primary">面试官</span>
                    <span className="text-dim"> &gt; </span>
                    <span className="text-text">请介绍一下你在 RAG 项目中的架构设计</span>
                  </div>
                  <div>
                    <span className="text-teal">候选人</span>
                    <span className="text-dim"> &gt; </span>
                    <span className="text-dim">我们采用了两阶段检索架构...</span>
                  </div>
                  <div>
                    <span className="text-primary">评估</span>
                    <span className="text-dim"> &gt; </span>
                    <span className="text-green">7.5/10</span>
                    <span className="text-dim"> — 架构描述清晰，建议补充性能指标</span>
                  </div>
                  <div className="text-primary animate-pulse-dot inline-block">_</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="px-6 md:px-10 pb-12 md:pb-16">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            {PILLS.map((p) => (
              <div
                key={p.text}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-card border border-border text-[13px] text-dim"
              >
                {p.icon}
                {p.text}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 stagger-children">
            {FEATURES.map((f) => (
              <Card key={f.title} className="hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md transition-all">
                <CardContent className="p-5">
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center mb-3", f.color)}>
                    {f.icon}
                  </div>
                  <h3 className="text-[15px] font-semibold text-text mb-1.5">{f.title}</h3>
                  <p className="text-sm text-dim leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-border py-5 text-center text-xs text-dim">
        TechSpar — AI Mock Interview Coach
      </footer>
    </div>
  );
}
