# Desktop Pet

Windows 透明置顶桌宠：**导入完整 Live2D 模型包 + 独立 DeepSeek 聊天窗口（LangGraph Agent）**。

## 当前能做什么

- 无边框透明窗口，右下角置顶
- 右键菜单 / 托盘：导入 Live2D、播放动作与表情、声音开关、聊天、置顶、鼠标穿透
- **导入 Live2D**：选择模型文件夹，自动拷贝贴图、动作、声音等资源
- Cubism 2 / 4 运行时（Pixi + `live2dcubismcore` / `live2d.min.js`）
- **独立聊天窗口**：微信式会话列表与气泡对话；DeepSeek 为默认 LLM；API Key 仅保存在主进程
- **长期记忆**：跨会话共享用户画像/偏好；聊天侧栏可查看、编辑、清空；删除会话不丢画像
- 聊天时桌宠会进入思考 / 说话状态（假口型），窗口关闭不影响桌宠与已保存会话

## 用法

1. `npm install` → `npm run dev`
2. 右键桌宠 → **导入 Live2D 文件夹**
3. 导入后可：悬停跟随、点击互动、右键播动作/表情、开关动作声音
4. 右键 / 托盘 → **聊天**，打开独立聊天窗口
5. 在聊天窗口侧栏打开 **DeepSeek 设置**，填入 API Key（及可选服务地址 / 模型）后即可对话

## 聊天说明

- 默认 Provider：DeepSeek OpenAI 兼容接口（`https://api.deepseek.com`，模型 `deepseek-chat`）
- 会话与消息持久化在项目目录 `data/chat/`
- 长期记忆持久化在 `data/memory/`（与聊天原文分离）
- 知识库、工具 trace、Embedding 模型权重等均在 `data/` 下（见下方数据目录说明）
- API Key 优先用系统 `safeStorage` 加密保存；若当前环境无法加密，仅保留在本次进程内存中
- 完整 API Key **不会**回传到渲染进程或写入聊天记录
- Agent 运行于主进程（LangChain / LangGraph）；本期默认不开放系统工具
- **本期不提供 TTS / 角色音色朗读**；后续可通过消息级朗读接口接入，不影响现有 Live2D 动作声音

## Live2D 说明

- Core：`public/live2d/live2dcubismcore.min.js`、`public/live2d/live2d.min.js`
- 导入缓存：`layer-packs/live2d-models/`
- 动作中的 `Sound` 字段会随动作自动播放（可在菜单关闭）

环境变量（可选）：

- `DESKTOP_PET_LAYER_PACKS` — 导入包存放目录（默认项目根下 `layer-packs`）
- `DESKTOP_PET_DATA` — 运行时数据根目录（默认 `<projectRoot>/data/`）
- `DESKTOP_PET_USE_USER_DATA=1` — 开发回退：仍使用 Electron userData（不推荐）

## 数据目录

默认所有运行时数据落在项目根目录 `data/`（已 gitignore）：

| 子目录 | 用途 |
|--------|------|
| `data/chat/` | 会话与消息 |
| `data/memory/` | 长期记忆 JSON + 向量索引 |
| `data/knowledge/` | 知识库源文档、切块索引、向量 |
| `data/traces/` | 工具调用 trace（JSONL） |
| `data/logs/` | 应用日志 |
| `data/models/` | BGE-Small-ZH-v1.5 Embedding 权重缓存 |
| `data/reminders/` | 本地提醒 |
| `data/config/` | 工具开关等配置 |

**从旧版迁移**：若你曾在 `%APPDATA%/DesktopPet/`（或 Electron userData）存有聊天/记忆/知识库数据，请手动将对应文件复制到上述 `data/` 子目录后重启应用。本版本**不会**自动迁移。

### BGE-Small-ZH-v1.5 模型

Hybrid 检索使用本地 Embedding 模型 `Xenova/bge-small-zh-v1.5`。优先加载手动放置目录：

`data/models/bge-small-zh-v1.5/`

若该目录不存在或不完整，才会尝试自动下载到 `data/models/`。下载失败时**不会**降级为纯关键词检索。

手动下载示例：

```bash
huggingface-cli download Xenova/bge-small-zh-v1.5 --local-dir "D:\ProjectWork\DesktopPet\data\models\bge-small-zh-v1.5"
```

至少需要：`config.json`、tokenizer 文件，以及 `onnx/model_quantized.onnx`（或 `onnx/model.onnx`）。完成后重启应用，或在知识库面板点击「重试加载模型」。

### 检索 IR 评测

```bash
npm run eval:retrieval       # 默认 mock Embedding（快，CI 友好）
npm run eval:retrieval:real  # 使用真实 BGE（需 data/models 权重；耗时更长）
# 也可：$env:EVAL_REAL_EMBEDDING='1'; npm run eval:retrieval
```

输出含 `mode: mock_embedding | real_embedding`。简历写指标时请注明模式；真测才反映完整 Hybrid 向量路质量。

## 打包（Windows）

```bash
npm install          # 含 electron-builder
npm run pack         # 产出未打包目录到 release/（便于本地验证）
npm run dist         # 产出 NSIS 安装包 + dir
```

说明：

- Embedding 原生依赖（`onnxruntime-node` 等）已配置 `asarUnpack`，避免 asar 内无法加载 `.node`。
- **不建议**把完整 BGE 权重打进安装包（体积大）；分发时让用户按上文放置到 `data/models/`，或首次启动自动下载。
- 开发跑 `npm run pack` 验证：启动产物后检查 Embedding 状态横幅能否变为 ready（权重就绪时）。
- Windows 本地打包默认 **不代码签名**（`signAndEditExecutable: false`），可避免 `winCodeSign` 解压 symlink 权限问题。若需正式签名，再自行配置证书并改回签名流程。

## 开发命令

```bash
npm run dev        # 开发
npm run typecheck  # 类型检查
npm test           # 单元测试 + 功能 eval
npm run eval:retrieval  # 检索 IR 评测（P@4/R@4/MRR@10，默认 mock）
npm run build      # 生产构建
npm run pack       # Windows 可运行目录
```

## 环境

- Windows 10/11
- Node.js >= 18
