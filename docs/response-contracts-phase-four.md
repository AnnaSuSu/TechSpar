# 第四阶段：LLM 输出结构化校验

阶段四在 `packages/core` 的模型输出入口执行校验；HTTP 响应协议、已持久化的旧记录和第三阶段的 WS/SSE 传输形状保持兼容。传输层仍负责响应校验。模型返回合法 JSON 只是第一步，字段类型、数值范围、引用关系和必填内容均需在写入会话、画像、向量或 Prep 结果前通过校验。

| 生产者 | 校验重点 | 失败结果 |
| --- | --- | --- |
| Interview 题目、JD 预览和逐题复盘 | 题目 ID 唯一、难度 1–5；预览字段及蓝图完整；评分引用已存在题目，得分和维度 0–10 | 出题和预览拒绝创建会话；复盘任务进入 `review_failed`，不保存错误评分或更新画像 |
| Resume Interview 内嵌 `EVAL` | 分数 0–10、布尔推进标记、文本字段 | 去掉内部标记；错误评估不进入 `last_eval` 或历史 |
| Recording 双人/单人复盘 | Q&A 结构和 ID、评分引用、主题覆盖、嵌套整体分析 | 任务进入 `review_failed`，不保存错误 review/scores 或更新画像；双人模式已识别的问题和回答仍保留，方便恢复 |
| Profile 提取与跨领域归纳 | 洞察数组、行为信号 namespace/action、分数与置信度、薄弱点索引及跨领域约束 | 无效提取最多重试一次，不写画像、待投影记忆或向量；无效归纳整批丢弃 |
| Resume PDF 解析 | `basic` 对象、经历数组、要点数组及字段类型 | 最多重试一次，失败返回原有解析错误，已上传 PDF 保持可用 |
| Copilot Prep 五段分析 | 公司、JD、匹配、树节点/深度/环/引用、风险与准备提示 | Prep 标记 `error`，不写完成结果或预测薄弱点 |
| Copilot Realtime HR/monitor | 完整已知字段、字符串数组；事件 `type` 由程序决定 | 无效后台分析不发更新事件；有效未知扩展字段保留 |
| Provider 连接探测 | 恰好两道完整题、ID 唯一、难度 1–5 | 返回原有连接测试错误 |

模型输出的非法 JSON 和结构错误在直接 HTTP 用例中映射为 `provider_response_error` (502)。异步任务保持原有失败状态与重试入口。逐题复盘允许稀疏 `scores`：它只校验已返回的评分，未评分题继续显示 `-`，以兼容未作答和历史训练。Copilot `company_report` 继续存为 JSON 字符串，前端会解析它。调用方传入的历史 `preview_data` 仍按第二阶段兼容契约原样复用；严格蓝图校验只作用于本阶段新生成的 JD 预览。自然语言复盘、参考答案、Copilot 建议和 Markdown 回顾不属于 JSON 结构化输出，保持文本协议。

本阶段没有修改 HTTP/OpenAPI 数据形状；协议说明更新后已运行 `bun run gen:api` 并同步生成产物。验证包括目标单元和持久化测试、真实 Hono HTTP 契约测试、Bun/Node 类型检查、架构边界检查以及 `bun run check`。外部商业模型和搜索 API 不属于本地测试，测试使用确定性替身覆盖合法、缺字段、错类型、越界和引用错误。

## 实施取舍

- 通用标量、对象、数组、ID 校验位于 `kernel/structured-output.ts`，领域规则留在各 service；面试与录音共享 `interview/structured-review.ts`。核心没有引入 Zod、Hono 或供应商 SDK 依赖，符合贡献规范的依赖方向。
- JD 提示词同步声明完整结构。蓝图每个条目包含 `category`、`focus_area`、`intent`、`difficulty`；`resume_used` 最终由实际启用简历和读取到的内容决定，`jd_excerpt` 来自用户输入。
- 明确保留有限默认值：Interview 缺失题目 ID 时使用顺序 ID、缺失 difficulty 时为 3；错误类型不会触发默认。Resume 原文可能缺项，缺失/null 列表转成空数组，但对象、列表元素和已提供标量必须有正确类型。稀疏评分与历史缓存保持兼容。
- 三类成本受控的既有重试（专项训练、画像提取、简历解析）最多执行两次；Prep 与复盘依赖持久化任务失败/重试机制。实时 HR/monitor 分析为后台辅助，不因模型格式错误中断主要对话。
- Prep 策略树验证所有根与子节点存在、ID 与键一致、depth 为 0–3 并与实际路径一致，无环、无孤立节点、无多父节点。风险/提示中的 node_id 必须存在。策略质量目标“15–30 节点”不作为硬性结构限制，避免把较小但合法的树直接判成错误。

## PR #79 画像校验复核

维护者指出了两个不同的问题，均已用 `tests-ts/contracts/phase-four-profile.test.ts` 的真实文件仓储、SQLite 向量仓储与 Hono HTTP 请求覆盖：

1. [不适用的空行为字段](https://github.com/AnnaSuSu/TechSpar/pull/79#discussion_r4177988945)：此前对每个已提供文本调用 `requiredText`，会让 ADD 的空改善证据、NOOP 的空说明连带拒绝整份提取，这是本 PR 新增的回归。现在先检查所有已提供文本的类型，再按 action 要求实际会应用的内容非空；提示词同步说明这些规则。
2. [未校验的已知画像字段落盘](https://github.com/AnnaSuSu/TechSpar/pull/79#discussion_r4177988946)：强弱项通过 `...item` 保留字段，仅验证 point/topic/score/confidence 无法阻止 `archived: "false"`、`times_seen: "two"` 等污染后续 HTTP 响应。这是基线已有、阶段四尚未封住的入口。现在补齐所有会保留的已知 observation 字段，以及 history、弱项 sr/consolidates/user_acknowledged 的嵌套类型校验；未知扩展仍保留，不回写或迁移历史档案。

| 行为 | 必须非空的文本 | 其他文本 |
| --- | --- | --- |
| ADD | description、snippet | evidence_snippet 可省略或为空字符串 |
| UPDATE | snippet | description、evidence_snippet 可省略或为空字符串 |
| IMPROVE | evidence_snippet | description、snippet 可省略或为空字符串 |
| NOOP | 无 | 均可省略或为空字符串 |

所有 action 的已提供文本仍拒绝 null、对象、数组和数字。已知可选画像字段允许契约中合法的 false、0 和空字符串；无效字段在 embedding、画像 update/save、向量 replace/append 之前被拒绝。测试同时验证失败后的画像文件字节不变、重复 GET /api/profile 仍为 200，以及合法提取重放不会重复增加统计或记忆。

## 验证记录

本地最终使用 Bun 1.3.14 运行：

| 命令 | 结果 |
| --- | --- |
| `bun run check` | 429 个后端/跨模块测试、7 个前端 Node 测试通过；Bun/Node 类型检查、架构边界、前端 TS/ESLint、API/Web/Electron/sidecar 构建与 macOS arm64 目录打包通过 |
| `bun run test:contracts` | 190 个测试通过，包括真实 Hono 请求和 Bun WebSocket 边界；其中新增 59 个画像校验回归测试 |
| `bun run gen:api` | 已生成；OpenAPI 和前端类型的差异仅为描述/注释 |
| `git diff --check` | 通过 |

环境处理：本机默认 Bun 为 1.4.2 且 PATH 没有 Node，首次检查在前端 `node --test` 步骤失败。将应用自带 Node 加入 PATH 后完整检查通过，再把官方 Bun 1.3.14 解压到临时目录并按贡献规范复验通过，未覆盖全局运行时或修改构建脚本。前端仍有已有的 41 个 ESLint warning、构建包大小提示；macOS 目录包未进行发行签名。本次没有执行真实商业 LLM/ASR 调用或 Windows 打包。
