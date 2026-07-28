## Why

当前 DesktopPet 已具备 LangGraph Agent、白名单记忆/提醒工具与跨模型共享记忆，但距离「可写进秋招简历的智能体工程项目」仍差平台化能力：工具难扩展、调用链不可观测、记忆召回偏弱、缺少本地知识库与评测闭环。秋招窗口临近，需要按 8–10 周路线把项目从「能聊天的桌宠」升级为「可插拔工具编排 + 可检索长期记忆 + 本地 RAG + 可评测」的桌面智能体系统。

## What Changes

- 将现有 ToolRegistry 升级为可配置、可开关、可校验的工具平台，并默认保留记忆/提醒白名单边界。
- 增加 Agent 可观测性：工具调用日志（名称、入参摘要、耗时、成败）与聊天侧调用时间线展示。
- 升级长期记忆：可检索召回（先关键词/BM25）、重要度与时间衰减、pin、冲突合并，以及 top-k + token 预算注入。
- 新增本地知识库 RAG：导入 md/txt（可后续扩 pdf）、切块索引、检索增强回答，并展示引用来源。
- 新增轻量离线评测集与安全兜底：工具白名单强化、危险操作确认、敏感信息遮罩；产出可量化前后对比指标。
- 同步维护 `highlight_resume_pet.md`，对齐秋招大模型应用/智能体方向的简历与面试话术。

## Capabilities

### New Capabilities
- `agent-tool-observability`: 工具调用结构化日志、统计与聊天窗调用时间线
- `local-rag`: 本地文档导入、切块索引、检索增强与引用溯源
- `agent-eval-safety`: 小型离线评测集、安全策略与指标输出

### Modified Capabilities
- `pet-agent-runtime`: 工具注册平台化（配置驱动注册、开关、统一错误语义）；图节点可上报工具观测事件
- `agent-memory`: 从列表召回升级为可检索记忆；生命周期（衰减/pin/冲突合并）与 top-k 预算注入
- `pet-chat-window`: 展示工具调用时间线、记忆检索入口、RAG 引用片段

## Impact

- 主进程：`electron/chat/toolRegistry.ts`、`agentRuntime`、`memoryService`/`memoryStore`、`chatController`；新增 RAG 与 observability 模块
- 渲染层：`src/chat/ChatApp.tsx` 及相关合约类型（`contracts.ts` / preload `petAPI`）
- 存储：在现有 JSON 基础上扩展记忆索引字段；新增知识库目录与索引文件（仍落在 `userData`）
- 文档：`highlight_resume_pet.md` 按秋招智能体路线重写亮点与面试 Q&A
- 依赖：评测可为本地脚本（Vitest/Node）；RAG 一期可不引入向量库，后续可选 embedding
