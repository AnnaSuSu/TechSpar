# 外部服务配置

这页不讲“项目怎么启动”，只讲**可选外部服务怎么申请、怎么拿到环境变量、怎么验证是否配通**。

如果你只是想先把项目跑起来，这页不是必读；先看 [部署说明](deployment.md)。

### 先看总表

| 环境变量 | 用在哪里 | 不配置会怎样 |
| --- | --- | --- |
| `COPILOT_API_BASE` `COPILOT_API_KEY` `COPILOT_MODEL` | 给 Copilot 单独指定模型 | 回退到主 LLM |
| `DASHSCOPE_API_KEY` | **两件事**：①Copilot 实时语音识别（qwen3-asr-flash-realtime）②录音文件批量转写 | 只能手动输入 HR 问题；录音上传转写也不可用 |
| `TENCENT_SECRET_ID` `TENCENT_SECRET_KEY` `TENCENT_VPR_APP_ID` | Copilot **自动区分 HR 与候选人音色**（腾讯云 VPR 声纹识别） | 实时面试时需要手动点按钮切换"HR / You"角色 |
| `TAVILY_API_KEY` | Copilot 的公司联网搜索 | 公司情报会退化，其他分析仍可用 |
| `QINIU_ACCESS_KEY` `QINIU_SECRET_KEY` `QINIU_BUCKET` `QINIU_DOMAIN` | 录音文件上传到公网 URL | 不能走上传录音转写链路 |

---

### 功能组合速查

如果你不想先读完整页，直接按你要开的功能看：

| 目标功能 | 最少要配什么 | 配好后怎么验证 |
| --- | --- | --- |
| Copilot 文本版 | `COPILOT_*`，或者什么都不填直接复用主 LLM | 进入 Copilot，能正常完成 Prep，并能在实时阶段手动输入 HR 问题 |
| Copilot 实时语音版 | `DASHSCOPE_API_KEY`（`COPILOT_*` 可选） | 进入 Copilot 实时阶段，点击开始录音后能看到实时字幕 |
| Copilot 自动说话人区分 | `DASHSCOPE_API_KEY` + `TENCENT_*`，并在设置页录入候选人声纹 | 实时面试时手动按钮被替换为"Auto"徽标，对话历史自动打 HR / candidate |
| Copilot 联网公司搜索 | `TAVILY_API_KEY` | Copilot Prep 结果里不再出现"未配置搜索 API" |
| 录音上传自动转写 | `DASHSCOPE_API_KEY` + `QINIU_*` | 录音复盘上传短音频后能拿到转写文本 |

再说得更直接一点：

* **只想先用 Copilot 文本版**：先不管 `DASHSCOPE_API_KEY`、`TENCENT_*`、`TAVILY_API_KEY`，文本输入照样能用。
* **只想开 Copilot 语音**：核心是 `DASHSCOPE_API_KEY`，`COPILOT_*` 不是强制。
* **想让 HR / 候选人自动区分**：在"只想开 Copilot 语音"基础上再加 `TENCENT_*`，并录入候选人声纹。
* **只想开录音上传转写**：只看 `DASHSCOPE_API_KEY + QINIU_*`（和实时语音共用一个 key）。

---

### 可复制 `.env` 示例

下面这些示例只展示相关变量，不是完整 `.env`。

#### 1. Copilot 最小可用示例

如果你已经有主 LLM，就可以什么都不填，直接复用主模型。

如果你想给 Copilot 单独模型，可以这样：

```env
COPILOT_API_BASE=https://api.openai.com/v1
COPILOT_API_KEY=sk-your-copilot-key
COPILOT_MODEL=gpt-4o-mini
```

#### 2. Copilot 实时语音示例

实时语音识别走 DashScope `qwen3-asr-flash-realtime`，只需要一个 key：

```env
DASHSCOPE_API_KEY=sk-your-dashscope-key
```

这个 key 同时也是"录音上传转写"用的那个，**两个场景共用一个**。

#### 3. Copilot 自动说话人识别（可选）

想让实时面试自动区分 HR 和候选人，不用手动按按钮切换，就再加上腾讯云 VPR 凭据：

```env
TENCENT_SECRET_ID=AKIDxxxxxxxxxxxxxxxx
TENCENT_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TENCENT_VPR_APP_ID=
```

这 3 项也可以不放 `.env`，而是在 Copilot 设置页的"声纹识别（可选）"卡片里填写（per-user 覆盖）。

#### 4. Copilot 联网搜索示例

```env
TAVILY_API_KEY=tvly-your-api-key
```

#### 5. 录音上传转写示例

```env
DASHSCOPE_API_KEY=sk-your-dashscope-key
QINIU_ACCESS_KEY=your-qiniu-ak
QINIU_SECRET_KEY=your-qiniu-sk
QINIU_BUCKET=your-bucket-name
QINIU_DOMAIN=https://cdn.example.com
```

---

### 1. `COPILOT_API_BASE` / `COPILOT_API_KEY` / `COPILOT_MODEL`

这 3 个值的本质不是“某个固定厂商专用配置”，而是：**给 Copilot 单独准备一套 OpenAI 兼容接口**。

你可以这样理解：

* `COPILOT_API_BASE`：接口基地址
* `COPILOT_API_KEY`：接口密钥
* `COPILOT_MODEL`：Copilot 要调用的模型 ID

#### 怎么拿

最常见有两种方式：

#### 方案 A：直接用 OpenAI 官方 API

1. 去 OpenAI 平台创建 API Key。
2. `COPILOT_API_BASE` 填 `https://api.openai.com/v1`
3. `COPILOT_API_KEY` 填你创建的 key
4. `COPILOT_MODEL` 填你实际要用、并且账号可调用的模型 ID

官方入口：

* OpenAI API Keys: <https://platform.openai.com/api-keys>
* OpenAI Docs Overview: <https://platform.openai.com/docs/overview>

#### 方案 B：用任意 OpenAI 兼容提供方

1. 在供应商控制台创建 API Key。
2. 找到它提供的 OpenAI 兼容 Base URL。
3. 在供应商文档或控制台里确认真实可用的模型 ID。

如果你用阿里云百炼的兼容模式，思路也是一样：先拿 API Key，再用它提供的兼容接口地址。

#### 怎么验证

最稳的验证顺序是：

1. 先在供应商控制台确认 key 已创建、模型已开通。
2. 再用一个最小请求验证接口真的能通。
3. 最后再把这组值填进 `.env`。

通用检查方式：

```bash
curl "$COPILOT_API_BASE/models" \
  -H "Authorization: Bearer $COPILOT_API_KEY"
```

如果你的供应商不支持 `/models`，就按它自己的官方文档做最小请求验证。

#### 常见坑

* `COPILOT_MODEL` 不要照抄示例，必须填你账号实际可用的模型 ID。
* 不同供应商的“Base URL 到底带不带 `/v1`”不一样，以官方文档为准。
* 如果你不想单独配 Copilot 模型，直接把这 3 个变量留空即可，系统会回退到主 LLM。

---

### 2. Copilot 实时语音识别 — 由 `DASHSCOPE_API_KEY` 驱动

Copilot 的实时语音识别直接走阿里云百炼的 `qwen3-asr-flash-realtime` 模型，协议是 OpenAI Realtime 兼容的 WebSocket，服务端自带 VAD（静音自动剔除）。

**跟"录音上传转写"共用同一个 `DASHSCOPE_API_KEY`**，不需要另外申请。拿 key 的步骤看本页的第 4 节。

配好之后，进入面试 Copilot 的实时阶段点击开始录音，如果能持续看到实时字幕，就算通了。如果 key 没配，会退化成"未配置 DashScope API Key，请使用手动输入"。

历史遗留说明：老版本曾经用阿里云 **智能语音交互 (NLS)** 的 `SpeechTranscriber`，需要单独填 `NLS_APPKEY` / `NLS_ACCESS_KEY_ID` / `NLS_ACCESS_KEY_SECRET` 并额外安装 NLS Python SDK。**现在已经完全切换到 DashScope，这组 NLS 变量和 SDK 都不再需要**。如果你是从老版本升级过来的，可以直接把它们从 `.env` 和依赖里删掉。

---

### 2b. `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` / `TENCENT_VPR_APP_ID`（可选，自动说话人识别）

这组值给 **Copilot 自动区分 HR 与候选人** 用，来自腾讯云 **声纹识别 (VPR)**。

不配置也不影响使用——面试时依然有一个手动按钮在 "HR" 和 "You" 之间切换角色。配置后，系统会把录进来的每段语音跟候选人提前录入的声纹锚点做 1:1 比对，匹配的判给候选人，不匹配的判给 HR，手动按钮会自动变成 "Auto" 徽标。

#### 为什么是腾讯云而不是阿里云

阿里云智能语音交互产品线里的 `SpeakerVerification` 是**文本相关**版本（必须让用户朗读一串 8 位数字才能注册和验证），官方文档明确说"不适用于多人对话场景中识别不同的说话人"。阿里云 AnalyticDB 的声纹方案虽然支持文本无关，但要求开通数据库实例 + 邀测。**腾讯云 VPR 是主流云厂商里唯一直接提供"开箱即用的文本无关 1:1 声纹验证 REST API"的**。

#### 怎么拿

1. 登录腾讯云控制台：<https://console.cloud.tencent.com/>
2. 开通"智能语音服务 - 声纹识别 VPR"（产品入口：<https://cloud.tencent.com/product/vpr>）
3. 在 API 密钥管理里创建或使用一对 `SecretId` / `SecretKey`：<https://console.cloud.tencent.com/cam/capi>
4. `TENCENT_VPR_APP_ID` 目前可以留空（腾讯 VPR 的 `SpeakerNick` 字段已经足够区分不同用户）

#### 怎么配置

两种方式二选一：

**A. 放全局 `.env`**——所有用户共用一对腾讯凭据：

```env
TENCENT_SECRET_ID=AKIDxxxxxxxxxxxxxxxx
TENCENT_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TENCENT_VPR_APP_ID=
```

**B. 通过 Copilot 设置页填写**（推荐，per-user）——每个登录用户在"设置 → 声纹识别（可选）"卡片里自己填凭据。这种方式的凭据保存在 `data/users/{user_id}/voiceprint.json`，不写到 `.env`。

#### 怎么注册声纹

凭据配好后：

1. 进 Copilot 设置页的"声纹识别（可选）"卡片
2. 点"测试并保存凭据"，看到"凭据已验证并保存"即连通
3. 点"开始录制"，连续说话 6-15 秒（建议安静环境单人说话）
4. 点"结束并上传"
5. 状态变成"● 已注册 (YYYY-MM-DD)"

#### 怎么验证

1. 注册完成后进入 Copilot 实时阶段
2. 如果之前那个 HR / You 角色切换按钮变成了 "Auto" 徽标，说明启用成功
3. 实测几轮对话，查看 `conversation` 历史里每条的 role 标签是否正确

如果"凭据已保存"但进入 Copilot 后按钮没变成 Auto，大概率是 `DASHSCOPE_API_KEY` 还没配——声纹识别依赖 ASR 切段，没有 ASR 就不会触发声纹验证。

#### 常见坑

* 声纹跟 ASR **是两套独立的云服务**，VPR 只负责"这段音频是不是候选人"，转写还是 DashScope 在做。两者缺一不可。
* 注册时的录音环境（蓝牙耳机 / 笔记本内置麦 / 手机麦）和面试时最好一致，信道不一致会让相似度分数下降。
* 候选人感冒、情绪激动时音色会轻微漂移，可以删除重录。
* 腾讯云 VPR 每月有免费额度，日常面试级别的调用量一般不会超（实现里对每段 1.5-3 秒音频只触发一次 verify）。

---

### 3. `TAVILY_API_KEY`

这个值给 Copilot Prep 阶段的**公司联网搜索**用。

#### 怎么拿

1. 注册 Tavily 账号
2. 在控制台创建 API Key
3. 把 key 填进 `TAVILY_API_KEY`

官方入口：

* Tavily Docs: <https://docs.tavily.com/>
* Tavily Dashboard: <https://app.tavily.com/>

#### 怎么验证

最简单的验证方式就是直接走 Copilot Prep：

1. 填一个真实公司名和岗位
2. 开始准备
3. 看结果页里的公司情报是否不再是“未配置搜索 API”或“搜索未返回结果”

当前实现里，不配置 `TAVILY_API_KEY` 不会让 Copilot 整体失败，只会跳过公司联网搜索。

#### 常见坑

* 这不是通用搜索引擎 key，不能拿别家的替代。
* 就算 key 正确，冷门公司也可能搜不到高质量结果。

---

### 4. `DASHSCOPE_API_KEY`

这个 key 来自阿里云 **百炼 / DashScope**，在当前项目里**承担两个完全不同的用途，但只需要一个 key**：

1. **Copilot 实时语音识别**（流式）— 通过 WebSocket 调用 `qwen3-asr-flash-realtime` 模型，OpenAI Realtime 兼容协议，服务端自带 VAD。
2. **录音上传批量转写** — 通过 HTTP 调用 `qwen3-asr-flash-filetrans` 模型，配合七牛 OSS 先上传文件再传公网 URL。

配哪个都是同一个环境变量，别重复申请。

#### 怎么拿

1. 开通阿里云百炼
2. 在控制台创建 API Key
3. 把这个 key 填进 `DASHSCOPE_API_KEY`

官方入口：

* 百炼 API Key 说明：<https://help.aliyun.com/zh/model-studio/get-api-key>
* 百炼控制台：<https://bailian.console.aliyun.com/>

#### 怎么验证

**验证实时 ASR**：

1. 配好 `DASHSCOPE_API_KEY`
2. 重启后端
3. 进入面试 Copilot 的实时阶段，点击开始录音
4. 如果能持续看到实时字幕，就算通了

**验证批量转写**：

1. 配好 `DASHSCOPE_API_KEY`
2. 再配好下面那组 `QINIU_*`
3. 去**录音复盘**上传一段很短的音频
4. 看能否成功拿到转写文本

因为当前代码的批量转写链路不是直接把本地文件发给 DashScope，而是先上传到七牛，再把公网 URL 交给 DashScope。所以两段链路都走通才算配完整。

---

### 5. `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` / `QINIU_BUCKET` / `QINIU_DOMAIN`

这组值给 **录音文件上传** 用，来自七牛云。

#### 怎么拿

1. 注册并登录七牛云控制台
2. 在密钥管理里拿到 `AccessKey` 和 `SecretKey`
3. 在 Kodo 对象存储里创建一个存储空间，得到 `Bucket`
4. 给这个空间准备一个可公网访问的域名，填到 `QINIU_DOMAIN`

控制台入口：

* 七牛云控制台：<https://portal.qiniu.com/>
* 七牛云开发者中心：<https://developer.qiniu.com/>

#### `QINIU_DOMAIN` 该填什么

这里不要只填裸域名，应该填**完整前缀**，例如：

```env
QINIU_DOMAIN=https://cdn.example.com
```

因为当前代码会直接拼成：

```text
{QINIU_DOMAIN}/{object_key}
```

如果你只写 `cdn.example.com`，最终 URL 就不是一个可靠的完整公网地址。

#### 怎么验证

最简单的验证路径还是直接走产品：

1. 配好 `QINIU_*`
2. 去 **录音复盘** 上传一个小文件
3. 如果上传阶段就失败，通常优先看 AK/SK、Bucket 名和域名
4. 如果上传成功但转写失败，再回头看 `DASHSCOPE_API_KEY`

#### 常见坑

* `Bucket` 名写错时，通常会卡在上传阶段。
* `QINIU_DOMAIN` 没带协议头时，后面拼出来的 URL 容易有问题。
* 用测试域名做开发可以，但正式环境最好换成你自己的正式访问域名。

---

### 推荐配置顺序

如果你不想一次配一大堆，按这个顺序最稳：

1. 先只跑主 LLM + Embedding，把系统启动起来。
2. 再决定 Copilot 要不要单独模型，最后再填 `COPILOT_*`。
3. 需要实时语音 / 录音上传转写时，补 `DASHSCOPE_API_KEY`（两个场景共用）。录音上传还需要一起补 `QINIU_*`。
4. 想让实时面试自动区分 HR 与候选人，再补 `TENCENT_*` 并在设置页录入候选人声纹。
5. 需要公司联网搜索时，再补 `TAVILY_API_KEY`。

---

### 常见报错和排查

这部分最实用。看到这些提示时，优先按右边查：

| 现象 / 报错 | 优先检查什么 |
| --- | --- |
| `未配置 DashScope API Key，请使用手动输入` | 没填 `DASHSCOPE_API_KEY`，或者 `.env` 没被后端读到 |
| `DASHSCOPE_API_KEY required for real-time ASR` | 同上，后端启动时报的 |
| `语音识别不可用，请使用手动输入` | `DASHSCOPE_API_KEY` 已配但连不通（检查 key 是否在百炼控制台激活、网络是否能访问 `dashscope.aliyuncs.com`） |
| 实时字幕出来了但 Copilot 没有 Auto 徽标 | `TENCENT_*` 没配，或候选人声纹没注册；进设置页检查声纹识别卡片状态 |
| 声纹注册时提示"腾讯云凭据无效" | 检查 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 是否填反、空格、是否已开通腾讯云 VPR 产品 |
| `TAVILY_API_KEY not configured, skipping company search` | 没填 `TAVILY_API_KEY`；这不会让 Copilot 全挂，只会跳过公司搜索 |
| `Qiniu upload failed` | 优先看 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET` |
| 上传成功但一直拿不到转写文本 | 优先看 `DASHSCOPE_API_KEY` 和 `QINIU_DOMAIN` 是否真能公网访问 |
| Copilot Prep 能跑，但公司情报很空 | `TAVILY_API_KEY` 没配，或目标公司本身公开信息太少 |

如果你排查完环境变量仍然不对，下一步别继续猜，直接看后端启动日志和对应功能路径的报错。
