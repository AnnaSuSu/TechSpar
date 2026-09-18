import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Brain,
  ChevronDown,
  Mic,
  BarChart3,
  Repeat,
  BookOpen,
  BriefcaseBusiness,
  FileText,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import useScrollReveal from "@/hooks/useScrollReveal";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Logo from "../components/Logo";
import GitHubStar from "../components/GitHubStar";
import AfdianIcon from "../components/AfdianIcon";
import heroArt from "../assets/hero-art.jpg";

/** 赞助页。托管版的服务器与模型推理费用由此支撑。 */
const SPONSOR_URL = "https://ifdian.net/a/techspar";
import heroIntro from "../assets/hero-intro.mp4";
import storyRemember from "../assets/story-remember.jpg";
import storyAdapt from "../assets/story-adapt.jpg";
import storyCompanion from "../assets/story-companion.jpg";
import momentDrill from "../assets/moment-01-drill.jpg";
import momentResume from "../assets/moment-02-resume.jpg";
import momentJd from "../assets/moment-03-jd.jpg";
import momentCopilot from "../assets/moment-04-copilot.jpg";
import momentReview from "../assets/moment-05-review.jpg";
import momentOffer from "../assets/moment-06-offer.jpg";
import ctaFigure from "../assets/cta-figure.jpg";

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
    glowColor: "rgba(245,158,11,0.18)",
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
    glowColor: "rgba(34,197,94,0.18)",
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
    glowColor: "rgba(59,130,246,0.18)",
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
    glowColor: "rgba(20,184,166,0.22)",
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
    glowColor: "rgba(251,146,60,0.18)",
  },
];

const STORY_WORDS = [
  {
    key: "remember",
    word: "练完不忘",
    desc: "每一轮的得分、弱点和表达习惯，都会写回同一套长期记忆，不会随会话结束蒸发。",
    img: storyRemember,
  },
  {
    key: "adapt",
    word: "越练越懂",
    desc: "下一轮开始前，系统先读画像再决定问什么、提醒什么——是延续训练，不是重新开始。",
    img: storyAdapt,
  },
  {
    key: "companion",
    word: "实战陪跑",
    desc: "真实面试里，Copilot 沿着你的高危路径预测下一步追问，把准备一路带进实战。",
    img: storyCompanion,
  },
];

const MOMENTS = [
  {
    num: "01",
    img: momentDrill,
    title: "弱点不再漏网",
    desc: "每一轮都从历史错因出发，追着薄弱点出题，而不是重新随机刷一遍。",
    tilt: "-rotate-2",
    chip: "bg-amber-600 text-white",
  },
  {
    num: "02",
    img: momentResume,
    title: "项目终于讲清了",
    desc: "围绕真实经历深挖，表达短板和技术深度缺口一个个暴露、一个个补掉。",
    tilt: "rotate-1",
    chip: "bg-emerald-700 text-white",
  },
  {
    num: "03",
    img: momentJd,
    title: "备面像做作战地图",
    desc: "输入 JD，系统拆出岗位要求、高概率追问和风险点，不再凭感觉准备。",
    tilt: "rotate-2",
    chip: "bg-blue-700 text-white",
  },
  {
    num: "04",
    img: momentCopilot,
    title: "追问被预判了",
    desc: "真实面试里持续转写 HR 发言，预测下一步追问，提前半步给你建议。",
    tilt: "-rotate-1",
    chip: "bg-teal-700 text-white",
  },
  {
    num: "05",
    img: momentReview,
    title: "失误写回系统",
    desc: "录音自动转写、逐题复盘，失分点回流画像，下一轮训练更贴近真实。",
    tilt: "rotate-1",
    chip: "bg-orange-700 text-white",
  },
  {
    num: "06",
    img: momentOffer,
    title: "一切都值得",
    desc: "从第一轮刷题到真实 Offer，系统记得你走过的每一步。",
    tilt: "-rotate-2",
    chip: "bg-amber-600 text-white",
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

const revealStyle = (delay) => ({ "--reveal-delay": `${delay}s` });

/* ── Typing effect for detail panel preview lines ── */
function TypedLine({ text, delay = 0 }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    let i = 0;
    let interval = null;
    const timer = window.setTimeout(() => {
      setDisplayed("");
      interval = window.setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) window.clearInterval(interval);
      }, 22);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      if (interval != null) window.clearInterval(interval);
    };
  }, [delay, text]);

  return (
    <span className="text-dim">
      {displayed}
      {displayed.length < text.length && (
        <span className="inline-block w-[2px] h-[14px] bg-primary/60 align-middle ml-0.5 animate-pulse" />
      )}
    </span>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  // 开场视频只播一遍:先留在深色底上,首帧解码后淡入,避免播放前先闪一下静帧;
  // 播完淡出定格到静帧,视频出错时也回落到静帧;reduced-motion 直接出静帧
  const [heroVideoDone, setHeroVideoDone] = useState(false);
  const [heroVideoReady, setHeroVideoReady] = useState(false);
  const [showHeroVideo] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // 落地页锁深色(视觉世界观基于暗琥珀);离开时恢复用户在应用内的主题偏好
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => {
      document.documentElement.classList.toggle(
        "dark",
        (localStorage.getItem("theme") || "dark") === "dark"
      );
    };
  }, []);

  const loopRef = useScrollReveal();
  const momentsRef = useScrollReveal();
  const ctaRef = useScrollReveal();

  const scrollToLoop = () => {
    document.getElementById("loop")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing-motion min-h-screen bg-bg text-text">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(245,158,11,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(245,158,11,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-60 pointer-events-none" />
      <div className="grain-overlay" aria-hidden="true" />

      <header className="sticky top-0 z-40">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8 w-8 rounded-lg drop-shadow-sm" />
            <div>
              <div className="text-lg font-display font-bold leading-none">TechSpar</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.24em] text-dim">From Practice To Real Interview</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <GitHubStar />
            <a
              href={SPONSOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="在爱发电赞助 TechSpar"
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-sm font-medium text-text backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-card"
            >
              <AfdianIcon size={15} className="text-primary transition-transform duration-300 group-hover:scale-110" />
              <span className="hidden sm:inline">赞助</span>
            </a>
            <Button variant="outline" onClick={() => navigate("/login")}>
              登录
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="relative -mt-[72px] flex min-h-screen flex-col overflow-hidden border-b border-border/60">
          <div className="absolute inset-0 bg-bg">
            {/* 静帧仅作视频定格与兜底:开场用视频时先隐藏,避免播放前先闪一下静图 */}
            <img
              src={heroArt}
              alt=""
              className={cn(
                "h-full w-full object-cover object-center transition-opacity duration-700",
                showHeroVideo && !heroVideoDone ? "opacity-0" : "opacity-100"
              )}
            />
            {showHeroVideo && (
              <video
                className={cn(
                  "absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700",
                  heroVideoReady && !heroVideoDone ? "opacity-100" : "opacity-0"
                )}
                autoPlay
                muted
                playsInline
                preload="auto"
                onLoadedData={() => setHeroVideoReady(true)}
                onEnded={() => setHeroVideoDone(true)}
                onError={() => setHeroVideoDone(true)}
              >
                <source src={heroIntro} type="video/mp4" />
              </video>
            )}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(9,9,11,0.2)_0%,rgba(9,9,11,0.08)_45%,rgba(9,9,11,0.5)_100%)]" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/20" />
          </div>

          <div className="relative z-10 mx-auto flex max-w-4xl flex-1 flex-col items-center justify-end px-6 pt-[72px] pb-12 text-center">
            <h1 className="text-4xl font-serif font-bold leading-tight tracking-normal md:text-5xl lg:text-6xl md:leading-[1.15] animate-fade-in-up">
              把技术面试做成
              <span className="hero-gradient-text mt-3 block bg-gradient-to-r from-accent-light via-accent to-orange bg-clip-text text-transparent">
                一条持续进化的闭环
              </span>
            </h1>

            <p className="mt-9 max-w-xl text-base leading-8 tracking-[0.04em] text-dim md:text-lg animate-fade-in-up [animation-delay:0.1s]">
              训练、实战和复盘共用一套长期记忆，<span className="font-medium text-text">越练越懂你</span>。
            </p>

            <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row animate-fade-in-up [animation-delay:0.2s]">
              <Button variant="gradient" size="lg" onClick={() => navigate("/login")}>
                在线体验
                <ArrowRight size={16} />
              </Button>
              <button
                type="button"
                onClick={scrollToLoop}
                className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-dim transition-colors hover:text-text"
              >
                看闭环怎么运转
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <div className="relative z-10 flex justify-center pb-10 animate-fade-in [animation-delay:0.5s]">
            <div className="flex flex-col items-center gap-1 text-xs tracking-[0.3em] text-dim">
              滑动继续
              <ChevronDown size={16} className="animate-bounce" />
            </div>
          </div>
        </section>

        <StoryScreens />

        <section id="loop" ref={loopRef} className="scroll-reveal px-6 pb-16 pt-4 md:px-10 md:pb-24">
          <div className="mx-auto max-w-7xl">
            <div className="reveal-item" style={revealStyle(0.04)}>
              <SectionHeading
                label="面试闭环"
                title="这套闭环怎么运转"
                desc="五个模块不是五个孤岛：每个模块的输入与输出都会写回同一套长期记忆，驱动下一轮训练、辅助和复盘。"
              />
            </div>

            <div className="reveal-item mt-10" style={revealStyle(0.12)}>
              <LoopVisual />
            </div>

            <div
              className="reveal-item mt-12 grid gap-6 border-t border-border/60 pt-8 md:grid-cols-3"
              style={revealStyle(0.2)}
            >
              {MEMORY_LAYERS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        {item.title}
                        <span className="ml-2 text-xs font-normal text-dim">{item.subtitle}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-6 text-dim">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section ref={momentsRef} className="scroll-reveal px-6 pb-20 md:px-10 md:pb-28">
          <div className="mx-auto max-w-7xl">
            <div className="reveal-item" style={revealStyle(0.04)}>
              <SectionHeading
                label="真实时刻"
                title="那些真正帮上忙的时刻。"
                desc="不是功能清单，而是 TechSpar 进入备面日常之后，一次次接住麻烦、记得你、把事情往前推的瞬间。"
              />
            </div>

            <div className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 xl:grid-cols-3">
              {MOMENTS.map((item, index) => (
                <div
                  key={item.num}
                  className={cn(
                    "reveal-item rounded-[6px] bg-[#f3ecdd] p-3 pb-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] transition-transform duration-300 hover:rotate-0 hover:-translate-y-1",
                    item.tilt
                  )}
                  style={revealStyle(0.06 + index * 0.06)}
                >
                  <div className="overflow-hidden rounded-[3px]">
                    <img src={item.img} alt={item.title} loading="lazy" className="aspect-square w-full object-cover" />
                  </div>
                  <div className="mt-4 flex items-center gap-3 px-1">
                    <span
                      className={cn(
                        "flex h-7 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold tracking-wider",
                        item.chip
                      )}
                    >
                      {item.num}
                    </span>
                    <span className="text-lg font-display font-bold text-zinc-800">{item.title}</span>
                  </div>
                  <p className="mt-2 px-1 text-sm leading-6 text-zinc-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          ref={ctaRef}
          className="scroll-reveal relative flex min-h-screen items-center justify-center overflow-hidden px-6 md:px-10"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="story-glow absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[130px]" />
            <img
              src={ctaFigure}
              alt=""
              loading="lazy"
              className="absolute bottom-0 right-0 hidden h-[82%] w-auto opacity-90 lg:block [mask-image:radial-gradient(ellipse_62%_78%_at_55%_48%,black_52%,transparent_98%)]"
            />
          </div>

          <div className="relative mx-auto max-w-4xl text-center">
            <div className="reveal-item text-sm font-medium text-primary" style={revealStyle(0.04)}>
              准备、模拟、实战、复盘，全部接进同一条闭环
            </div>
            <h2
              className="reveal-item mt-5 text-4xl font-serif font-bold tracking-normal md:text-6xl md:leading-[1.15]"
              style={revealStyle(0.1)}
            >
              从第一轮刷题开始，到真实面试结束后复盘，系统都不会忘记你
            </h2>
            <p
              className="reveal-item mx-auto mt-6 max-w-xl text-base leading-8 text-dim md:text-lg"
              style={revealStyle(0.16)}
            >
              这不是另一个只会生成题目的 AI 工具，而是一套从刷题到实战的技术面试陪练系统。
            </p>
            <div className="reveal-item mt-10 flex justify-center" style={revealStyle(0.22)}>
              <Button
                variant="gradient"
                size="lg"
                className="shadow-[0_0_40px_rgba(245,158,11,0.25)] transition-shadow hover:shadow-[0_0_72px_rgba(245,158,11,0.45)]"
                onClick={() => navigate("/login")}
              >
                进入 Demo
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 px-6 py-10 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <span className="font-display font-bold">TechSpar</span>
          </div>
          <p className="text-xs text-dim">从刷题到实战的 AI 技术面试陪练系统</p>
          <p className="max-w-md text-xs leading-relaxed text-dim">
            社区版支持自行部署，官方云服务提供平台模型与套餐。你的支持会用于服务器、模型推理和持续开发。
            <a
              href={SPONSOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text underline underline-offset-2 transition-colors hover:text-primary"
            >
              赞助
            </a>
            一点能让它继续做下去。
          </p>
          <div className="flex gap-6 text-xs">
            <a
              href="https://github.com/AnnaSuSu/TechSpar"
              target="_blank"
              rel="noreferrer"
              className="text-dim transition-colors hover:text-text"
            >
              GitHub
            </a>
            <a
              href="https://techspar.cn/"
              target="_blank"
              rel="noreferrer"
              className="text-dim transition-colors hover:text-text"
            >
              在线 Demo
            </a>
            <a
              href={SPONSOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-dim transition-colors hover:text-text"
            >
              爱发电
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── 叙事大字屏:sticky 三屏,滚动驱动词组逐字浮现 ── */
function StoryScreens() {
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = containerRef.current;
        if (!el) return;
        const total = el.offsetHeight - window.innerHeight;
        if (total <= 0) return;
        const progress = Math.min(Math.max(-el.getBoundingClientRect().top / total, 0), 0.999);
        setActive(Math.floor(progress * STORY_WORDS.length));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative"
      style={{ height: `${STORY_WORDS.length * 100}vh` }}
    >
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        {STORY_WORDS.map((item, index) => (
          <img
            key={item.key}
            src={item.img}
            alt=""
            loading="lazy"
            className={cn(
              "absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700",
              index === active ? "opacity-100" : "opacity-0"
            )}
          />
        ))}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(9,9,11,0.5)_0%,rgba(9,9,11,0.35)_50%,rgba(9,9,11,0.8)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/70 via-transparent to-bg/70" />

        <div className="relative w-full px-6 text-center">
          <div className="text-sm font-medium text-primary">为什么 TechSpar 不只是一个题库？</div>

          <div className="relative mx-auto mt-6 h-64 w-full max-w-3xl md:h-72">
            {STORY_WORDS.map((item, index) => (
              <div
                key={item.key}
                className={cn("story-word absolute inset-x-0 top-6", index === active && "active")}
                aria-hidden={index !== active}
              >
                <div className="font-serif text-6xl font-bold tracking-normal text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)] md:text-8xl">
                  {item.word.split("").map((char, charIndex) => (
                    <span
                      key={charIndex}
                      className="story-char"
                      style={{ "--char-delay": index === active ? `${charIndex * 90}ms` : "0ms" }}
                    >
                      {char}
                    </span>
                  ))}
                </div>
                <p className="mx-auto mt-6 max-w-xl text-base leading-8 text-white/80 drop-shadow-[0_1px_10px_rgba(0,0,0,0.8)] md:text-lg">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-2">
            {STORY_WORDS.map((item, index) => (
              <span
                key={item.key}
                className={cn(
                  "h-1 rounded-full transition-all duration-300",
                  index === active ? "w-8 bg-primary" : "w-3 bg-border"
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
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

      <div className="relative hidden h-[760px] md:block">
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
              className="loop-beam"
              style={{ "--beam-delay": "0s" }}
            />
            <path
              d="M224 134 A176 176 0 0 1 362 172"
              stroke="rgba(34,197,94,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
              className="loop-beam"
              style={{ "--beam-delay": "0.4s" }}
            />
            <path
              d="M362 176 A176 176 0 0 1 340 432"
              stroke="rgba(59,130,246,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
              className="loop-beam"
              style={{ "--beam-delay": "0.8s" }}
            />
            <path
              d="M336 436 A176 176 0 0 1 116 500"
              stroke="rgba(20,184,166,0.32)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
              className="loop-beam"
              style={{ "--beam-delay": "1.2s" }}
            />
            <path
              d="M112 494 A176 176 0 0 1 78 168"
              stroke="rgba(251,146,60,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
              markerEnd="url(#loop-arrow)"
              className="loop-beam"
              style={{ "--beam-delay": "1.6s" }}
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

          <div className="loop-shell absolute z-10 left-1/2 top-1/2 w-[220px] -translate-x-1/2 -translate-y-1/2">
            <CenterMemoryCard activeModule={activeModule} />
          </div>
        </div>

        <div className="absolute bottom-14 left-8 right-[36%] flex justify-center">
          <div className="rounded-full border border-primary/15 bg-bg/88 px-4 py-3 text-center text-sm text-dim shadow-sm backdrop-blur-sm">
            训练 → 评估 → 画像更新 → 下一轮更精准
          </div>
        </div>

        <div className="absolute right-8 top-8 bottom-8 w-[32%]">
          <div key={activeModule.key} className="detail-panel-enter h-full">
            <DetailPanel module={activeModule} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoopNode({ item, active, onSelect, className, mobile = false }) {
  const Icon = item.icon;
  const motionDelay = `${(Number(item.step) - 1) * 0.35}s`;

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
      <div className={cn(!mobile && "loop-node-body")} style={!mobile ? { "--float-delay": motionDelay } : undefined}>
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
                <TypedLine text={line.text} delay={module.preview.indexOf(line) * 600} />
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
      <h2 className="mt-3 text-2xl font-serif font-bold tracking-normal md:text-4xl">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-dim md:text-base">{desc}</p>
    </div>
  );
}
