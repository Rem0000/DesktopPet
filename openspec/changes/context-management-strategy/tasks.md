## 1. 契约与配置

- [x] 1.1 `src/chat/contracts.ts` 增加类型：`ContextUsage`（budgetCharacters/usedCharacters/ratio）、`HistoryHit`（messageId/sessionId/role/createdAt/excerpt/score）、`HistorySearchInput`（query/topK）
- [x] 1.2 新增 `electron/chat/contextConfig.ts`：`loadContextConfig(dir)` / `saveContextConfig`，默认 `budgetCharacters=40_000`，校验范围 [16_000, 64_000]，缺失/非法回退默认；与 `tool-config.json` 同目录 `data/config/`
- [x] 1.3 README 数据目录表补充 `data/config/context-config.json` 说明

## 2. 滚动会话摘要修复

- [x] 2.1 `agentRuntime.ts`：`AgentState` 增 `allMessages`；`normalize` 保存原始消息到 `allMessages`（`messages` 仍为 trimContext 结果）；`recall` 以 `state.allMessages`（完整历史）调 `memory.assemble`
- [x] 2.2 `memoryService.ts`：`ensureSessionSummary` 基于完整历史触发（修复 `total > budget` 恒不成立）；`provider.summarize` 输入改为 head+tail 采样（≤8k 字符）；保持 `coveredUntilMessageId` 增量；失败回退要点列表
- [x] 2.3 单测 `memoryService.test.ts`/`agentRuntime.test.ts`：长历史（>预算）触发摘要、增量推进（coveredUntil 前进）、摘要失败降级不阻断

## 3. 预算可配置与占用观测

- [x] 3.1 `chatController.ts`：启动读 `loadContextConfig(configDir)`，把 `budgetCharacters` 传入 `AgentRuntime`（替换硬编码 24_000）；`memoryService` 预算随之生效
- [x] 3.2 新增 `chat:context:usage` IPC：返回 `ContextUsage`（used = systemPrompt + 近期窗口长度估算）
- [x] 3.3 聊天窗占用水位指示：输入区旁展示 "上下文 X%"，>90% 警示

## 4. search_history 工具（包级全量）

- [x] 4.1 新增 `electron/chat/historySearch.ts`：`HistorySearchService(store, tools, getActivePackageId)`，`registerDefaultTools()` 注册 `search_history`（safe、enabled=true）；BM25 复用 `bm25Index`，作用域活跃包全部会话的 complete 消息，输出 `{ ok, hits, empty }` 带出处
- [x] 4.2 `chatController.ts`：实例化并注册；入参经 `require*` 校验（query 非空、topK 1-8）
- [x] 4.3 `agentRuntime.ts`：`formatToolResultsForModel` 对 `search_history` 注入硬约束（有命中逐字引用、empty 时禁止编造）；`search_history` 不进 `REPLAN_TRIGGER_TOOLS`
- [x] 4.4 `deepSeekProvider.ts`：`PLAN_TOOL_INSTRUCTION` 增加窄触发指引（引用更早对话且上下文缺细节才调用）
- [x] 4.5 单测 `historySearch.test.ts`：注册、包级作用域（不串其他包）、仅 complete、出处完整、Embedding 无关、空命中

## 5. eval 场景

- [x] 5.1 `evals/scenarios.json` + `run.eval.test.ts` 新增：`history-search-registered`、`history-search-package-scope`、`history-search-empty`、`summary-triggered`（长历史触发摘要）
- [x] 5.2 `npm test` 全量通过；`npm run typecheck` 通过

## 6. 文档与验收

- [x] 6.1 `highlight_resume_pet.md`：已知问题「长对话上下文遗忘」更新为已修复；新增上下文工程章节；维护记录追加
- [ ] 6.2 手动冒烟：长对话不遗忘、`search_history` 找回早前原话、占用水位显示、`tool-config.json` 可关闭 search_history、知识库面板 RAG 开关生效

## 7. RAG 检索开关

- [x] 7.1 `chatController.ts` 增加 `chat:rag:get` / `chat:rag:set` IPC：读写 `search_knowledge.enabled` 到 `tool-config.json` 并重放 applyOverrides
- [x] 7.2 `preload.ts` 暴露 `getRagEnabled` / `setRagEnabled`
- [x] 7.3 聊天窗知识库面板增加 RAG 开关（checkbox + 说明），切换即时生效
- [x] 7.4 `context-management` spec 增「RAG 检索开关」需求；eval 场景 `context-rag-toggle-off`（关闭后不规划且执行被拒）
- [x] 7.5 `npm test` / `typecheck` 全量通过
