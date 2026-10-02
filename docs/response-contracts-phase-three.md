# 第三阶段：Copilot WebSocket / SSE 事件契约

本阶段覆盖 `WS /ws/copilot/{session_id}`、`POST /api/interview/chat/stream` 和 `POST /api/settings/rebuild-index`。正常消息保留现有扁平 JSON 结构、事件名、路径、鉴权及 SSE `data: JSON\n\n` 格式。Copilot Prep 普通 HTTP 响应、LLM 原始输出的完整性与语义校验、旧动态 schema 的删除仍属于后续工作。

## CONTRIBUTING.md 要求与实施

| 要求 | 实施 |
| --- | --- |
| Core 保持纯 TypeScript，路由只负责传输 | Core 声明事件联合；contracts 声明 Zod schema；API 负责发送前验证 |
| 协议统一定义并同步生成物 | 新增三个事件契约模块与浏览器安全的 `@techspar/contracts/events` 入口；重新生成 OpenAPI 和前端 schema |
| 前端共享逻辑使用 TypeScript | WS 解码、SSE 解析与业务事件分发使用共享契约；回调接收具体联合分支 |
| 测试覆盖真实边界 | Hono 请求验证 SSE；本地随机端口 Bun 服务验证真实 WebSocket；真实 service 配合确定性外部端口和 SQLite |
| 保持用户隔离和取消传播 | WS/SSE 传入当前用户及取消信号；断连关闭服务连接，测试持久化隔离、会话恢复和晚到的 ASR 清理 |
| 不提交个人数据 | fixture 均为合成内容，测试只使用临时数据库，不访问生产 provider |
| 完整验证 | 使用 Bun 1.3.14 执行生成、契约测试及完整 `bun run check` |

## 事件结构

### Copilot WebSocket

`CopilotServerEventSchema` 是按 `type` 区分的 13 分支联合，不存在任意事件名的兜底分支。

| 事件 | 字段 |
| --- | --- |
| started | session_id |
| stopped | 无额外字段 |
| progress / error | message |
| asr_interim | text |
| asr_final | text、可选 role（hr / candidate） |
| copilot_update | intent、tree_position、topic、confidence、recommended_points、children、prep_hint |
| risk_alert | message、node_id |
| answer_chunk | text |
| answer_meta | first_token_ms |
| answer_done | total_ms、chunk_count |
| hr_profile_update | 可选 style、focus、satisfaction_signals、advice，以及历史扩展 |
| monitor_update | 可选 phase、last_answer_feedback、covered_topics、uncovered_topics、strategy_tip，以及历史扩展 |

11 类程序构造事件及其稳定子对象拒绝未知字段。两个模型后台事件校验已知字段类型，保留缺失字段和未知扩展；例如缺失 covered_topics 合法，字符串形式的 covered_topics 不合法。第四阶段再在生产者入口处理模型完整性、语义约束、修复与重试。模型返回的 `type` 不再覆盖程序指定的事件名。

保持的兼容语义：

- confidence 来源于余弦匹配，可为负数，未匹配时可为 -1；有限数值合法，不改成 0～1。
- tree_position、node_id、prep_hint 可以为 null；推荐点和子节点允许空数组。
- 旧盘点样例的 asr_final 未带 role；继续允许缺失，前端默认按 HR 处理。当前真实 ASR 生产者始终发送角色。
- progress 是文字提示，不要求不存在于真实生产者的数值进度字段。旧 fixture 的 progress=0.5 已纠正。
- intent、模型 phase 保持字符串，不用提示词示例创建不兼容的枚举。
- 预热可能单独发送 answer_meta / answer_done，且 chunk_count 可以为 0；后台分析可以穿插在回答事件中。answer_done 不是 WS 连接的终止事件。
- fixture 的 events.json 是事件样例目录，不要求异步后台事件具有固定的全局顺序。测试比较真实事件完整 payload，只规范化经过类型检查的动态耗时。

客户端文本命令继续使用已有 CopilotClientMessageSchema；PCM 二进制帧保持独立通道，不当作 JSON 解析。

### Interview SSE

互斥的三类事件：

```ts
{ token: string }
{ done: true; is_finished: boolean }
{ error: string }
```

不允许空对象、done=false、缺失 is_finished、token 与 done 混合。空 token 保持合法。Core 流只产生 token/done；API 错误边界产生 error。真实 InterviewService 在状态和助手 transcript 持久化完成后发送 done；保存失败产生 error，避免 UI 提前收到成功完成。

### 索引重建 SSE

- 步骤：completed、total、label、status（running / done）。
- 步骤失败：相同进度字段，status=error，且必须有 error；后续步骤仍然继续。
- 整体完成：done=true、rebuilt（weak_points、personal_documents、topics）、last_rebuild_at。
- 整体失败：fatal=true、error。

last_rebuild_at 保留现有秒精度、不带时区的字符串。局部失败后仍可整体完成，rebuilt 只记录实际成功部分。

## 发送、异常与关闭边界

`apps/api/src/http/events.ts` 统一验证和序列化出站消息。WS 的业务事件、请求验证错误、命令执行错误都通过相同入口。序列化失败也转为脱敏契约错误。

- 非法主要 WS 事件不下发，尽可能发送合法的通用 error，然后以 1011 关闭连接。
- 非法后台分析事件不下发，记录脱敏诊断，主回答流继续。
- 清理只执行一次；emit 错误路径不等待当前命令链的 close，避免相互等待。
- 断连取消上下文，丢弃晚到的输出。Core close 先停止已创建的 ASR，解除握手等待，再等待命令链并执行最后一次 ASR 清理；启动依赖晚到时检查关闭状态，不再创建识别连接或启动模型预热。
- DashScope ASR 启动显式接收取消信号，WebSocket 握手默认最多等待 10 秒；stop 主动结束启动等待，不依赖 socket 发送 error。超时、取消和启动失败均关闭 socket、清理定时器与监听器；关闭等待保留 1 秒上限。超时仍按现有语义降级到手动输入。
- 未授权 WS 保留 1008；非法客户端命令保留 Invalid message。
- 音频帧处理异常及 ASR 回调触发的回答失败，同样经过 error 事件边界；部分回答失败仍保留 answer_done 耗时/片段统计。
- SSE 建立前保留 HTTP 鉴权和 422；建立后契约错误使用原有 error/fatal 事件及通用 Internal Server Error，不尝试改写成 HTTP 500。
- SSE 临时保留终止事件，完整耗尽生产者后再发送，确保终止后的必要持久化执行。缺失终止事件或终止后还有事件，均按契约错误处理。
- reader 取消通过 AbortSignal 传给业务层/provider，发送器停止继续写出。

契约日志只包含 operation 模板、requestId、issue code 与脱敏字段路径，复用第二阶段的 ResponseContractError。不会记录原始响应、Zod 详细消息、未知字段列表、会话 ID 或模型正文。

## 前端与 OpenAPI

前端从 `@techspar/contracts/events` 共享运行时 schema 和推导类型。WS 先解析校验，再更新字幕或分发事件；错误数据不会进入 UI 业务回调，且不再打印整个 WS payload。

SSE 解析器支持跨字节块 UTF-8、LF/CRLF/CR、注释、多行 data 和同一网络块中的多个事件；JSON 解析、schema 校验和消费者回调错误不会被吞掉。完成/失败提前退出时取消 reader 并释放锁，断流缺少终止事件和截断帧会显式报告错误。Index 步骤错误不触发整体 onError。

SSE HTTP 响应仍描述为流字符串，`x-event-schema` 指向具体的具名事件 component。WS 只注册事件 component，不伪造 OpenAPI HTTP 操作。独立事件组件使用 Zod 原生 JSON Schema 2020-12 转换，避免 Hono 扩展初始化顺序影响；前端 schema 由 `bun run gen:api` 生成。

## 验证

新增验证分布于：

- phase-three-events.test.ts：所有分支、必需字段、非法类型、嵌套字段、负 confidence、兼容扩展及 core/wire 类型一致性。
- phase-three-sse.test.ts：真实 HTTP 输出拦截、错误分支、终止事件、取消、真实 Interview 持久化与真实索引局部失败。
- apps/api/src/copilot-websocket.test.ts：真实 WS 收发、鉴权、PCM、错误映射、脱敏、断开、真实 ASR 回调/后台模型事件、SQLite 会话恢复和用户隔离。
- phase-three-frontend.test.ts：共享解码、分块读取、终止分发、截断/格式/业务回调/网络错误及 reader 清理。
- phase-three-openapi.test.ts：事件组件、兼容范围、SSE 文档关联、生成物一致性和重复生成稳定性。
- copilot.test.ts：未匹配、部分回答失败、零片段预热、必须由 stop 解除的 ASR 启动等待、依赖晚到时不创建 ASR。
- realtime-asr.test.ts：真实 DashScope 适配器配合可控 WebSocket，覆盖取消、超时、仅 close 无 error、关闭不发事件或抛错、启动发送失败、正常音频流及晚到回调。真实 Bun WS 测试另验证断连清理和超时后的手动输入、持久化。

Bun 1.3.14 存在可独立复现的测试清理现象：服务端主动 close 后，即使客户端已收到关闭事件，pendingWebSockets 计数和 stop() Promise 仍可能不归零/不结束。因此测试清理等待每个客户端真实关闭，调用 stop(true)，并断言原监听地址连接失败；不跳过关闭状态、关闭码或资源清理断言。

```sh
bun --version # 1.3.14
bun install --frozen-lockfile
bun run gen:api
bun run test:contracts
bun test tests-ts/copilot.test.ts tests-ts/interview.test.ts tests-ts/settings-provider.test.ts
bun run check
```

`test:contracts` 已包含真实 WS 测试。再次执行 gen:api 应不改变 OpenAPI 和前端 schema。完整 check 包含 Bun/Node 类型检查、架构边界、所有后端测试、前端类型/Lint/测试、API/Web/Electron 构建和桌面目录打包。

### 本次验证结果（2026-10-01）

| 检查 | 结果 |
| --- | --- |
| Bun 1.3.14 frozen-lockfile 安装 | 通过 |
| 独立契约测试 | 95 通过，0 失败，包含真实 WS |
| Copilot / Interview / Settings 定向测试 | 30 通过，0 失败 |
| 最终完整 bun run check | 更新到包含 PR #77 的最新主线后复验，退出码 0；后端 250 通过，0 失败；前端 7 通过，0 失败 |
| 类型、架构、Lint | Bun/Node/前端类型检查及边界检查通过；Lint 0 错误、41 条存量警告 |
| 构建与打包 | API、Web、Electron main/preload、darwin-arm64 sidecar 与应用目录包全部通过 |
| 最终打包产物启动 | 在独立临时 userData 目录运行 --smoke-test，返回 techspar:desktop-smoke-ok、packaged=true，退出码 0 |
| 生成物稳定性 | 再次 gen:api 前后两份文件 SHA256 一致 |
| 补丁格式 | git diff --check 通过；SSE fixture 末尾空行是协议分隔符，使用限定到 SSE fixture 的 Git whitespace 属性保留 |

第一次完整检查的打包步骤等待 GitHub 下载校验文件；给验证进程显式配置当前 macOS 系统代理后，完整检查成功，最终代码再次全量复验成功。没有关闭下载校验或修改仓库打包配置。macOS 目录包沿用现有无签名证书环境，未执行发行签名；本次验证不包含 Windows 安装器或真实商业 LLM/ASR 账号调用。

### ASR 生命周期审查修复验证（2026-10-02）

原先 close 先等命令链，ASR 握手不返回时无法执行 stop。先将回归测试改成只有 stop 才能解除启动等待，确认旧代码因清理不能完成而失败，再修复关闭顺序及适配器取消、超时和监听器清理。测试不会主动放行停滞握手；仅测试失败的 finally 会解除测试替身以释放资源。

- Copilot、真实 WebSocket 与 DashScope 适配器定向测试：26 通过，0 失败。
- 完整 `bun run check`：退出码 0；后端 264 通过，0 失败；前端 7 通过，0 失败。Bun/Node/前端类型检查、架构边界、API/Web/Electron 构建与 darwin-arm64 目录打包全部通过；ESLint 0 错误、41 条存量警告。
- 再次 `bun run gen:api` 后两份生成物无差异，`git diff --check` 通过。
- 最终打包应用在独立临时 userData 下运行 `--smoke-test`：退出码 0，返回 `techspar:desktop-smoke-ok`、`packaged=true`。

ASR 测试使用真实 DashScope 适配器和可控 WebSocket，覆盖仅 close 不发 error、完全不发关闭事件、关闭抛错、取消前后竞态和超时后的手动输入；没有请求外部 ASR 服务。
