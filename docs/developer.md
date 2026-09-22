# 开发者说明

本文只描述 `main` 的当前实现。迁移前的 FastAPI/Python 代码已冻结在 `legacy/python-backend`，不要把两个分支连接到同一份可写数据。

## 技术栈

- **工作区与运行时**：Bun `1.3.14` workspace
- **API**：Hono 4、Zod、OpenAPI 3.1、REST/SSE/WebSocket
- **桌面端**：Electron 43、electron-builder、编译后的 Bun sidecar
- **Web**：React 19、React Router 7、Vite 8、Tailwind CSS 4
- **存储**：SQLite、原子 JSON/文件存储、可重建的向量索引
- **模型与服务**：OpenAI-compatible、Transformers.js/ONNX、DashScope、Tavily、阿里云 OSS、腾讯云 VPR

## 目录与依赖方向

```text
apps/api/             Hono 应用工厂、REST/SSE/WS 路由、Bun 组合入口
apps/desktop/         Electron 主进程、Preload、sidecar 监督、打包配置
packages/contracts/   Zod/OpenAPI 与外部传输协议
packages/core/        用例、状态机、领域类型和由使用方拥有的端口
packages/db/          SQLite repository 实现
packages/platform/    配置、认证、文件、归档等平台适配器
packages/providers/   LLM、Embedding、ASR、OSS、搜索和声纹适配器
packages/testing/     测试替身与共享 fixtures
frontend/             React Web/桌面 Renderer
tests-ts/             跨模块回归与旧版 OpenAPI 基线
```

依赖只能向内：`apps -> adapters -> core/contracts`。`packages/core` 不能导入 Hono、Bun、Electron、数据库驱动或供应商 SDK；`apps/api/src/app.ts` 也不能直接绑定 Bun。`bun run check:boundaries` 会检查这些规则。

## 本地开发

首次安装：

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Web 模式使用两个终端：

```bash
bun run dev:api
bun run dev:web
```

Electron 模式由一个命令编排 Vite、Hono 和 Electron：

```bash
bun run dev:desktop
```

## 修改 API 契约

请求/响应 schema 和路由定义变更后，重新生成 OpenAPI 与前端类型：

```bash
bun run gen:api
git diff -- packages/contracts/openapi.json frontend/src/api/schema.d.ts
```

旧版 FastAPI 基线保存在 `tests-ts/contracts/fastapi-openapi.json`。现有兼容路由不能无意删除或改方法；有意的破坏性变更应单独说明并更新契约测试。

### API 响应契约盘点

在正式收紧响应 schema 之前，先维护 `tests-ts/contracts/response-inventory.ts`，并在 `tests-ts/contracts/fixtures/` 保存脱敏的响应和事件样例。HTTP 边界测试必须通过 Hono `app.request()` 验证状态码、Content-Type、错误格式和当前字段形状；不要只调用 Core 内部用例。新增或修改 API 时，先更新 inventory、fixture 和边界测试，再在后续改动中更新 `packages/contracts` 的正式 Zod schema。

## 测试与构建

提交前的默认门槛：

```bash
bun run check
```

它包含 Bun/Node 类型检查、架构边界、后端与前端测试、前端 TypeScript/ESLint、API/Web/Electron/sidecar 构建，以及当前平台的 Electron 应用目录打包。桌面端还可按改动范围运行：

```bash
bun run smoke:desktop
bun run smoke:local-embedding
bun run pack:desktop
```

`smoke:local-embedding` 会下载一个公开的小型 ONNX 模型，验证编译后的 sidecar 确实能执行本地向量计算。`pack:desktop` 生成当前平台的未安装应用目录，不执行代码签名。

## 开发约束

- 路由只做鉴权、校验、上下文组装和传输映射；业务规则下沉到 `packages/core`。
- 用户 ID、取消信号和 provider 配置显式传递，禁止“当前用户”全局变量。
- SQLite/文件写入保持用户隔离；JSON 使用临时文件加原子替换。
- 长任务状态必须持久化，并能在重启后恢复或明确失败。
- 本地 Embedding 只能使用 Transformers.js/ONNX；不要重新引入 Python、PyTorch 或外部 Python sidecar。
- Electron Renderer 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；新增 IPC 必须校验来源并保持最小能力。
- 改功能时同步更新 README、部署说明、设置说明和相应测试。

## 反馈方式

欢迎提交 Issue 和 PR。问题报告请包含运行方式、平台、复现步骤、期望/实际结果和已脱敏日志。
