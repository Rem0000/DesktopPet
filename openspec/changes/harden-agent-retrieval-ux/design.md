## Context

DesktopPet 已完成 Hybrid RAG、工具白名单、记忆与离线评测，但存在若干会破坏秋招叙事的缺口：`confirmTool` 未从 `ChatService` 传入；`forget_memory` 标为 `safe`；`plan` 失败静默清空工具；`VectorStore.upsert` 每次全量写盘；Agent 图仅单轮 tools→model；聊天工具时间线默认折叠；IR eval 使用 mock embedding；无 electron-builder 打包；Embedding 冷启动反馈弱。

约束：4060 8GB 显存，TTS 仍搁置；Embedding 继续用本地 BGE；向量存储本期仍以 JSON MVP 为主，优先批写而非立刻上 sqlite-vec；打包以 Windows 开发者可分发演示包为目标，不追求商店级签名。

## Goals / Non-Goals

**Goals:**

- 端到端 confirm 闸门 + 破坏性记忆工具风险纠正。
- 规划失败可观测；规划提示覆盖 RAG。
- 向量批写落盘与 Embedding 加载/批处理体验。
- 有限多轮工具环（最多 N 轮，默认 2–3）。
- 聊天窗工具执行态与时间线可见性提升。
- IR 评测可选真 Embedding；功能 eval 覆盖 confirm。
- Windows 可打包脚本与 README 说明。

**Non-Goals:**

- TTS / CosyVoice。
- Cross-encoder Rerank、云端向量库。
- 本期强制切换 sqlite-vec（可留接口，不作为交付门槛）。
- 无限 ReAct 环或开放用户自定义脚本工具。
- macOS/Linux 打包一等公民支持。
- 助手气泡完整 Markdown 渲染（可顺手小改，非本 change 验收项）。

## Decisions

### 1. Confirm 闸门接线

**决策**：`ChatService.run` 通过 IPC 向聊天窗发起确认请求（request/response），超时默认拒绝；`forget_memory`（及未来同类破坏性工具）`riskLevel: 'confirm'`。UI 使用模态确认条/对话框，展示工具名与脱敏入参摘要。

**备选**：主进程 `dialog.showMessageBox` → 体验割裂、难测；放弃 → 拒绝。

### 2. 规划失败可观测 + RAG 规划提示

**决策**：`plan` catch 后写入观测事件（及可选聊天 notice / 工具时间线伪条目「规划失败」），不阻断回复；扩展 `MEMORY_PLAN_INSTRUCTION`（或更名通用 plan instruction）明确：文档细节问题优先 `search_knowledge`。

**备选**：规划失败硬失败整轮 → 体验差；仅 console → 面试不可见。

### 3. 向量批写

**决策**：`VectorStore` 增加 `upsertMany` / `deleteMany`，内存更新后**单次** `persist()`；`indexChunks` 与记忆向量同步改走批量 API。检索仍线性扫描（规模目标不变）。

**备选**：立刻 sqlite-vec → Electron native 风险；仅 debounce 写盘 → 崩溃丢数据窗口更大。

### 4. 有限多轮工具环

**决策**：图在 `model` 后若模型返回结构化 tool_calls（或二次 `planToolCalls`）且未超 `maxToolRounds`（默认 2），则回到 `toolBoundary`；否则结束。硬上限总工具次数（如 6）防止失控。首版可保持「回复前规划」为主，第二轮用于「检索结果后再决定写记忆」类路径。

**备选**：完整 ReAct 流式 tool_calls 解析 → 改动面大；维持单轮 → 不满足「先搜再记」。

### 5. 聊天 UX

**决策**：工具 `phase=start` 时气泡显示「正在调用工具…」；本轮存在工具调用时时间线**默认展开**；`search_knowledge` 摘要继续显示命中条数。

### 6. IR 真 Embedding

**决策**：`eval:retrieval` 默认仍 mock（CI/离线快）；`EVAL_REAL_EMBEDDING=1`（或 `--real`）加载真实 BGE 并输出指标；README/简历注明两种模式。

### 7. Electron 打包

**决策**：引入 `electron-builder`（Windows nsis/dir），`npm run pack` / `dist`；打包配置 `asarUnpack` 覆盖 onnxruntime native；文档说明模型权重可外置 `data/models`，首次启动可下载或预置。

### 8. Embedding 冷启动

**决策**：IPC 已有 model-status；聊天窗在 `loading`/`error` 时展示横幅；`embedTexts` 尽量按小 batch 调用 pipeline（若库支持多文本一次则用之，否则保持循环但避免多余 persist）；重建索引进度回调已有则接到 UI。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 多轮工具延迟与费用上升 | 严格 max rounds / max calls；默认 2 |
| confirm IPC 死锁（窗已关） | 超时拒绝；窗口销毁取消 pending |
| electron-builder + onnx 体积巨大 | 文档允许外置模型；打包可选不内嵌权重 |
| 真 Embedding IR 在 CI 无权重 | 默认 mock；真测需本地模型 |
| 批写中途崩溃丢整批 | 原子写已有；批内失败回滚该批内存状态 |

## Migration Plan

1. 先合 confirm + riskLevel + 规划提示/观测（行为变更最小可测）。
2. 向量批写与 Embedding UI（无协议破坏）。
3. 多轮工具环（加 feature 常量，eval 覆盖）。
4. 打包脚本与 README。
5. 真 Embedding IR 开关与简历数字更新说明。

回滚：环境开关关闭多轮；confirm 未接线时代码路径可 feature-flag（默认开）。

## Open Questions

- 第二轮工具触发：二次 `planToolCalls` vs 解析模型 tool_calls JSON——倾向二次 plan（与现架构一致）。
- 打包是否内置量化 ONNX：倾向**不内置**，README 要求预置或首次下载。
