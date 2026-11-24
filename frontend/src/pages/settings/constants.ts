import { Boxes, Database, KeyRound, Server, Sliders, Sun, UserCog } from "lucide-react";

export const labelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80";
export const inputClass = "h-12 rounded-2xl bg-card/90";

export const DIVERGENCE_OPTIONS = [
  { value: 1, label: "聚焦薄弱", description: "100% 针对存在弱点的知识域，适合考前专项突击" },
  { value: 2, label: "侧重薄弱", description: "约 70% 针对薄弱点，30% 拓展至新知识点" },
  { value: 3, label: "均衡", description: "薄弱环节巩固与全新知识盲区发掘各占 50%" },
  { value: 4, label: "侧重探索", description: "约 30% 回顾薄弱点，70% 探索全新知识层面" },
  { value: 5, label: "全面探索", description: "100% 探索未涉猎过的新知识领域，发掘潜在盲区" },
];

/**
 * key 来源的两个选项。
 *
 * 后端只存一个 `use_platform`：默认自己的 key 优先（填了就是想用它），
 * 勾上则显式改走部署方的共享 key，自己的 key 留着不删。
 */
export const LLM_SOURCE_OPTIONS = [
  {
    value: "platform",
    platform: true,
    label: "用平台提供的 key",
    description: "不用配置，开箱即用；按账号额度计费，用完需要赞助或换成自己的 key。",
  },
  {
    value: "own",
    platform: false,
    label: "用我自己的 key",
    description: "不消耗平台额度，用量不设上限；费用直接结算在你自己的服务商那边。",
  },
];

export const EMBEDDING_BACKEND_OPTIONS = [
  { value: "", label: "自动", hint: "填了 API 字段走 API，否则走本地（兼容老配置）" },
  { value: "api", label: "API", hint: "通过 OpenAI 兼容接口请求 embedding" },
  { value: "local", label: "本地", hint: "用 Transformers.js 在本机运行 ONNX 模型，首次使用会自动下载并缓存" },
] as const;

export const IMPORT_DB_OPTIONS = [
  { value: "skip", label: "保留本地" },
  { value: "overwrite", label: "用归档覆盖" },
] as const;

export const SETTINGS_TABS = [
  { id: "appearance", label: "外观", icon: Sun },
  { id: "llm", label: "LLM 服务", icon: Server },
  { id: "embedding", label: "Embedding", icon: Boxes },
  { id: "services", label: "可选服务", icon: KeyRound },
  { id: "training", label: "训练参数", icon: Sliders },
  { id: "account", label: "账户", icon: UserCog },
  { id: "migration", label: "数据迁移", icon: Database },
] as const;
