import { useRef, type KeyboardEvent } from "react";
import { ArrowRight, BriefcaseBusiness, FileText, MessageCircle, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import JobPrep from "./JobPrep";
import ResumeInterview from "./ResumeInterview";

type InterviewMode = "live" | "targeted";

const MODES = [
  {
    key: "live" as const,
    icon: MessageCircle,
    title: "实时模拟",
    shortTitle: "实时模拟",
    requirement: "简历必选 · JD 选填",
    description: "AI 面试官根据回答动态追问，适合完整演练一轮真实面试。",
  },
  {
    key: "targeted" as const,
    icon: BriefcaseBusiness,
    title: "岗位备面",
    shortTitle: "岗位备面",
    requirement: "JD 必填 · 简历选填",
    description: "先拆解岗位要求和匹配度，再集中训练高概率问题。",
  },
];

export default function MockInterview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedMode: InterviewMode =
    searchParams.get("mode") === "targeted" ? "targeted" : "live";
  const selected = MODES.find((mode) => mode.key === selectedMode) ?? MODES[0];

  const selectMode = (mode: InterviewMode) => {
    const next = new URLSearchParams(searchParams);
    next.set("mode", mode);
    setSearchParams(next, { replace: true });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % MODES.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + MODES.length) % MODES.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = MODES.length - 1;
    const nextMode = MODES[nextIndex];
    selectMode(nextMode.key);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="flex-1 w-full">
      <PageContainer size="default" className="pb-0">
        <PageHeader
          icon={<FileText size={21} />}
          eyebrow="面试工作台"
          title="面试训练"
          description="准备本次面试资料，选择更适合当前目标的训练方式。"
        />

        <div className="mt-5 rounded-2xl border border-border/75 bg-card/65 p-1.5 shadow-sm">
          <div
            role="tablist"
            aria-label="面试训练方式"
            className="grid grid-cols-2 gap-1.5"
          >
            {MODES.map((mode, index) => {
              const Icon = mode.icon;
              const active = selectedMode === mode.key;
              return (
                <button
                  key={mode.key}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  id={`interview-mode-${mode.key}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="interview-mode-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectMode(mode.key)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={cn(
                    "group flex min-h-14 items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:justify-start md:px-4",
                    active
                      ? "bg-background text-text shadow-sm ring-1 ring-border/70"
                      : "text-dim hover:bg-background/45 hover:text-text"
                  )}
                >
                  <span className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                    active ? "bg-primary/12 text-primary" : "bg-hover/70 text-dim group-hover:text-text"
                  )}>
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold md:hidden">{mode.shortTitle}</span>
                    <span className="hidden text-sm font-semibold md:block">{mode.title}</span>
                    <span className="hidden text-[11px] leading-4 text-dim lg:block">{mode.requirement}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2.5 flex flex-col gap-2 rounded-xl px-2 py-1.5 text-[13px] leading-5 text-dim sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
            <span><span className="font-medium text-text">{selected.requirement}</span>：{selected.description}</span>
          </div>
          <Link
            to="/topic-drill"
            className="group flex shrink-0 items-center gap-1.5 pl-5 text-[12px] font-medium text-dim transition-colors hover:text-primary sm:pl-0"
          >
            想按技术领域练习？前往专项训练
            <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </PageContainer>

      <div
        id="interview-mode-panel"
        role="tabpanel"
        aria-labelledby={`interview-mode-${selectedMode}`}
        className="mx-auto w-full max-w-[1180px] px-4 md:px-7 xl:px-8"
      >
        {selectedMode === "live" ? <ResumeInterview embedded /> : <JobPrep embedded />}
      </div>
    </div>
  );
}
