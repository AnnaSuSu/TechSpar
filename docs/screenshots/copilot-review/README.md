# Copilot 实战复盘界面验收

这些截图来自本地前端，使用合成面试内容与模拟 API 响应，没有真实简历、录音、画像或凭证。

- `session-history.png`：准备详情页的实战记录、复盘入口和数据副本提示。
- `conversation.png`：带说话人与时间的完整对话弹窗。
- `review.png`：Copilot 实战复盘标题、逐题回答与评分。

浏览器交互检查覆盖列表加载、打开与关闭对话、手动提交复盘、删除确认中的副本提示、1024px 宽度布局、复盘页隐藏「再次练习」、历史页请求 `mode=copilot`，无页面运行错误。

本次在 macOS arm64、Bun 1.3.14 下验证：

- `bun install --frozen-lockfile`。
- `bun run gen:api`，重复生成后 OpenAPI 与前端类型的 SHA-256 保持一致。
- `bun run check`：581 项后端测试；22 项 Node 前端测试和 42 项 Bun 前端测试；类型、架构、lint、Web/API、Electron 与 sidecar 构建及桌面打包通过。lint 保留上游既有的 41 条警告。
- `bun run test:contracts`：203 项通过（与全量测试有重叠）。
- `bun run smoke:desktop`：Electron 43.4.1 与本地 API 启动链路通过。

后端使用真实临时 SQLite 与真实本地 WebSocket 验证权限、停止保存、幂等、失败回滚、崩溃恢复、复盘重试、旧/新归档导入和画像更新；模型输出使用测试替身。未验证真实麦克风/系统音频采集与线上模型的质量、费用或延迟。
