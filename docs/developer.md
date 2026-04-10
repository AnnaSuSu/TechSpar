# 开发者说明

这页只描述当前仓库的真实结构，方便贡献者快速定位代码。

### 技术栈

* **前端**：React 19、React Router 7、Vite、Tailwind CSS 4、Radix UI
* **后端**：FastAPI、LangGraph、LangChain、LlamaIndex
* **存储**：SQLite + `data/` 目录下的用户隔离数据
* **可选外部服务**：OpenAI 兼容 LLM / Embedding、DashScope ASR（批量 + 实时 qwen3-asr-flash-realtime）、腾讯云 VPR（声纹识别）、Qiniu OSS、Tavily

### 目录结构

* `frontend/src/pages/`：页面级路由，例如首页、画像、题库、图谱、Copilot、设置、复盘页
* `frontend/src/components/`：通用组件和 UI 组合
* `frontend/src/api/`：前端请求封装
* `frontend/src/contexts/`、`frontend/src/hooks/`：全局状态和交互逻辑
* `backend/main.py`：FastAPI 入口和主要接口
* `backend/graphs/`：不同训练模式的流程逻辑
* `backend/copilot/`：实时辅助相关的策略预测、方向判断、回答建议和语音流处理
* `backend/config.py`、`backend/models.py`、`backend/llm_provider.py`：配置、数据模型和模型接入
* `backend/prompts/`：提示词定义
* `backend/storage/`：会话和存储层
* `data/`：数据库、用户简历、题库、画像等运行时数据

### 本地开发

本地启动方式以 [部署说明](deployment.md) 为准。当前仓库是前后端分离结构，不是根目录单个 `npm run dev` 就能跑起来的项目。

### 贡献建议

* 改文档时，优先和真实 UI、真实接口保持一致。
* 改导航、页面入口或新增能力时，同时检查 `README.md` 和 `docs/` 索引有没有一起更新。
* 改训练流程时，同时检查前端文案、接口返回和复盘页展示有没有一起更新。
* 提 PR 前，至少自己走一遍对应功能路径，避免“文档和代码各说各话”。

### 反馈方式

欢迎提交 Issue 和 PR。对这个项目最有价值的反馈，不是“感觉不错”，而是明确指出哪里误导、哪里跑不通、哪里真的帮到了用户。
