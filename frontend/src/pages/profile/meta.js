export const MODE_META = {
  resume: { color: "var(--ai-glow)", label: "简历面试" },
  topic_drill: { color: "var(--success)", label: "专项训练" },
  jd_prep: { color: "#60a5fa", label: "JD 备面" },
  recording: { color: "#22d3ee", label: "录音复盘" },
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
};

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
