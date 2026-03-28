<div align="center">

<img src="images/logo.png" alt="TechSpar" width="320" />

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Powered-1C3C3C.svg)](https://www.langchain.com/langgraph)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# TechSpar

**一个会持续记住你弱点和进步轨迹的 AI 面试训练系统。**

不是一次性问答工具，也不是随机刷题器。  
TechSpar 会在每轮训练后更新你的长期画像：薄弱点、强项、掌握度、思维模式、沟通风格。下一次训练时，AI 会基于这些历史信息继续追着你的短板问。

[在线 Demo](https://aari.top/) · [快速开始](#快速开始) · [English](README.en.md)

</div>

---

## 为什么不是另一个 AI 面试工具

大多数面试产品有一个根本问题：**无状态**。

你今天答得差，系统知道。  
但你明天再来，它又像第一次见你一样重新开始。

TechSpar 的目标不是“再生成一组题”，而是构建一个**持续演化的候选人训练闭环**：

| 传统面试工具 | TechSpar |
| --- | --- |
| 每次练习从零开始 | 持久化用户画像，长期跟踪成长 |
| 固定题库或随机出题 | 结合画像、掌握度、知识库动态出题 |
| 反馈停留在一句点评 | 逐题评分、薄弱点提取、改进建议 |
| 很难判断自己到底进步没 | 掌握度量化、趋势追踪、复习调度 |
| 练完就结束 | 训练 -> 评估 -> 画像更新 -> 下轮更精准 |

> **TechSpar 不是帮你“刷一轮题”，而是帮你建立一套会越练越准的面试训练系统。**

---

## 在线体验

直接体验：**[https://aari.top/](https://aari.top/)**

| Email | Password |
| --- | --- |
| admin@techspar.local | admin123 |

> 演示环境请不要上传真实简历、真实录音或任何敏感个人信息。

---

## 核心机制

### 1. 个性化出题引擎

![TechSpar personalized question generation engine](images/question-generation-engine.png)

TechSpar 不从固定题库随机抽题，而是融合三层信息后生成下一轮问题：

- **Session Context**：简历、JD、知识库、最近训练记录
- **Topic Mastery**：领域掌握度、历史薄弱点、练习轨迹
- **Global Profile**：跨领域强项、弱项、思维模式、沟通风格

结果是：问题更少重复，更贴近真实短板，也更有连续性。

### 2. 训练闭环

![TechSpar training evaluation profile update loop](images/training-loop.png)

每次训练结束后，系统不会只给一句点评，而是继续向后推进：

- 逐题评估回答质量
- 提取薄弱点、强项和行为特征
- 更新领域掌握度与长期画像
- 用 **SM-2** 调度后续复习
- 把这次结果带入下一轮训练

这意味着：**每次训练都会改变下一次训练。**

### 3. 系统架构

![TechSpar system architecture overview](images/system-architecture.png)

TechSpar 不是单页 Demo，而是完整系统：

- 前端：React 19 + React Router v7 + Vite
- 后端：FastAPI + LangGraph 工作流
- 数据层：SQLite、用户隔离目录、长期画像、向量检索
- 外部服务：OpenAI 兼容 LLM、Embedding、DashScope ASR、Qiniu OSS

---

## 核心场景

### 专项强化训练

选择某个领域集中训练，系统根据画像和掌握度动态调整难度，优先命中历史薄弱点。

### 简历模拟面试

AI 读取你的简历，通过 LangGraph 状态机驱动完整流程：自我介绍 -> 技术问题 -> 项目深挖 -> 反问环节。

### JD 定向备面

输入岗位描述后，系统会抽取 JD 重点，围绕岗位要求、简历经历和知识库内容生成更贴近真实岗位的问题。

### 录音复盘

上传面试录音或粘贴面试文本，系统自动转写、结构化 Q&A，并输出逐题分析与改进建议。

---

## 每轮训练后你会得到什么

- **逐题评分**：不是只看整体感觉，而是逐题拆开评估
- **薄弱点提取**：明确知道自己卡在哪，而不是笼统地“回答一般”
- **掌握度变化**：跟踪某个领域到底是在进步还是原地打转
- **长期画像更新**：系统会记住你的习惯性问题，而不是下一次重新开始
- **复习优先级**：会根据遗忘风险安排后续训练重点

---

## 界面预览

### 首页与训练总览

| Landing | Dashboard |
| --- | --- |
| ![Landing page](images/landing.png) | ![Dashboard](images/home.png) |

首页解释训练逻辑，Dashboard 展示训练入口、近期进度和学习概览。

### 个人画像

| 画像总览 | 薄弱点与强项 | 沟通风格分析 |
| --- | --- | --- |
| ![Profile overview](images/profile-overview.png) | ![Profile insights](images/profile-insights.png) | ![Communication style analysis](images/profile-communication.png) |

画像页集中展示掌握度、薄弱点、强项、思维模式与表达习惯。

### 知识库与题目图谱

| 核心知识库 | 题目图谱 |
| --- | --- |
| ![Knowledge library](images/knowledge-library.png) | ![Question graph](images/question-graph.png) |

知识库负责维护训练依据，图谱页帮助你从全局观察题目分布与掌握情况。

### JD 定向备面与录音复盘

| JD-focused interview prep | Recording review |
| --- | --- |
| ![Job prep](images/job-prep.png) | ![Recording review](images/recording-review.png) |

除了刷题，还可以围绕岗位描述定向训练，或对真实面试录音做结构化复盘。

---

## 适合谁

- 正在准备后端、算法、AI 应用、Agent、RAG 等技术岗位面试的人
- 已经刷了很多题，但训练缺乏连续性和复盘闭环的人
- 想围绕简历项目和 JD 做更接近真实面试练习的人
- 想长期跟踪自己能力变化，而不是做一次性问答的人

---

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

最小必填配置是 **LLM + Embedding**。Embedding 不是可选项，必须二选一：

- `EMBEDDING_BACKEND=api`：默认方案，直接走兼容 OpenAI 的 embedding API
- `EMBEDDING_BACKEND=local`：本地模型方案，需要额外安装依赖

默认推荐 `api`，配置示例：

```env
API_BASE=https://your-llm-api-base/v1
API_KEY=sk-your-api-key
MODEL=your-model-name
EMBEDDING_BACKEND=api
EMBEDDING_API_BASE=https://your-embedding-api-base/v1
EMBEDDING_API_KEY=sk-your-embedding-key
EMBEDDING_API_MODEL=BAAI/bge-m3
```

如果你使用官方 OpenAI embedding 接口，`EMBEDDING_API_BASE` 可以留空。

认证默认值如下，不配置也能启动：

```env
JWT_SECRET=change-me-in-production
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
DEFAULT_NAME=Admin
ALLOW_REGISTRATION=false
```

如果你要改成本地 embedding，继续补全 `.env.example` 里的 `LOCAL_EMBEDDING_*`。

如果你要启用录音转写，还需要继续补全这些可选项：

```env
DASHSCOPE_API_KEY=
QINIU_ACCESS_KEY=
QINIU_SECRET_KEY=
QINIU_BUCKET=
QINIU_DOMAIN=
```

`.env.example` 已经补齐了完整示例，可直接按需删改。

### 2. Docker 启动

```bash
docker compose up --build
```

启动后访问：

```text
http://localhost
```

### 3. 手动启动

后端：

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

如果你要使用本地 embedding，再额外安装：

```bash
pip install -r requirements.local-embedding.txt
```

前端：

```bash
cd frontend
npm install
npm run dev
```

访问：

```text
http://localhost:5173
```

### 4. 从旧版迁移

如果你是从无认证旧版升级：

```bash
python -m backend.migrate
```

---

## 可选能力

- **Embedding 后端切换（API / 本地）**
- **录音上传与转写分析**
- **七牛云 OSS 存储**
- **多用户数据隔离**
- **移动端响应式使用**

---

## 技术栈

| Component | Technology |
| --- | --- |
| Backend | FastAPI, LangChain, LangGraph, LlamaIndex |
| Frontend | React 19, React Router v7, Vite, Tailwind CSS v4 |
| Storage | SQLite, semantic embeddings |
| Auth | JWT, bcrypt |
| LLM | Any OpenAI-compatible API |

---

## 项目结构

```text
TechSpar/
├── backend/
│   ├── main.py
│   ├── auth.py
│   ├── memory.py
│   ├── vector_memory.py
│   ├── indexer.py
│   ├── spaced_repetition.py
│   ├── migrate.py
│   ├── graphs/
│   │   ├── resume_interview.py
│   │   └── topic_drill.py
│   ├── prompts/
│   └── storage/sessions.py
├── frontend/src/
│   ├── App.jsx
│   ├── contexts/AuthContext.jsx
│   ├── components/
│   ├── pages/
│   └── api/interview.js
├── data/users/{user_id}/
│   ├── profile/profile.json
│   ├── resume/
│   ├── knowledge/
│   └── topics.json
├── docker-compose.yml
├── requirements.txt
├── requirements.local-embedding.txt
└── .env.example
```

---

## License

MIT

---

<div align="center">

**If you find this project useful, please give it a star.**

[![Star History Chart](https://api.star-history.com/svg?repos=AnnaSuSu/TechSpar&type=Date)](https://star-history.com/#AnnaSuSu/TechSpar&Date)

</div>
