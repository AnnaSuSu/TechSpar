import { useNavigate } from "react-router-dom";
import {
  Sun,
  Moon,
  ArrowRight,
  Brain,
  Target,
  Mic,
  BarChart3,
  Repeat,
  BookOpen,
  BriefcaseBusiness,
  Sparkles,
  FileText,
} from "lucide-react";
import { useState, useEffect } from "react";
import useScrollReveal from "@/hooks/useScrollReveal";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Logo from "../components/Logo";

const LOOP_MODULES = [
  {
    key: "drill",
    step: "01",
    icon: BookOpen,
    title: "专项训练",
    headline: "集中补薄弱点",
    desc: "围绕单一主题持续训练，系统会根据历史表现动态调题，而不是重新随机出题。",
    reads: ["主题掌握度", "历史错因", "最近训练"],
    preview: [
      { label: "系统", tone: "text-primary", text: "发现你在 RAG 评估链路上连续失分。" },
      { label: "下一轮", tone: "text-green", text: "追问 recall、precision 和离线评估设计。" },
      { label: "结果", tone: "text-orange", text: "把新弱点和掌握度变化写回画像。" },
    ],
    writeback: ["掌握度", "错因", "薄弱点"],
    chipClass: "bg-primary/10 text-primary",
    iconClass: "bg-primary/12 text-primary",
    borderClass: "border-primary/20",
    accentBorder: "border-primary/20",
    accentBg: "bg-primary/10",
    accentText: "text-primary",
    previewClass: "border-primary/15 bg-primary/[0.05]",
    nodeClass: "absolute z-20 left-[3%] top-[14%] w-[164px]",
  },
  {
    key: "resume",
    step: "02",
    icon: FileText,
    title: "简历面试",
    headline: "围绕真实经历深挖",
    desc: "从自我介绍到项目深挖，系统会记录你的表达短板、技术深度缺口和叙事方式。",
    reads: ["简历内容", "历史表达问题", "项目上下文"],
    preview: [
      { label: "面试官", tone: "text-green", text: "你在项目里具体负责了哪一段？" },
      { label: "风险", tone: "text-primary", text: "如果回答失焦，系统会标记项目表达不清。" },
      { label: "写回", tone: "text-orange", text: "沉淀技术深度缺口和沟通观察。" },
    ],
    writeback: ["项目表达", "技术深度", "沟通观察"],
    chipClass: "bg-green/10 text-green",
    iconClass: "bg-green/12 text-green",
    borderClass: "border-green/20",
    accentBorder: "border-green/20",
    accentBg: "bg-green/10",
    accentText: "text-green",
    previewClass: "border-green/15 bg-green/[0.05]",
    nodeClass: "absolute z-20 left-1/2 top-[2%] w-[164px] -translate-x-1/2",
  },
  {
    key: "job-prep",
    step: "03",
    icon: BriefcaseBusiness,
    title: "JD 备面",
    headline: "按岗位重新聚焦",
    desc: "输入 JD 后，系统会重新拆解岗位要求，结合简历与画像生成高概率追问和风险点。",
    reads: ["岗位 JD", "简历经历", "长期画像"],
    preview: [
      { label: "JD", tone: "text-blue-400", text: "重点在系统设计、性能优化和跨团队协作。" },
      { label: "系统", tone: "text-primary", text: "生成 HR 提问策略树和岗位高危路径。" },
      { label: "写回", tone: "text-orange", text: "记录优先补强项与岗位匹配风险。" },
    ],
    writeback: ["岗位风险", "优先补强项", "HR 策略树"],
    chipClass: "bg-blue-500/10 text-blue-400",
    iconClass: "bg-blue-500/12 text-blue-400",
    borderClass: "border-blue-500/20",
    accentBorder: "border-blue-500/20",
    accentBg: "bg-blue-500/10",
    accentText: "text-blue-400",
    previewClass: "border-blue-500/15 bg-blue-500/[0.05]",
    nodeClass: "absolute z-20 right-[3%] top-[14%] w-[164px]",
  },
  {
    key: "copilot",
    step: "04",
    icon: Brain,
    title: "实时 Copilot",
    headline: "预测下一步追问",
    desc: "进入真实面试后，系统持续转写 HR 发言，预测追问方向，并给出回答建议与高危路径提醒。",
    reads: ["HR 发言", "JD 风险路径", "历史画像"],
    preview: [
      { label: "HR", tone: "text-teal", text: "如果线上流量翻倍，你会先动哪一层？" },
      { label: "预测", tone: "text-primary", text: "大概率追问容量、缓存和降级策略。" },
      { label: "建议", tone: "text-green", text: "先给容量判断，再补监控指标和回滚方案。" },
    ],
    writeback: ["追问路径", "风险模式", "回答偏差"],
    chipClass: "bg-teal/10 text-teal",
    iconClass: "bg-teal/12 text-teal",
    borderClass: "border-teal/25",
    accentBorder: "border-teal/20",
    accentBg: "bg-teal/10",
    accentText: "text-teal",
    previewClass: "border-teal/15 bg-teal/[0.06]",
    nodeClass: "absolute z-20 right-[4%] bottom-[16%] w-[176px]",
    highlight: true,
  },
  {
    key: "recording",
    step: "05",
    icon: Mic,
    title: "录音复盘",
    headline: "把实战失误写回系统",
    desc: "真实面试后的录音、转写和逐题复盘会反哺画像，让下一轮训练更贴近真实失分点。",
    reads: ["真实录音", "转写文本", "历史表现"],
    preview: [
      { label: "录音", tone: "text-orange", text: "自动转写并拆成结构化 Q&A。" },
      { label: "系统", tone: "text-primary", text: "定位表达问题、内容缺口和失误模式。" },
      { label: "写回", tone: "text-green", text: "把复盘结果反哺到下一轮训练和 Copilot。" },
    ],
    writeback: ["失误模式", "表达问题", "改进建议"],
    chipClass: "bg-orange/10 text-orange",
    iconClass: "bg-orange/12 text-orange",
    borderClass: "border-orange/20",
    accentBorder: "border-orange/20",
    accentBg: "bg-orange/10",
    accentText: "text-orange",
    previewClass: "border-orange/15 bg-orange/[0.05]",
    nodeClass: "absolute z-20 left-[6%] bottom-[8%] w-[168px]",
  },
];

const HERO_STATS = [
  {
    icon: Target,
    stat: "95%",
    title: "薄弱点精准定位",
    desc: "长期记忆引擎追踪每次失误，精准锁定需要强化的环节。",
    iconClass: "bg-primary/10 text-primary",
    statClass: "text-primary",
  },
  {
    icon: BarChart3,
    stat: "3x",
    title: "训练效率提升",
    desc: "AI 动态调题取代随机出题，每一轮都比上一轮更有针对性。",
    iconClass: "bg-teal/10 text-teal",
    statClass: "text-teal",
  },
  {
    icon: Sparkles,
    stat: "40%",
    title: "面试通过率提升",
    desc: "闭环训练覆盖从刷题到实战全链路，不止练题更练实战。",
    iconClass: "bg-green/10 text-green",
    statClass: "text-green",
  },
];

const HERO_SIGNALS = [
  {
    icon: Repeat,
    title: "不是一次性模拟",
    desc: "训练、辅助、复盘接成一条循环，而不是练完就结束。",
  },
  {
    icon: BarChart3,
    title: "长期记忆持续累积",
    desc: "每一轮得分、弱点和表达习惯都会回写到画像里。",
  },
  {
    icon: Target,
    title: "下一轮会更有针对性",
    desc: "系统会基于已有画像重新决定该问什么、该提醒什么。",
  },
];

const MEMORY_LAYERS = [
  {
    icon: FileText,
    title: "Session Context",
    subtitle: "当前场景",
    desc: "简历、JD、最近训练记录和本轮对话上下文，决定系统这次如何理解你的面试场景。",
  },
  {
    icon: BarChart3,
    title: "Topic Mastery",
    subtitle: "主题掌握度",
    desc: "每个领域都持续记录掌握度、遗漏点、练习轨迹和复习优先级，避免下一轮又从零开始。",
  },
  {
    icon: Brain,
    title: "Global Profile",
    subtitle: "长期画像",
    desc: "跨场景沉淀你的强项、弱项、项目表达习惯、思维模式和常见高危路径。",
  },
];

const MEMORY_SIGNALS = [
  "简历 / JD / 最近训练",
  "掌握度 / 弱点 / 趋势",
  "表达习惯 / 高危路径 / 实战失误",
];

export default function Landing() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const loopRef = useScrollReveal();
  const memoryRef = useScrollReveal();
  const ctaRef = useScrollReveal();

  const scrollToLoop = () => {
    document.getElementById("loop")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(245,158,11,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(245,158,11,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-60 pointer-events-none" />

      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8 w-8 rounded-lg drop-shadow-sm" />
            <div>
              <div className="text-lg font-display font-bold leading-none">TechSpar</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.24em] text-dim">From Practice To Real Interview</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button variant="outline" onClick={() => navigate("/login")}>
              登录
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="overflow-hidden px-6 pb-16 pt-12 md:px-10 md:pb-24 md:pt-16">
          <div className="absolute left-[8%] top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
          <div className="absolute right-[10%] top-36 h-64 w-64 rounded-full bg-teal/10 blur-3xl pointer-events-none" />

          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(350px,430px)] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1.02fr)_minmax(380px,450px)] xl:gap-10">
              <div className="max-w-2xl lg:max-w-[760px] xl:max-w-[820px]">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary animate-fade-in">
                  <Sparkles size={14} className="animate-float" />
                  从刷题到实战的 AI 技术面试系统
                </div>

                <h1 className="mt-6 text-4xl font-display font-bold leading-tight tracking-tight md:text-6xl md:leading-[1.04] animate-fade-in-up">
                  把技术面试做成
                  <span className="mt-2 block bg-gradient-to-r from-accent-light via-accent to-orange bg-clip-text text-transparent">
                    一条持续进化的闭环
                  </span>
                </h1>

                <p className="mt-6 max-w-2xl text-base leading-8 text-dim md:text-lg animate-fade-in-up [animation-delay:0.08s]">
                  TechSpar 不只是生成一轮题，也不只是做一次模拟面试。它把专项训练、简历面试、JD 备面、实时
                  Copilot 和录音复盘接进同一套长期记忆里，让每一轮训练、实战辅助和复盘结果都会反哺下一轮。
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row animate-fade-in-up [animation-delay:0.16s]">
                  <Button variant="gradient" size="lg" onClick={() => navigate("/login")}>
                    在线体验
                    <ArrowRight size={16} />
                  </Button>
                  <Button variant="outline" size="lg" onClick={scrollToLoop}>
                    看闭环怎么运转
                  </Button>
                </div>

                <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:max-w-[820px] lg:grid-cols-3 xl:max-w-[880px] animate-fade-in-up [animation-delay:0.18s]">
                  {HERO_SIGNALS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Card
                        key={item.title}
                        className="border-border/80 bg-card/85 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur-sm"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Icon size={17} />
                            </div>
                            <div className="text-[15px] font-semibold leading-6">{item.title}</div>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-dim">{item.desc}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              <div className="relative animate-fade-in-up [animation-delay:0.2s] lg:-mt-1 lg:self-start lg:pt-0 xl:mt-0 xl:pt-2">
                <div className="pointer-events-none absolute inset-x-10 top-0 hidden h-32 rounded-full bg-primary/10 blur-3xl lg:block" />
                <div className="grid gap-4 lg:ml-auto lg:max-w-[440px] xl:max-w-[450px]">
                  {HERO_STATS.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <Card
                        key={item.title}
                        className={cn(
                          "rounded-[26px] border-border/80 bg-card/92 shadow-[0_24px_70px_rgba(15,23,42,0.07)] backdrop-blur-sm transition-transform duration-300 hover:-translate-y-0.5",
                          index === 1 && "lg:translate-x-2 xl:translate-x-4",
                          index === 2 && "lg:translate-x-4 xl:translate-x-8"
                        )}
                      >
                        <CardContent className="p-5 md:p-6">
                          <div className="flex items-start gap-4">
                            <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", item.iconClass)}>
                              <Icon size={20} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                <span className={cn("text-4xl font-display font-bold tracking-tight leading-none", item.statClass)}>
                                  {item.stat}
                                </span>
                                <span className="text-lg font-semibold leading-tight">{item.title}</span>
                              </div>
                              <p className="mt-2 text-sm leading-7 text-dim">{item.desc}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-12 animate-fade-in-up [animation-delay:0.24s] lg:mt-14">
              <LoopVisual />
            </div>
          </div>
        </section>

        <section id="loop" ref={loopRef} className="scroll-reveal px-6 pb-16 md:px-10 md:pb-24">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              label="面试闭环"
              title="五个模块不是五个孤岛，而是一套共享画像的系统"
              desc="每个模块都有自己的输入与输出，但所有结果最终都会回写到同一套长期记忆里，影响下一轮训练、辅助和复盘。"
            />

            <div className="relative mt-10 grid gap-4 xl:grid-cols-5">
              <div className="pointer-events-none absolute left-[8%] right-[8%] top-10 hidden h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent xl:block" />
              {LOOP_MODULES.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Card
                    key={item.key}
                    className={cn(
                      "relative overflow-hidden rounded-[24px] border-border/80 bg-card/92 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-transform duration-300 hover:-translate-y-1",
                      item.highlight && "border-teal/20 shadow-[0_24px_80px_rgba(20,184,166,0.12)]"
                    )}
                  >
                    {index < LOOP_MODULES.length - 1 && (
                      <div className="absolute -right-3 top-10 hidden h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-bg text-primary xl:flex">
                        <ArrowRight size={14} />
                      </div>
                    )}
                    <div className={cn("absolute inset-x-0 top-0 h-1", item.chipClass)} />
                    <CardContent className="p-5">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-dim">{item.step}</div>
                      <div className="mt-4 flex items-center gap-3">
                        <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", item.iconClass)}>
                          <Icon size={20} />
                        </div>
                        <div>
                          <div className="text-base font-semibold">{item.title}</div>
                          <div className="text-sm text-dim">{item.headline}</div>
                        </div>
                      </div>
                      <p className="mt-4 text-sm leading-7 text-dim">{item.desc}</p>

                      <div className="mt-5">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-dim">写回画像</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.writeback.map((tag) => (
                            <span key={tag} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", item.chipClass)}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section ref={memoryRef} className="scroll-reveal px-6 pb-16 md:px-10 md:pb-24">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              label="长期记忆"
              title="系统为什么会越练越懂你"
              desc="TechSpar 的关键不在于再生成一组题，而在于把不同场景里的信号整合成同一套长期画像，并持续拿它驱动下一轮。"
            />

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {MEMORY_LAYERS.map((item) => {
                const Icon = item.icon;
                return (
                  <Card
                    key={item.title}
                    className="rounded-[24px] border-border/80 bg-card/92 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur-sm"
                  >
                    <CardContent className="p-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Icon size={19} />
                        </div>
                        <div>
                          <div className="text-base font-semibold">{item.title}</div>
                          <div className="text-sm text-dim">{item.subtitle}</div>
                        </div>
                      </div>
                      <p className="mt-4 text-sm leading-7 text-dim">{item.desc}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="mt-6 rounded-[28px] border-primary/15 bg-gradient-to-br from-primary/10 via-card to-teal/8 shadow-[0_24px_80px_rgba(245,158,11,0.12)]">
              <CardContent className="p-6 md:p-8">
                <div className="grid gap-8 lg:grid-cols-[0.95fr,1.05fr] lg:items-center">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      <Repeat size={13} />
                      画像回写驱动下一轮
                    </div>
                    <h3 className="mt-4 text-2xl font-display font-bold tracking-tight md:text-3xl">
                      你不是在开启一场练习，而是在持续更新一套面试系统
                    </h3>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-dim md:text-base">
                      一次专项训练会暴露薄弱点，一次 JD 备面会改变你的风险优先级，一次真实面试的录音复盘会修正你的表达问题。
                      这些数据不会散落在不同页面里，而是一起回写到下一轮。
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {MEMORY_SIGNALS.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-border/80 bg-bg/85 px-4 py-4 text-sm text-dim shadow-sm"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section ref={ctaRef} className="scroll-reveal px-6 pb-20 md:px-10 md:pb-24">
          <div className="mx-auto max-w-7xl">
            <Card className="overflow-hidden rounded-[30px] border-border/80 bg-card/95 shadow-[0_30px_100px_rgba(15,23,42,0.08)]">
              <CardContent className="p-6 md:p-8">
                <div className="grid gap-8 lg:grid-cols-[1fr,0.85fr] lg:items-center">
                  <div>
                    <div className="text-sm font-medium text-primary">准备、模拟、实战、复盘，全部接进同一条闭环</div>
                    <h2 className="mt-3 text-2xl font-display font-bold tracking-tight md:text-4xl">
                      从第一轮刷题开始，到真实面试结束后复盘，系统都不会忘记你
                    </h2>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-dim md:text-base">
                      这不是另一个只会生成题目的 AI 工具，而是一套从刷题到实战的技术面试陪练系统。
                    </p>

                    <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                      <Button variant="gradient" size="lg" onClick={() => navigate("/login")}>
                        进入 Demo
                        <ArrowRight size={16} />
                      </Button>
                      <Button variant="outline" size="lg" onClick={scrollToLoop}>
                        继续看闭环
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      "专项训练先补短板",
                      "简历面试校正项目表达",
                      "JD 备面重排岗位优先级",
                      "实时 Copilot 辅助真实面试",
                      "录音复盘把失误写回系统",
                      "下一轮训练自动更有针对性",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-border/80 bg-bg/85 px-4 py-4 text-sm text-dim shadow-sm"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 px-6 py-6 text-center text-xs text-dim md:px-10">
        TechSpar · 从刷题到实战的 AI 技术面试陪练系统
      </footer>
    </div>
  );
}

function LoopVisual() {
  const [activeKey, setActiveKey] = useState("copilot");
  const activeModule = LOOP_MODULES.find((item) => item.key === activeKey) || LOOP_MODULES[3];

  return (
    <div className="relative">
      <div className="grid gap-4 md:hidden">
        <DetailPanel module={activeModule} compact />

        <div className="grid grid-cols-2 gap-2">
          {LOOP_MODULES.map((item) => (
            <LoopNode
              key={item.key}
              item={item}
              active={item.key === activeKey}
              onSelect={setActiveKey}
              mobile
            />
          ))}
        </div>

        <CenterMemoryCard activeModule={activeModule} mobile />

        <div className="rounded-2xl border border-primary/15 bg-primary/8 px-4 py-3 text-sm text-dim">
          训练 → 评估 → 画像更新 → 下一轮更精准
        </div>
      </div>

      <div className="relative hidden h-[700px] md:block">
        <div className="absolute inset-0 rounded-[36px] border border-border/80 bg-card/82 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur-sm" />
        <div className="absolute inset-y-8 left-8 right-[36%] rounded-[32px] border border-primary/10 bg-gradient-to-br from-primary/[0.035] via-transparent to-teal/[0.045]" />

        <div className="absolute inset-y-8 left-8 right-[36%]">
          <svg
            viewBox="0 0 440 620"
            className="absolute inset-0 h-full w-full"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="loop-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="rgba(245,158,11,0.42)" />
              </marker>
            </defs>
            <circle cx="220" cy="310" r="176" stroke="rgba(245,158,11,0.14)" strokeWidth="1.5" strokeDasharray="10 16" />
            <circle cx="220" cy="310" r="138" stroke="rgba(20,184,166,0.08)" strokeWidth="1.2" />
            <path
              d="M78 168 A176 176 0 0 1 220 134"
              stroke="rgba(245,158,11,0.32)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
            />
            <path
              d="M224 134 A176 176 0 0 1 362 172"
              stroke="rgba(34,197,94,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
            />
            <path
              d="M362 176 A176 176 0 0 1 340 432"
              stroke="rgba(59,130,246,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
            />
            <path
              d="M336 436 A176 176 0 0 1 116 500"
              stroke="rgba(20,184,166,0.32)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
            />
            <path
              d="M112 494 A176 176 0 0 1 78 168"
              stroke="rgba(251,146,60,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
            />
            <path d="M220 310 L78 168" stroke="rgba(245,158,11,0.08)" strokeWidth="1.5" />
            <path d="M220 310 L220 134" stroke="rgba(34,197,94,0.08)" strokeWidth="1.5" />
            <path d="M220 310 L362 172" stroke="rgba(59,130,246,0.08)" strokeWidth="1.5" />
            <path d="M220 310 L340 432" stroke="rgba(20,184,166,0.08)" strokeWidth="1.5" />
            <path d="M220 310 L116 500" stroke="rgba(251,146,60,0.08)" strokeWidth="1.5" />
          </svg>

          {LOOP_MODULES.map((item) => (
            <LoopNode
              key={item.key}
              item={item}
              active={item.key === activeKey}
              onSelect={setActiveKey}
              className={item.nodeClass}
            />
          ))}

          <div className="absolute z-10 left-1/2 top-1/2 w-[220px] -translate-x-1/2 -translate-y-1/2">
            <CenterMemoryCard activeModule={activeModule} />
          </div>
        </div>

        <div className="absolute bottom-8 left-8 right-[36%] flex justify-center">
          <div className="rounded-full border border-primary/15 bg-bg/88 px-4 py-3 text-center text-sm text-dim shadow-sm backdrop-blur-sm">
            训练 → 评估 → 画像更新 → 下一轮更精准
          </div>
        </div>

        <div className="absolute right-8 top-8 bottom-8 w-[32%]">
          <DetailPanel module={activeModule} />
        </div>
      </div>
    </div>
  );
}

function LoopNode({ item, active, onSelect, className, mobile = false }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      onFocus={() => onSelect(item.key)}
      onMouseEnter={mobile ? undefined : () => onSelect(item.key)}
      className={cn(
        mobile
          ? "rounded-[20px] border bg-card/96 p-3 text-left shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-sm"
          : "absolute rounded-[22px] border bg-card/96 p-4 text-left shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1",
        item.borderClass,
        active
          ? cn("scale-[1.02] opacity-100 shadow-[0_28px_90px_rgba(15,23,42,0.12)]", item.accentBorder)
          : "opacity-88 hover:opacity-100",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", item.iconClass)}>
          <Icon size={18} />
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", item.accentBg, item.accentText)}>
              当前
            </span>
          )}
          <div className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-dim">
            {item.step}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className={cn("text-base font-semibold", active && item.accentText)}>{item.title}</div>
        <div className="mt-1 text-sm text-dim">{item.headline}</div>
      </div>
    </button>
  );
}

function DetailPanel({ module, compact = false }) {
  const Icon = module.icon;

  return (
    <Card
      className={cn(
        "h-full rounded-[30px] border-border/80 bg-card/96 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur-sm",
        module.highlight && "shadow-[0_32px_100px_rgba(20,184,166,0.14)]"
      )}
    >
      <CardContent className={cn("p-5 md:p-6", compact && "p-5")}>
        <div className="flex items-center justify-between gap-3">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
              module.accentBorder,
              module.accentBg,
              module.accentText
            )}
          >
            {module.step} / 05
            <span className="text-dim">当前聚焦模块</span>
          </div>
          <div className="text-xs text-dim">点击环上节点查看不同阶段</div>
        </div>

        <div className="mt-5 flex items-start gap-4">
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", module.iconClass)}>
            <Icon size={20} />
          </div>
          <div>
            <div className="text-2xl font-display font-bold tracking-tight">{module.title}</div>
            <div className="mt-1 text-sm text-dim">{module.headline}</div>
          </div>
        </div>

        <p className="mt-5 text-sm leading-7 text-dim">{module.desc}</p>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">系统会读取</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {module.reads.map((tag) => (
              <span key={tag} className="rounded-full border border-border/70 bg-bg/80 px-2.5 py-1 text-xs text-dim">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className={cn("mt-5 rounded-[24px] border p-4", module.previewClass)}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">运行示意</div>
          <div className="mt-3 space-y-2.5 text-sm leading-7">
            {module.preview.map((line) => (
              <div key={line.label}>
                <span className={cn("font-medium", line.tone)}>{line.label}</span>
                <span className="text-dim"> &gt; </span>
                <span className="text-dim">{line.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">写回长期记忆</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {module.writeback.map((tag) => (
              <span key={tag} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", module.chipClass)}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CenterMemoryCard({ activeModule, mobile = false }) {
  const ActiveIcon = activeModule.icon;

  return (
    <Card
      className={cn(
        "rounded-[28px] border-primary/18 bg-card/96 shadow-[0_26px_90px_rgba(245,158,11,0.14)] backdrop-blur-sm",
        !mobile && "animate-glow-pulse"
      )}
    >
      <CardContent className={cn("p-4", !mobile && "p-4")}>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
          <Repeat size={11} />
          长期记忆引擎
        </div>

        <h3 className={cn("mt-3 font-display font-bold tracking-tight leading-tight", mobile ? "text-xl" : "text-base")}>
          统一保存你的面试轨迹
        </h3>

        <div className="mt-3 grid gap-1.5">
          {["Session Context", "Topic Mastery", "Global Profile"].map((item) => (
            <div
              key={item}
              className="rounded-xl border border-border/80 bg-bg/85 px-3 py-1.5 text-xs text-dim shadow-sm"
            >
              {item}
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-border/80 bg-bg/85 p-2.5 shadow-sm">
          <div className="text-[10px] uppercase tracking-[0.2em] text-dim">当前正在驱动</div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", activeModule.iconClass)}>
              <ActiveIcon size={13} />
            </div>
            <div>
              <div className={cn("text-xs font-semibold", activeModule.accentText)}>{activeModule.title}</div>
              <div className="text-[11px] text-dim">{activeModule.headline}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ label, title, desc }) {
  return (
    <div className="max-w-4xl">
      <div className="text-sm font-medium text-primary">{label}</div>
      <h2 className="mt-3 text-2xl font-display font-bold tracking-tight md:text-4xl">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-dim md:text-base">{desc}</p>
    </div>
  );
}
