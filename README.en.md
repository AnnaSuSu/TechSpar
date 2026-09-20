<div align="center">

<img src="images/techspar-horizontal-logo.svg" alt="TechSpar" width="520" />

**Connect focused drills, resume interviews, JD prep, realtime Copilot, and recording review into one continuously improving technical interview loop.**

[Online Demo](https://techspar.cn/) · [Quick Start](#quick-start) · [中文](README.md)

[![Bun](https://img.shields.io/badge/Bun-1.3+-000000.svg)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002.svg)](https://hono.dev/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)

![TechSpar product overview](images/techspar-overview.png)
</div>

TechSpar is more than a question generator. Focused drills, resume interviews, JD prep, realtime Copilot, and recording review share the same long-term profile, knowledge base, weak points, and review schedule. Every result changes what the next round focuses on.

## Versions and branches

- **`main`** is the current product. The backend is fully TypeScript, Bun, and Hono, with one Bun workspace for backend and frontend dependencies. All new work continues here.
- **`legacy/python-backend`** preserves the final Python and FastAPI implementation at commit `73d1a7c`. It is a read-only historical fallback and receives no new features.

Never run both branches against the same writable data directory. Use a separate checkout and a copied dataset when inspecting the legacy implementation.

## Capabilities

- Adaptive focused drills backed by knowledge, mastery, and training history
- Resume mock interviews with a durable TypeScript state machine
- JD-specific preparation and questioning strategies
- Realtime Copilot with ASR, follow-up prediction, answer guidance, alerts, and optional voiceprint roles
- Long and short recording transcription with structured review
- Long-term profile, weak-point tracking, and SM-2 review scheduling
- Personal document library and personal Agent context
- Safe per-account and administrator data migration archives

## Quick start

Requirements: Bun `1.3.14` or a compatible `1.3.x` release.

```bash
git clone https://github.com/AnnaSuSu/TechSpar.git
cd TechSpar
bun install --frozen-lockfile
cp .env.example .env
```

### Electron desktop client

Download macOS and Windows installers from [GitHub Releases](https://github.com/AnnaSuSu/TechSpar/releases) and sign in online to use them. The commands below build a desktop application with a local backend from source.

Run Vite, Hono, and Electron together in development:

```bash
bun run dev:desktop
```

Build an unpacked application or distributable artifacts for the current platform:

```bash
bun run pack:desktop
bun run dist:desktop
```

Build for a specific target platform:

```bash
bun run dist:desktop:mac-arm64 # macOS Apple Silicon: DMG + ZIP
bun run dist:desktop:win-x64   # Windows x64: NSIS installer
```

Artifacts are written to `dist/desktop/`. Applications built from source include Electron and a compiled Bun backend, so end users do not need Bun. The repository configures macOS DMG/ZIP, Windows NSIS, and Linux AppImage/DEB targets.

### Web development

Start the API and Web app in separate terminals:

```bash
bun run dev:api
bun run dev:web
```

Open <http://localhost:5173>. The development login is `admin@techspar.local` / `admin123`. Change `JWT_SECRET` and the default password before deployment.

Docker is also supported:

```bash
docker compose up --build
```

Then open <http://localhost>.

## Models and optional services

When self-hosting or building the desktop application from source, configure LLM, embedding, DashScope, Tavily, OSS, and Tencent VPR credentials in Settings. Credentials are user-scoped. `.env` only contains bootstrap settings and optional platform fallback models.

- Any OpenAI-compatible chat and embeddings API is supported.
- Local embeddings use Transformers.js and ONNX. The default is `Xenova/bge-m3`; it downloads and caches on first use with no Python, PyTorch, or pip dependency.
- DashScope powers voice input, recording transcription, and Copilot realtime ASR.
- Tavily adds company research, OSS supports long-audio jobs, and Tencent VPR optionally distinguishes interviewer and candidate voices.

## Architecture

| Layer | Technology |
| --- | --- |
| API host | Bun 1.3, Hono 4, `@hono/zod-openapi` |
| Desktop | Electron 43, sandboxed renderer, constrained preload, compiled Bun sidecar |
| Core | Pure TypeScript use cases, state machines, and owned ports |
| Storage | SQLite and atomic JSON/file storage |
| Providers | OpenAI-compatible APIs, Transformers.js, DashScope, OSS, Tavily, Tencent VPR |
| Web | React 19, React Router 7, Vite 8, Tailwind CSS 4 |
| Contracts | Zod, OpenAPI 3.1, generated frontend types |
| Validation | Bun Test, OpenAPI parity, Node compatibility, boundary checks |

TechSpar is a modular monolith with hexagonal boundaries. Hono maps HTTP, SSE, and WebSocket transports; business rules live in `packages/core`; storage, files, and providers stay in outer adapters. See [TypeScript backend architecture](docs/typescript-backend-architecture.md).

```text
apps/api/             Bun + Hono composition root and routes
apps/desktop/         Electron main/preload, sidecar supervision, packaging
packages/contracts/   OpenAPI and transport protocols
packages/core/        Use cases, state machines, and ports
packages/db/          SQLite repositories
packages/platform/    Files, auth, configuration, and archives
packages/providers/   LLM, embedding, ASR, OSS, search, and voiceprint adapters
frontend/             React Web client
tests-ts/             TypeScript tests and the legacy OpenAPI baseline
```

## Validation

```bash
bun run check
bun run gen:api
```

The first command runs Bun and Node type checks, architecture checks, backend and frontend tests, and production builds. The second regenerates OpenAPI and frontend types.

Desktop-specific validation is available through `bun run smoke:desktop`, `bun run smoke:local-embedding`, and `bun run pack:desktop`.

## Data and backups

Data defaults to `data/`: SQLite stores sessions and tasks, while user files live under `data/users/{user_id}/`. The Settings page exports portable personal backups and administrator system backups. Imports validate paths, links, tar checksums, and expanded size, then safely rebind personal data to the current account. Vector indexes are rebuilt after import.

Electron uses the operating system's standard application-data directory for databases, user files, model caches, and per-install random runtime secrets. Its Hono sidecar listens only on a dynamic `127.0.0.1` port.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions.

## License

CC BY-NC 4.0.

The resume editor and templates under `frontend/src/resume/` are adapted from [Magic Resume](https://github.com/JOYCEQL/magic-resume) and retain the licenses and additional terms stored in that directory.
