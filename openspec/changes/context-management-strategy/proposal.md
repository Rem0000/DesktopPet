## Why

长对话时模型回复会"忘记上文"：`normalize` 把全量会话硬裁到 24k 字符、最老轮次被静默丢弃；会话摘要的触发判断（`total > budget`）发生在裁剪**之后**，收到的消息恒 ≤ 24k，摘要几乎从不生成——超预算的早期对话既不保留原文、也无压缩兜底。这是上下文管理策略问题（recency 窗口 + 失效的压缩 + 对话不沉淀），需按「分层上下文」策略修复：Level 0 系统提示（人设/关系）→ Level 1 可检索长期记忆 → Level 2 滚动会话摘要 → Level 3 近期原文，并补充 Level 2.5 的包级历史会话按需检索，作为压缩摘要的逐字兜底。

## What Changes

- **修通滚动会话摘要**：`ensureSessionSummary` 改为基于**裁剪前完整历史**计算，长对话真正生成滚动摘要（`coveredUntilMessageId` 增量推进），替代静默丢弃
- **上下文预算提升 + 可配置**：默认 24k → 40k（仍远小于 DeepSeek 64k token 上限），`data/config/context-config.json` 可覆盖
- **新增 `search_history` 工具（包级全量）**：按需检索**当前模型包全部历史会话**的原话（BM25-only、不依赖 embedding），结果带出处（会话/时间/角色）、走 `formatToolResultsForModel` 硬约束（未命中不得编造、引用必须逐字），规划提示限定窄触发（用户引用更早对话且当前上下文缺细节时才调用）
- **上下文占用可观测（轻量）**：IPC 暴露上下文预算与当前占用估算，聊天窗展示占用水位
- 以上均为**增强**，不改变 LangGraph 图结构语义、工具白名单边界与 IPC 主体协议；`search_history` 可经既有 `data/config/tool-config.json` 开关

## Capabilities

### New Capabilities
- `context-management`: 上下文预算与占用管理——默认预算提升、`data/config/context-config.json` 可配置、上下文占用估算与可观测 IPC
- `conversation-history-retrieval`: 包级历史会话按需检索工具 `search_history`（BM25-only、作用域当前包全部会话、出处、硬约束、窄触发）

### Modified Capabilities
- `agent-memory`: 会话摘要基于裁剪前完整历史滚动生成（修复 `total > budget` 触发失效），增量 `coveredUntilMessageId`
- `pet-agent-runtime`: 上下文组装语义——可见窗口 = 裁剪后的近期原文、摘要基于完整历史；规划提示新增 `search_history` 窄触发指引

## Impact

- **主进程**：`electron/chat/agentRuntime.ts`（图状态增 `allMessages`）、`electron/chat/memoryService.ts`（`assemble` 用完整历史做摘要 + 近期窗口裁剪）、`electron/chat/chatController.ts`（注册 `search_history`、读取上下文配置）、新增 `electron/chat/historySearch.ts`、新增上下文配置加载（`electron/chat/contextConfig.ts`）
- **检索复用**：`electron/retrieval/bm25Index.ts`（BM25-only 路径，避开 embedding 依赖）；`ToolRegistry`/`formatToolResultsForModel`/`PLAN_TOOL_INSTRUCTION` 扩展
- **前端**：聊天窗上下文占用指示；`preload.ts` 增加 IPC；`src/chat/contracts.ts` 增加工具输出/占用类型
- **数据**：`data/config/context-config.json`（gitignored）
- **测试/eval**：historySearch 单测、滚动摘要单测、`evals/scenarios.json` + `run.eval.test.ts` 新增 context 场景
- **隔离**：`search_history` 仅读活跃包会话，不写记忆/关系/小说；不引入新外部依赖
