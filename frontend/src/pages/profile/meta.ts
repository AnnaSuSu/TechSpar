export const MODE_META = {
  resume: { color: "var(--ai-glow)", label: "简历面试" },
  topic_drill: { color: "var(--success)", label: "专项训练" },
  jd_prep: { color: "#60a5fa", label: "JD 备面" },
  recording: { color: "#22d3ee", label: "录音复盘" },
  copilot: { color: "#c084fc", label: "面试 Copilot" },
};

export const TRAINING_MODE_META = {
  resume: {
    label: "简历面试",
    accentClassName: "text-primary",
    borderClassName: "border-l-primary",
    glowClassName: "shadow-[inset_3px_0_0_rgba(245,158,11,0.18)]",
    countKey: "resume_sessions",
    avgKey: "resume_avg_score",
  },
  topic_drill: {
    label: "专项训练",
    accentClassName: "text-green",
    borderClassName: "border-l-green",
    glowClassName: "shadow-[inset_3px_0_0_rgba(34,197,94,0.18)]",
    countKey: "drill_sessions",
    avgKey: "drill_avg_score",
  },
  jd_prep: {
    label: "JD 备面",
    accentClassName: "text-blue-400",
    borderClassName: "border-l-blue-400",
    glowClassName: "shadow-[inset_3px_0_0_rgba(96,165,250,0.18)]",
    countKey: "job_prep_sessions",
    avgKey: "job_prep_avg_score",
  },
  // 后端 _update_stats 一直在统计这两种模式,此前前端漏展示
  recording: {
    label: "录音复盘",
    accentClassName: "text-info",
    borderClassName: "border-l-info",
    glowClassName: "",
    countKey: "recording_sessions",
    avgKey: "recording_avg_score",
  },
  copilot: {
    label: "面试 Copilot",
    accentClassName: "text-purple-400",
    borderClassName: "border-l-purple-400",
    glowClassName: "",
    countKey: "copilot_sessions",
    avgKey: "copilot_avg_score",
  },
};

// 复盘产出的四维评分(简历面试 / JD 备面),画像页聚合展示用
export const DIMENSION_SCORE_META = [
  { key: "technical_depth", label: "技术深度" },
  { key: "project_articulation", label: "项目阐述" },
  { key: "communication", label: "表达沟通" },
  { key: "problem_solving", label: "问题解决" },
];

export const PAGE_CLASS = "flex-1 w-full max-w-[1600px] mx-auto px-4 py-6 md:px-7 md:py-8 xl:px-10 2xl:px-12";

export const ZONE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "focus", label: "补课区" },
  { key: "build", label: "过渡区" },
  { key: "strong", label: "优势区" },
];

export const EVIDENCE_TYPE_ALL = "all";

export const EVIDENCE_TYPES = [
  { key: EVIDENCE_TYPE_ALL, label: "全部" },
  { key: "weak", label: "待改进", tone: "destructive" },
  { key: "strong", label: "强项", tone: "success" },
  { key: "improved", label: "已改善", tone: "blue" },
];

export const PERFORMANCE_DIMENSIONS = {
  communication: { label: "表达与沟通", color: "text-blue-400", bg: "bg-blue-400/10" },
  reasoning: { label: "推导与思维", color: "text-amber-500", bg: "bg-amber-500/10" },
  narrative: { label: "叙事与项目描述", color: "text-purple-400", bg: "bg-purple-400/10" },
  metacognition: { label: "元认知", color: "text-cyan-400", bg: "bg-cyan-400/10" },
};
