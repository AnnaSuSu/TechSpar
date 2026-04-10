<div align="center">

<img src="images/logo.png" alt="TechSpar" width="520" />


**把专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘，串成一个持续进化的技术面试闭环。**

[在线 Demo](https://aari.top/) · [快速开始](#快速开始) · [English](README.en.md)


[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Powered-1C3C3C.svg)](https://www.langchain.com/langgraph)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)


![TechSpar 产品总览](images/techspar-overview.png)
</div>

> TechSpar 的核心不是某一个单独功能页面。  
> 它的核心是同一套长期记忆、画像更新和下一轮训练调度机制。
> 专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘，不是彼此孤立的五个页面，而是围绕同一套长期记忆、掌握度和画像系统协同工作的同一个闭环。

---

## 它不是“再来一组题”

大多数 AI 面试产品的问题不在于题不够多，而在于**没有闭环**。

你今天答得差，系统知道。  
但你明天再来，它又像第一次见你一样重新开始。

TechSpar 要解决的不是“生成更多题”，而是把一次次训练、模拟、实战辅助和复盘连接起来，形成一条持续进化的路径：

| 传统面试工具 | TechSpar |
| --- | --- |
| 场景割裂：刷题、模拟、复盘各做各的 | 专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘共用同一套画像与长期记忆 |
| 每次开始都像第一次使用 | 每次进入新一轮前都会读取历史掌握度、薄弱点、训练轨迹和上下文 |
| 训练结果停留在当前会话 | 训练结果会写回画像、掌握度、薄弱点和复习调度 |
| 很难把“准备阶段”和“真实面试”连接起来 | 从备面、模拟到实战辅助、复盘形成连续链路 |
| 反馈只对这一次有用 | 每次反馈都会改变下一轮训练重点 |
| 产品通常只覆盖单一环节 | 覆盖专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘 |
| 用完即结束 | 训练 -> 评估 -> 画像更新 -> 下轮更精准，形成持续进化闭环 |

> **TechSpar 不是帮你“刷一轮题”，而是帮你建立一整套从备面到复盘、从单次训练到长期提升的技术面试闭环。**

---

## 题库为什么是核心设计

很多人会把“题库”理解成一组固定题目列表，但 TechSpar 的题库不是这个意思。

它本质上是一个**动态出题底座**，不是一个“把旧题存起来给你反复刷”的静态题单。

- **核心知识库**：定义这个领域该覆盖哪些知识边界，给出题和评分提供语义参考
- **高频题库**：标记真实面试里更常出现、更值得优先覆盖的考点
- **历史训练记录**：记录最近练过什么、哪些题答得差、哪些薄弱点还没补上
- **长期画像与掌握度**：决定这轮该继续补短板，还是向更难、更广的方向拓展

最终的题目不是“从题库里抽出来”，而是系统综合这些信息后，**为这一轮训练动态生成**。

也就是说：

- 传统题库产品：先有一批固定题，再让你去做
- TechSpar：先判断你现在最该练什么，再生成这一轮最合适的题

这也是为什么题库在这里不是边缘功能，而是整个闭环里的核心基础设施。

---

## 在线体验

直接体验：**[https://aari.top/](https://aari.top/)**

| Email | Password |
| --- | --- |
| admin@techspar.local | admin123 |

> 演示环境请不要上传真实简历、真实录音或任何敏感个人信息。

---

## 这个闭环如何运转

### 1. 训练前：先确定你该练什么

系统不会把你当成“新用户”反复重置，而是先读取已有信息：

- **Session Context**：简历、JD、知识库、最近训练记录
- **Topic Mastery**：领域掌握度、历史薄弱点、练习轨迹
- **Global Profile**：跨领域强项、弱项、思维模式、沟通风格

这决定了下一轮问题更像“延续训练”，而不是“重新开始”。

### 2. 训练中：不同入口共享同一条主线

#### 专项强化训练

围绕某个领域集中训练，优先命中历史薄弱点，并结合掌握度调节难度和发散度。

#### 简历模拟面试

AI 读取简历，通过 LangGraph 状态机推进完整流程：自我介绍 -> 技术问题 -> 项目深挖 -> 反问环节。

#### JD 定向备面

输入岗位描述后，系统会先拆解 JD，再围绕岗位要求、简历经历和知识库内容生成更贴近真实岗位的问题。

#### 实时 Copilot

先基于 JD、简历和历史画像做预处理，生成提问策略树与高危路径；进入实时模式后，系统持续转写 HR 发言、预测追问方向，并给出回答建议。

#### 录音复盘

上传面试录音或粘贴面试文本，系统自动转写、结构化 Q&A，并输出逐题分析与改进建议。

### 3. 训练后：不是结束，而是写回系统

每次训练结束后，系统不会只给一句总评，而是继续向后推进：

- 逐题评估回答质量
- 提取薄弱点、强项和行为特征
- 更新领域掌握度与长期画像
- 用 **SM-2** 调度后续复习
- 把这次结果带入下一轮训练

这意味着：**每次训练都会改变下一次训练。**

---

## 每轮结束后你会得到什么

- **逐题评分**：不是只看整体感觉，而是逐题拆开评估
- **薄弱点提取**：明确知道自己卡在哪，而不是笼统地“回答一般”
- **掌握度变化**：跟踪某个领域到底是在进步还是原地打转
- **长期画像更新**：系统会记住你的习惯性问题，而不是下一次重新开始
- **复习优先级**：会根据遗忘风险安排后续训练重点
- **参考答案与二次重练入口**：复盘后可以继续对照修正，而不是看完报告就结束

---

## 适合谁

- 正在准备后端、算法、AI 应用、Agent、RAG 等技术岗位面试的人
- 已经刷了很多题，但训练缺乏连续性和复盘闭环的人
- 想围绕简历项目和 JD 做更接近真实面试练习的人
- 想在真实面试前做针对性准备，或在面试中借助实时 Copilot 辅助判断追问方向的人
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

如果你只是想先把项目跑起来，不一定要先购买模型服务。一个简单的免费示例是：

- 主 LLM：ModelScope 的 `ZhipuAI/GLM-5`
- Embedding：SiliconFlow 的 `BAAI/bge-large-zh-v1.5`

注册入口：

- ModelScope: <https://modelscope.cn/home>
- SiliconFlow: <https://cloud.siliconflow.cn/>

配置示例：

```env
API_BASE=https://api-inference.modelscope.cn/v1
API_KEY=your-modelscope-sdk-token
MODEL=ZhipuAI/GLM-5

EMBEDDING_BACKEND=api
EMBEDDING_API_BASE=https://api.siliconflow.cn/v1
EMBEDDING_API_KEY=sk-your-siliconflow-key
EMBEDDING_API_MODEL=BAAI/bge-large-zh-v1.5
```

`API_KEY` 填 ModelScope 的 SDK Token，`EMBEDDING_API_KEY` 填 SiliconFlow 的 API Key。主 LLM 和 Embedding 可以分开用不同服务商，不需要来自同一家。

认证默认值如下，不配置也能启动：

```env
JWT_SECRET=change-me-in-production
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
DEFAULT_NAME=admin
ALLOW_REGISTRATION=false
```

如果你要改成本地 embedding，继续补全 `.env.example` 里的 `LOCAL_EMBEDDING_*`。

如果你要启用面试 Copilot 的独立模型、实时语音识别或联网搜索，还需要继续补全这些可选项：

```env
COPILOT_API_BASE=
COPILOT_API_KEY=
COPILOT_MODEL=
DASHSCOPE_API_KEY=
TAVILY_API_KEY=
```

不填 `COPILOT_*` 时会回退到主 LLM；`DASHSCOPE_API_KEY` 同时承担 Copilot 的**实时语音识别**（qwen3-asr-flash-realtime）和**录音文件批量转写**两个用途，不配置时 Copilot 只能手动输入 HR 的问题。

`TAVILY_API_KEY` 可以在 Tavily 官网注册后获取：<https://tavily.com/>。免费计划每月提供 `1,000 credits`，足够先把联网搜索跑通。

如果你要启用 Copilot **自动区分 HR 与候选人音色**（基于腾讯云 VPR 声纹识别），还可以补全以下可选项：

```env
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_VPR_APP_ID=
```

不配置时 Copilot 依然可用，只是需要手动点按钮切换"HR / You"角色。

如果你要启用录音上传转写，还需要继续补全这些可选项：

```env
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

登录后可从侧栏进入 `面试 Copilot`，或直接访问：

```text
http://localhost:5173/copilot
```

### 4. 从旧版迁移

如果你是从无认证旧版升级：

```bash
python -m backend.migrate
```

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

为了避免文档继续变成过时快照，这里只保留稳定结构：

- `backend/main.py`：FastAPI 入口和主要接口
- `backend/graphs/`：简历面试、专项训练、JD 备面、录音复盘、Copilot 预处理等核心流程
- `backend/copilot/`：实时辅助相关的策略树、方向预测、回答建议、语音流处理
- `backend/storage/`：会话、Copilot prep 等持久化
- `frontend/src/pages/`：训练、画像、图谱、题库、Copilot、设置、复盘等页面
- `frontend/src/api/`、`frontend/src/contexts/`、`frontend/src/hooks/`：接口封装、全局状态和实时交互逻辑
- `data/users/{user_id}/`：每个用户的画像、简历、知识库、题库和设置
- `docker-compose.yml`、`requirements*.txt`、`.env.example`：部署和运行入口

---

## License

CC BY-NC 4.0

---

<div align="center">

**If you find this project useful, please give it a star.**

[![Star History Chart](https://api.star-history.com/svg?repos=AnnaSuSu/TechSpar&type=Date)](https://star-history.com/#AnnaSuSu/TechSpar&Date)

</div>

---

## 致谢

感谢 [LINUX DO](https://linux.do/) 社区的支持。
