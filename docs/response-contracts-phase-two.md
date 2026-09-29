# 第二阶段：Interview / Task / Profile 响应契约

本阶段覆盖 Interview 与 Profile 路由中的 21 个 JSON 操作。每个操作同时声明并执行响应校验；请求参数、路径、鉴权、正常响应层级和原有业务状态机保持不变。Interview chat SSE 属于第三阶段，LLM 原始输出校验属于第四阶段，旧动态 schema 导出的删除属于第五阶段。

## 分层与入口

- packages/core/src/interview/results.ts 定义纯 TypeScript 用例结果，Profile 端口明确返回 marker、WeakPoint、InterviewSession 与 retrospective 结果。
- packages/contracts/src/interview-responses.ts、task-responses.ts、profile-responses.ts 定义 HTTP 响应结构；core 不导入 Zod 或 Hono。
- apps/api/src/http/response.ts 在发送 JSON 前校验真实返回值；响应声明与执行校验使用相同结构。
- OpenAPI component 使用 Zod 原生 metadata 命名，不依赖 Hono 扩展 Zod 的模块加载顺序。
- frontend/src/api/schema.d.ts 通过 bun run gen:api 生成，JobPrep、Profile 派生视图与任务状态消费生成类型。

## 接口结构

| 接口族 | 响应 |
| --- | --- |
| JD preview | 已归一化的 preview，包括 focus_areas、question groups、resume alignment |
| JD start | session_id、jd_prep mode、questions、preview、company、position、meta |
| Interview start | resume / topic_drill 判别联合，各自具有必要字段 |
| Chat | session_id、message、is_finished；完成时允许空 message |
| End / generate review | session_id、mode、pending / done |
| Draft | ongoing + saved=true，或非 ongoing + saved=false |
| Resume | 会话恢复数据、meta、transcript、questions 与恢复标志 |
| Review / topic history | 完整 InterviewSession / InterviewSession 数组 |
| Interview history | 摘要数组与 total；摘要 meta 排除 source_transcript |
| Profile | 完整画像，due_reviews 为 point/topic/next_review 摘要 |
| Profile viewed | at、total_sessions、topic_scores |
| Pattern feedback / due reviews | 完整 WeakPoint / WeakPoint 数组 |
| Task status | pending / error / done；结果字段保持在顶层 |

reference-answer、delete session、topics、infer-target-role 与 retrospective 提交响应沿用现有明确结构，并增加输出校验。

## Task 兼容规则

内部 running 继续对外显示 pending。resume_review、drill_review、jd_review、recording_review 与历史 review 类型完成后可以包含 session_id；已 reviewed 会话的快捷分支只返回 status/type，仍然有效。

copilot_prep 完成必须提供 prep_id。retrospective 完成必须提供 topic、topic_name、retrospective、retrospective_at、session_count。未知类型的兼容分支通过正则显式排除已知类型，运行时和 OpenAPI 使用同一个排除规则；已知类型缺少必要字段不会通过宽泛分支绕过校验。pending/error 保留存储记录可能携带的旧结果字段。

review_failed 的 review_error 可以为空。响应 schema 接受 string/null/缺失，修复此前 service 返回 null 而旧 TaskStatusSchema 报 500 的不一致。

HTTP 不增加 result 包装。前端 applyTaskResponse 把整个扁平响应存入 UI 的 result 字段，领域回顾通知由真实 topic 导航。已有 review 快捷响应继续按任务 ID 导航。

## 显式保留的兼容区域

| 区域 | 原因与约束 |
| --- | --- |
| Session meta、scores、overall、weak_points | 存储与模型原始内容；本阶段校验容器，不新增模型评分范围或固定维度要求 |
| Question / message 扩展字段 | 保留已有 JSON 扩展；已声明 ID、问题、角色、正文等字段仍校验 |
| JD start 的 preview / meta.preview | 请求允许直接传入任意 preview_data，不能强制当作已归一化 preview |
| preview.question_blueprint 元素 | 当前服务仅保证数组，元素结构在第四阶段校验 |
| Profile 及其持久化子对象扩展 | 导入/合并保留历史字段；已声明字段继续校验，未知字段不被裁剪 |
| Profile session_extractions | 保留提取缓存，内容生产者校验在第四阶段处理 |
| 历史可选子字段 | 允许旧 mastery.level、部分 view_marker、无 sr 的预测弱点与部分历史事件 |

稳定响应外壳拒绝未知字段。兼容对象显式透传扩展，避免普通对象解析默默删除已有字段。响应校验不使用 default/coerce/transform 修补生产者数据。空字符串时间、SQLite 时间、数字/字符串 question ID、topic 的缺失/null 与合法空集合保持现状；score=0 不回退到旧 level。

旧 InterviewObjectSchema、ProfileSchema、TaskStatusSchema 保留弃用标记，本阶段路由不再使用它们。盘点表中的 dynamic=false 表示已有具名根结构，并不表示所有兼容区域均已关闭；具体区域记录在 notes。

## 错误边界与日志

无效服务响应抛出 ResponseContractError，由现有集中错误处理器返回 500 和通用 Internal Server Error。客户端请求验证仍返回现有 422，AppError/provider 错误沿用现有映射。

错误仅携带 operation 模板、requestId、issue code 与字段路径。动态 map 的键替换为星号，不附带原始响应、Zod 错误消息或未知字段列表，避免简历/会话/模型内容进入日志。

## 验证方法

1. phase-two-responses.test.ts 枚举 21 个操作，验证完整 JSON 等值，并注入无效服务返回值确认真实 HTTP 输出校验生效。
2. phase-two-services.test.ts 使用真实 InterviewService/ProfileService、SQLite repositories、内存画像仓储和确定性外部端口替身，覆盖状态分支、用户隔离、缓存与持久化结果。
3. phase-two-openapi.test.ts 验证 required、联合分支、任务兼容排除规则、对象族差异及生成文件一致性。
4. phase-two-frontend.test.ts 验证生成 DTO 到任务通知导航的映射，以及画像零分、旧 level 和访问差值的派生结果。为使同一严格 TS 检查覆盖该逻辑，相关静态 meta 常量由 JS 原样迁移为 TS。
5. 保留第一阶段的路径、鉴权、请求体必填、422 和 SSE 回归测试。

所有新增 fixture 均为合成数据。完整会话和丰富画像包含非空嵌套结构、历史扩展、可选字段及空值，不使用真实简历、用户画像或运行数据库。

开发时运行定向回归；提交前按照 CONTRIBUTING.md 使用 Bun 1.3.14 执行完整检查：

~~~sh
bun run gen:api
bun run test:contracts
bun test tests-ts/http-nullable-contracts.test.ts tests-ts/interview.test.ts tests-ts/profile.test.ts tests-ts/task-queue.test.ts
bun run check
~~~

生成的 OpenAPI 和前端类型必须一起提交；再次执行生成命令应无额外差异。完整 check 包括 Bun/Node 类型检查、架构边界、全部后端测试、前端测试/类型/Lint、API/Web/桌面构建和 Electron 打包验证。
