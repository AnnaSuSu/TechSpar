# 部署说明

这页只写当前仓库真实可用的启动方式。

### 环境要求

* Python `3.11+`
* Node.js `18+`
* 一个可用的 **OpenAI 兼容 LLM 接口**
* 一个可用的 **Embedding 接口**，或者本地 Embedding 模型

录音上传转写不是必需功能；如果你要用它，再额外配置语音相关环境变量。

### 1. 复制环境变量

```bash
cp .env.example .env
```

### 2. 最小可运行配置

如果你想先把项目跑起来，推荐先用 **API Embedding** 模式。如果你使用远程 Embedding API，最小可运行配置如下：

```env
API_BASE=https://your-llm-api-base/v1
API_KEY=sk-your-api-key
MODEL=your-model-name
EMBEDDING_BACKEND=api
EMBEDDING_API_BASE=https://your-embedding-api-base/v1
EMBEDDING_API_KEY=sk-your-embedding-key
EMBEDDING_API_MODEL=your-embedding-model
```

这些变量分别是：

* `API_BASE`：主 LLM 的 OpenAI 兼容接口地址。面试、复盘、JD 分析都会走它。
* `API_KEY`：上面这个 LLM 接口的密钥。
* `MODEL`：主 LLM 模型名。
* `EMBEDDING_BACKEND`：Embedding 走哪条路，只能是 `api` 或 `local`。
* `EMBEDDING_API_BASE`：Embedding 接口地址。如果你用官方 OpenAI Embedding，这个值可以留空。
* `EMBEDDING_API_KEY`：Embedding 接口密钥。
* `EMBEDDING_API_MODEL`：Embedding 模型名。这里不要照抄示例，应该改成你的服务实际支持的模型。

如果你只是想先把项目跑起来，不一定要先购买模型服务。一个简单的免费示例是：

* 主 LLM：ModelScope 的 `ZhipuAI/GLM-5`
* Embedding：SiliconFlow 的 `BAAI/bge-large-zh-v1.5`

注册入口：

* ModelScope: <https://modelscope.cn/home>
* SiliconFlow: <https://cloud.siliconflow.cn/>

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

默认认证配置如下；如果不改，启动后可以直接登录：

```env
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
ALLOW_REGISTRATION=false
```

### 3. 如果你想用本地 Embedding

如果你不想走远程 Embedding API，可以改成：

```env
EMBEDDING_BACKEND=local
LOCAL_EMBEDDING_MODEL=BAAI/bge-m3
LOCAL_EMBEDDING_PATH=
```

说明：

* `LOCAL_EMBEDDING_MODEL`：本地 Embedding 模型名。
* `LOCAL_EMBEDDING_PATH`：如果你已经把模型下载到本地，可以直接写本地路径。
* `LOCAL_EMBEDDING_MODEL` 和 `LOCAL_EMBEDDING_PATH` 二选一即可。
* 本地模式需要额外安装依赖：`pip install -r requirements.local-embedding.txt`

### 4. 本地手动启动

后端：

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

启动后访问：

```text
http://localhost:5173
```

### 5. Docker 启动

```bash
docker compose up --build
```

启动后访问：

```text
http://localhost
```

### 6. 面试 Copilot 的额外配置

如果你要启用 Copilot 的独立模型、实时语音识别或联网公司搜索，还需要补齐这些可选项：

```env
COPILOT_API_BASE=
COPILOT_API_KEY=
COPILOT_MODEL=
DASHSCOPE_API_KEY=
TAVILY_API_KEY=
```

这些变量的作用分别是：

* `COPILOT_API_BASE` / `COPILOT_API_KEY` / `COPILOT_MODEL`：给 Copilot 单独指定一套 OpenAI 兼容模型配置。不填时会回退到主 LLM。
* `DASHSCOPE_API_KEY`：给 Copilot 的**实时语音识别**使用（模型 `qwen3-asr-flash-realtime`，走 OpenAI Realtime 兼容 WebSocket 协议，自带服务端 VAD）。同一个 key 也承担"录音上传批量转写"用途。不配时，Copilot 仍可用，但只能手动输入 HR 的问题。
* `TAVILY_API_KEY`：给 Copilot Prep 阶段的**公司联网搜索**使用。不配时不会整段报废，但公司情报会退化成"跳过联网搜索"。

如果你还想让 Copilot **自动区分 HR 与候选人**（无需手动按钮切换），再补上腾讯云 VPR 声纹识别（可选）：

```env
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_VPR_APP_ID=
```

配好后进入 Copilot 设置页的"声纹识别（可选）"卡片录制 6-15 秒候选人语音完成注册，实时面试就会自动打角色标签。不配置时一切功能照旧，只是角色需要手动切换。

额外注意：

* 如果你只是想先用 Copilot，看 JD 分析、匹配分析和策略树，`DASHSCOPE_API_KEY`、`TAVILY_API_KEY`、`TENCENT_*` 都不是强制项。
* 这些值怎么申请、控制台里去哪里找，统一看 [外部服务配置](external-services.md)。

### 7. 录音转写的额外配置

如果你要使用“上传录音 -> 自动转写”这条链路，还需要补齐：

```env
DASHSCOPE_API_KEY=
QINIU_ACCESS_KEY=
QINIU_SECRET_KEY=
QINIU_BUCKET=
QINIU_DOMAIN=
```

这些变量不是可有可无的一半配置，而是同一条链路里的两段能力：

* `DASHSCOPE_API_KEY`：阿里云 DashScope 的语音转写能力。
* `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`：上传到七牛所需的访问凭证。
* `QINIU_BUCKET`：目标存储空间。
* `QINIU_DOMAIN`：七牛对外访问域名。这里应该填完整域名前缀，例如 `https://cdn.example.com`。

当前代码的转写流程是：**先把音频传到七牛拿公网 URL，再把 URL 交给 DashScope 转写**。所以如果你要走“上传录音并自动转写”，`DASHSCOPE_API_KEY` 和整组 `QINIU_*` 都要配置。

如果这些没配，也不影响主要训练流程；录音复盘可以直接粘贴逐字稿文本。

这些值怎么申请、控制台里去哪里找，统一看 [外部服务配置](external-services.md)。

### 8. 线上部署注意事项

* 手动开发模式下，前端默认是 `5173`，后端是 `8000`。
* Docker 模式下，前端默认对外暴露 `80` 端口。
* 如果你在线上要使用麦克风或录音相关能力，建议启用 HTTPS；浏览器对非 `localhost` 的音频权限更严格。
* 线上环境不要保留默认的 `JWT_SECRET`、`DEFAULT_PASSWORD`。
