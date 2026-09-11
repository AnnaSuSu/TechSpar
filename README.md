<div align="center">

<img src="images/techspar-horizontal-logo.svg" alt="TechSpar" width="520" />

**把专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘，串成一个持续进化的技术面试闭环。**

[在线体验](https://techspar.cn/) · [下载桌面端](https://github.com/AnnaSuSu/TechSpar/releases) · [快速开始](#快速开始) · [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/AnnaSuSu/TechSpar?color=6E56CF)](https://github.com/AnnaSuSu/TechSpar/releases)
[![License](https://img.shields.io/badge/License-AGPL--3.0-6E56CF.svg)](LICENSE)
[![Self-host](https://img.shields.io/badge/自托管-永久免费-2EA043.svg)](#快速开始)
[![Status](https://img.shields.io/badge/状态-持续开发中-2EA043.svg)](https://github.com/AnnaSuSu/TechSpar/commits/main)

![TechSpar 产品总览](images/techspar-overview.png)

</div>

## 这是什么

市面上的面试工具大多做同一件事：给你生成一堆题，你答完，结束。没有人记得你上次哪道题答崩了，也没有人知道你下周要面的那家公司想听什么。

TechSpar 想做的是另一件事——**让每一次练习都算数**。专项训练、简历面试、JD 备面、实时 Copilot、录音复盘共用同一套长期画像、知识库、薄弱点和复习调度；每轮结果写回系统，决定下一轮练什么。

适合正在准备技术面试、并且愿意用工具持续记录自己进步的人。

## 功能闭环

- **专项强化训练**：结合题库、知识库、历史薄弱点和掌握度动态出题。
- **简历模拟面试**：读取简历并按自我介绍、技术问题、项目深挖、反问环节推进。
- **JD 定向备面**：拆解岗位描述，结合简历与历史画像生成岗位相关策略和问题。
- **实时 Copilot**：实时 ASR、追问方向预测、回答建议、风险提示，以及可选声纹角色识别。
- **录音复盘**：转写长短录音，结构化 Q&A，输出逐题分析与改进建议。
- **长期画像**：汇总强项、薄弱点、训练轨迹，并通过 SM-2 安排复习。
- **个人资料库**：导入 PDF、DOCX、Markdown 和文本，为训练与个人 Agent 提供上下文。
- **数据迁移**：导出/导入单账户或管理员全站归档；个人敏感凭证默认不导出。

想看实际效果，直接去 [在线体验](https://techspar.cn/)，比截图直观。

## 为什么它是开源的，又为什么有个收费的托管版

这东西是我自己找工作的时候想要、但没找到的，所以把它写了出来，完整开源。

完整开源的意思是：没有企业版，没有高级版，功能不会被锁在付费墙后面。你带上自己的 API key，Docker 起来，所有能力都在，这条路永远免费。

但真正需要它的人大多不是工程师，不会部署，也搞不到 key。所以我另外跑了一个托管版：不用装、不用配 key，可以在[爱发电](https://ifdian.net/a/techspar)赞助获取额度，档位和权益在那边写着。

由于此前多次遭遇注册机盗刷，托管版已取消免费额度。抱歉给大家带来不便，也感谢大家理解。

钱都花在模型推理和服务器上。我没指望靠它赚钱，但一个人做这件事，它能不能继续更新下去，说到底取决于能不能养活自己。如果它帮到了你，去[爱发电](https://ifdian.net/a/techspar)赞助一点，对我意义很大。

托管版和你自己部署的，功能完全一样，区别只有额度和要不要自己准备 key。这点你不用信我——配额和订阅的代码就在 `apps/api/src/cloud/`，自己看。

## 快速开始

### 环境要求

- Bun `1.3.14` 或兼容的 `1.3.x`
- macOS、Linux 或 Windows

已经构建好的桌面客户端自带 Electron 和编译后的 Bun 后端，最终用户不需要另外安装 Bun。

源码开发或本机构建先执行：

```bash
git clone https://github.com/AnnaSuSu/TechSpar.git
cd TechSpar
bun install --frozen-lockfile
cp .env.example .env
```

### Electron 桌面客户端

已发布版本可从 [GitHub Releases](https://github.com/AnnaSuSu/TechSpar/releases) 下载 macOS 与 Windows 安装包。

开发模式会同时启动 Vite、Hono 和 Electron：

```bash
bun run dev:desktop
```

构建当前平台的可运行应用目录：

```bash
bun run pack:desktop
```

构建当前平台的安装包/归档文件：

```bash
bun run dist:desktop
```

构建正式发布目标：

```bash
bun run dist:desktop:mac-arm64 # macOS Apple Silicon：DMG + ZIP
bun run dist:desktop:win-x64   # Windows x64：NSIS 安装包
```

产物位于 `dist/desktop/`。当前仓库配置了 macOS DMG/ZIP、Windows NSIS、Linux AppImage/DEB；v0.3.1 提供 macOS arm64 与 Windows x64 包。当前公开包未配置商业代码签名，安装时可能触发系统安全提示；真实安装与启动仍应在对应目标平台验收。

发布新版本时先同步根 `package.json` 与桌面包版本，再推送同名 `vX.Y.Z` tag。发布工作流会分别构建 macOS arm64 和 Windows x64 客户端、校验 tag、生成 SHA-256 校验文件并上传到 [GitHub Releases](https://github.com/AnnaSuSu/TechSpar/releases)；签名和 macOS 公证会在仓库配置对应 secrets 后自动启用。

### Web 本地开发

终端一启动 API：

```bash
bun run dev:api
```

终端二启动 Web：

```bash
bun run dev:web
```

访问 <http://localhost:5173>。服务端开发环境的默认登录信息：

```text
admin@techspar.local
admin123
```

服务端首次登录后请立即在设置页修改默认密码，部署时也必须在 `.env` 中修改 `JWT_SECRET`。Electron 桌面版会生成随机的本机凭证并自动进入，不使用上述固定密码。

### Docker

```bash
docker compose up --build
```

启动后访问 <http://localhost>。

## 模型与服务配置

LLM、Embedding、DashScope、Tavily、OSS 与腾讯云 VPR 密钥默认按用户隔离保存在本地数据目录，登录后在“设置”中填写；`.env` 只放启动配置和可选的平台兜底模型。

- **LLM**：任意 OpenAI-compatible API。
- **Embedding API**：任意 OpenAI-compatible embeddings 接口；完整的 `/v1/embeddings` 地址会自动归一化。
- **本地 Embedding**：使用 Transformers.js + ONNX，默认 `Xenova/bge-m3`；首次运行自动下载并缓存，不需要 Python、PyTorch 或 pip。
- **DashScope**：语音输入、录音转写和 Copilot 实时 ASR。
- **Tavily**：Copilot 公司信息搜索。
- **阿里云 OSS**：长录音异步转写的临时对象存储。
- **腾讯云 VPR**：可选的 HR/候选人声纹区分。

## 技术架构

[![Bun](https://img.shields.io/badge/Bun-1.3+-000000.svg)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002.svg)](https://hono.dev/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

| 层 | 技术 |
| --- | --- |
| API Host | Bun 1.3、Hono 4、`@hono/zod-openapi` |
| Desktop | Electron 43、沙箱 Renderer、受限 Preload、编译后的 Bun sidecar |
| Core | 纯 TypeScript 用例、状态机和端口 |
| Storage | SQLite、原子 JSON/文件存储 |
| Providers | OpenAI-compatible、Transformers.js、DashScope、OSS、Tavily、腾讯云 VPR |
| Web | React 19、React Router 7、Vite 8、Tailwind CSS 4 |
| Contracts | Zod、OpenAPI 3.1、生成的前端类型 |
| Test | Bun Test、OpenAPI 契约对照、Node 兼容性检查 |

项目采用模块化单体和六边形边界：Hono 只负责 HTTP/SSE/WebSocket 映射，业务规则在 `packages/core`，数据库、文件和供应商实现位于外层适配器。详见 [TypeScript 后端架构](docs/typescript-backend-architecture.md)。

```text
apps/api/             Bun + Hono 组合入口与路由
apps/desktop/         Electron 主进程、Preload、sidecar 监督与打包配置
packages/contracts/   OpenAPI 与传输协议
packages/core/        业务用例、状态机、端口
packages/db/          SQLite repositories
packages/platform/    文件、认证、配置与归档适配器
packages/providers/   LLM、Embedding、ASR、OSS、搜索与声纹适配器
frontend/             React Web 客户端
tests-ts/             TypeScript 测试与旧版 OpenAPI 基线
```

托管版用到的配额与订阅模块是一个可选扩展，通过 `.env` 里的 `TECHSPAR_EXTENSIONS` 加载；不配置它就是一份干净的开源安装，不会有任何付费相关的接口存在。

## 质量检查

```bash
bun run check
```

该命令依次执行 Bun/Node 类型检查、架构边界检查、后端与前端测试、前端 TypeScript/ESLint，以及 API、Web、Electron 主进程和编译 sidecar 构建。OpenAPI 文件和前端类型可通过以下命令重新生成：

```bash
bun run gen:api
```

桌面端还有三条独立验收命令：

```bash
bun run smoke:desktop          # Electron + Hono 启动链路
bun run smoke:local-embedding  # 编译后端执行真实 ONNX 本地向量
bun run pack:desktop           # 当前平台完整应用目录
```

## 数据与备份

默认数据位于 `data/`：SQLite 保存会话和任务状态，用户文件位于 `data/users/{user_id}/`。在“设置 → 数据迁移”中可以：

- 导出当前账户的可移植备份；敏感凭证需要显式选择才会包含；
- 将个人备份导入另一个账户，数据会安全重绑定到当前用户；
- 管理员导出完整系统备份。

归档会验证路径、链接、tar 校验和与解压上限；向量索引作为派生数据在导入后重建。

管理员系统归档的恢复是离线运维操作。先把归档放在目标 `data/` 之外并执行只读预检：

```bash
bun run restore:system -- --archive=/safe/backups/techspar-system.tar.gz --data-dir=/srv/techspar/data
```

预检通过后停止 TechSpar API、桌面 sidecar 和其他所有可能写入该目录的进程，再显式确认恢复：

```bash
bun run restore:system -- --archive=/safe/backups/techspar-system.tar.gz --data-dir=/srv/techspar/data --confirm
```

恢复会先构建并校验暂存数据，再原子切换目录；原 `data/` 会保留为同级、带时间戳的 `data.before-system-restore-*` 备份目录，不会直接删除。

Electron 使用系统标准的应用数据目录，数据库、用户文件、模型缓存和每次安装随机生成的运行密钥都放在那里；本地 Hono sidecar 只监听 `127.0.0.1` 的动态端口。

## 支持与更新节奏

这是一个人在维护的项目，所以把话说在前面：

- **Bug 会修**，[Issue](https://github.com/AnnaSuSu/TechSpar/issues) 和 PR 我都会看。
- **功能按我自己的路线走**，不接定制需求；有想法欢迎开 Issue 讨论，但不承诺排期。
- **更新节奏取决于我有多少时间**，不保证频率。

## 参与贡献

欢迎提交 [Issue](https://github.com/AnnaSuSu/TechSpar/issues) 或 PR。开发约定和流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 旧版本

`legacy/python-backend` 是迁移前最后一个 Python + FastAPI 版本，固定在提交 `73d1a7c`，只作为历史归档，不再接收新功能。查看方式见 [旧版本分支说明](docs/legacy-python-backend.md)。

## License

[AGPL-3.0](LICENSE)。你可以自由使用、修改、自托管；如果你把修改后的版本作为网络服务提供给他人，需要同样开源你的改动。

**TechSpar 这个名称和 logo 不随代码授权**，请不要用它们命名你的分发版本。

例外：`frontend/src/resume/` 的简历编辑与模板代码移植自 [Magic Resume](https://github.com/JOYCEQL/magic-resume)，保留该目录内的原始协议与附加条款。

## 致谢

感谢 [LINUX DO](https://linux.do/) 社区，以及 Magic Resume 原作者 [@JOYCEQL](https://github.com/JOYCEQL)。
