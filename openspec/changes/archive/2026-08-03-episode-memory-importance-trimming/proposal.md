## Why

长对话上下文遗忘已由 `context-management-strategy` 修复（滚动摘要 + `search_history` 兜底），但其设计明确把两项增强留作待办：① 对话中的**关键事实**（决定、约定、个人信息、偏好事实）不会自动沉淀为长期记忆——目前只靠模型显式 `remember_fact`，模型一旦没写就永久丢失；② 超预算裁剪仍是**纯 recency**——被挤出近期窗口时，重要的早期事实与琐碎闲聊同等对待、先按时间丢弃。本轮补齐这两个「记忆 / 上下文工程」闭环，让「对话不会白聊」。

## What Changes

- **新增对话关键事实自动 episode 沉淀**：每轮对话完成后，主进程**非阻塞**调用 LLM 从「尚未沉淀的会话片段」抽取关键事实，写入 `type=episode` 的长期记忆（带 `sourceSessionId` / `sourceMessageIds` 溯源）。带**触发闸门**（关键事实启发式命中，或累计未沉淀消息数达阈值）与**频率限制**避免每轮烧 token；结果经 `data/config/episode-config.json` 可开关。
- **新增消息级重要性**：`ChatMessage` 增可选 `importance`（1–3，默认 2）；用户消息写入时按启发式打分（关键事实标记、提问、长度），助手消息若本轮携带工具结果则加分。纯函数实现、可单测。
- **消息级重要性加权裁剪**：`trimContext` / `trimToBudget` 改为「**近期窗口逐字保留 + 窗口外按 importance 优先保留**」的混合策略，输出保持原始时序；新增 `context-config.json` 的 `importanceTrim` 与 `recentWindow` 配置。
- 上述均为**增强**：不改变 LangGraph 图结构语义、工具白名单边界、IPC 主体协议；不新增 Agent 工具；与关系模块/小说模块零耦合。
- 补单测 + eval 场景，离线 eval 保持全绿。

## Capabilities

### New Capabilities

- `episode-memory-distillation`: 对话关键事实自动 episode 沉淀——抽取触发闸门、LLM 结构化抽取与容错解析、去重、`episode` 记忆写入与溯源、频率限制与配置开关
- `message-importance-trimming`: 消息级重要性——`ChatMessage.importance` 字段、写入期启发式打分、重要性加权裁剪（近期窗口 + 窗口外按重要性优先）与配置

### Modified Capabilities

- `pet-agent-runtime`: 上下文容量控制——裁剪从纯 recency 升级为 importance 加权混合策略

## Impact

- **主进程**：`electron/chat/chatService.ts`（`onChatComplete` 后挂 episode 抽取钩子）、`electron/chat/chatController.ts`（注入 episode 抽取器与配置）、新增 `electron/chat/episodeDistiller.ts`（抽取/解析/写入/闸门）、新增 `electron/chat/messageImportance.ts`（重要性启发式与加权裁剪）、`electron/chat/agentRuntime.ts`（`trimContext` 改为 importance 加权）、`electron/chat/memoryService.ts`（`trimToBudget` 同步更新）
- **共享契约**：`src/chat/contracts.ts`（`ChatMessage.importance`、episode 配置/遥测类型）
- **Provider 复用**：`DeepSeekProvider.completeText`（结构化抽取，仿 `RelationshipEvaluator.parseCandidates` 的 JSON 容错）
- **数据**：`data/config/episode-config.json`（gitignored）；`ChatMessage` 可选字段向后兼容既有 `chat-data.json`
- **测试/eval**：`messageImportance.test.ts`、`episodeDistiller.test.ts`、`evals/scenarios.json` + `run.eval.test.ts` 新增场景
- **隔离**：episode 只写 `data/memory/memory-data.json`；不写关系/小说；不新增白名单工具
