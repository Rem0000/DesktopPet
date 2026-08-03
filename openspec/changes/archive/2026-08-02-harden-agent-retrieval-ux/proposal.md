## Why

秋招演示与简历叙事已具备 Hybrid RAG / 工具平台 / 评测闭环，但若干安全与可靠性缺口会直接打脸面试：confirm 闸门未接线、规划失败静默吞掉、向量写入卡顿、Agent 仅单轮工具、IR 指标未测真模型、聊天窗工具阶段反馈弱、无打包分发。此刻补洞比再堆功能更划算。

## What Changes

- 接线 `confirm` 级工具确认流；将破坏性记忆工具（如 `forget_memory`）标为 `confirm`，无确认则不执行。
- 工具规划失败时向用户/观测层显式反馈；规划提示补充 `search_knowledge` 等 RAG 场景引导。
- 向量存储支持批量 upsert 单次落盘，避免导入/重建时 N 次全量写 `vectors.json`。
- Agent 支持有限多轮工具环（先检索再写记忆等），保留白名单与预算上限。
- 聊天窗：工具执行中可见状态；工具时间线默认展开（或首次命中时展开），强化 demo 可观测性。
- IR 评测支持真 BGE Embedding 路径（可开关 mock），指标可写回简历。
- 补齐 Electron 可打包/分发脚本，覆盖 `@xenova/transformers` / `onnxruntime-node` 原生依赖与 `data/models` 说明。
- Embedding 冷启动与批量推理：加载状态进 UI；`embedTexts` 支持更高效批处理；重建索引时有进度反馈。

## Capabilities

### New Capabilities

- `electron-packaging`: 桌面应用打包与分发约定（脚本、native 依赖、模型权重路径说明）

### Modified Capabilities

- `agent-eval-safety`: confirm 闸门端到端行为；IR 评测真 Embedding 路径
- `agent-memory`: `forget_memory` 风险等级与确认后执行
- `pet-agent-runtime`: 规划失败可观测；有限多轮工具环；规划提示覆盖 RAG
- `pet-chat-window`: 工具执行态与时间线默认可见性
- `hybrid-retrieval`: 向量批写落盘；Embedding 加载态与批推理约束
- `local-rag`: 导入/重建索引时批写与进度反馈

## Impact

- 主进程：`agentRuntime.ts`、`chatService.ts`、`memoryService.ts`、`deepSeekProvider.ts`、`vectorStore.ts`、`embeddingService.ts`、`knowledgeStore.ts`
- 渲染进程：`ChatApp.tsx`（确认 UI、工具态、时间线、Embedding 状态）
- 构建：`package.json`、`vite.config.ts`、可能新增 electron-builder 配置
- 评测：`evals/run.retrieval.eval.test.ts`、`evals/scenarios.json`、功能回归补 confirm 场景
- 文档：`README.md`、`highlight_resume_pet.md`、`docs/interview-demo-3min.md`（与行为对齐）
