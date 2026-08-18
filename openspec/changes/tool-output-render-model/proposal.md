## Why

`formatToolResultsForModel`（`electron/chat/agentRuntime.ts:296`）是一个按工具名分派的中央格式化开关：内容型工具（`search_history`/`web_search`/`web_fetch`/技能）有专属透传分支，而其余成功工具一律折叠成通用占位符「成功，可在回复中自然确认已完成，不要复述 JSON」。这导致**检索/工具的原文内容不会进入模型与评测上下文**。该设计已造成两次真实事故：猜数字技能里模型拿不到 `compare_guess` 真值而编造胜负；`search_knowledge` 的 excerpt 被剥掉后 RAG 引用失去接地（真实 LLM judge 把 grounded 回答判为 1 分，隔离实验证明「给证据模型就能逐字引用」）。根因是结构性的：新增工具必须手动记得加「内容透传」分支，漏了就静默退化，无强制约束、无测试兜底。

## What Changes

- **新增 `AgentTool.renderForModel(output)`**：每个工具自带「成功结果如何渲染给模型」，与 `validate`/`execute` 同住一个工具对象。
- **`ToolRegistry.register()` 强制校验**：工具定义了 output 形状就必须提供 `renderForModel`，缺失即 fail-fast，不再静默退化。**BREAKING**：新增/既有工具契约变更。
- **`formatToolResultsForModel` 职责收敛**：只保留跨工具回复策略（失败/取消/记住意图/关系意图的硬约束 + 不可信区隔离），成功结果的渲染全部下放给工具自身。
- **`search_knowledge` 补齐内容透传**：对齐 `search_history`/`web_search`/`web_fetch`，引用 MUST 逐字取自 excerpt、空结果禁止编造。
- **真实 judge 断言加严**：从 `totalPass > 0` 改为「与 `expectedPass` 的符合率 ≥ 阈值」，并锁定 `citation-fidelity` 场景必过。**BREAKING**：评测门槛变化。

## Capabilities

### New Capabilities

- `agent-tool-rendering`: 工具输出渲染模型——每个 `AgentTool` 自带 `renderForModel`，注册时强制「有输出必有渲染」，从根上消灭中央 switch 的静默折叠类缺陷。

### Modified Capabilities

- `pet-agent-runtime`: 成功的工具结果必须把真实输出内容透传给模型（内容型工具不得折叠为通用成功占位符）；跨工具回复策略（失败/意图约束/不可信区隔离）保留。
- `agent-eval-safety`: 真 LLM judge 断言从「至少一条 pass」改为「与 expectedPass 符合率门槛」；`citation_fidelity`（faithfulness）纳入必过维度。

## Impact

- `electron/chat/agentRuntime.ts`：`formatToolResultsForModel` 重构，成功结果渲染委托给工具。
- `electron/chat/toolRegistry.ts`：`register()` 强制校验 + `AgentTool` 契约扩展。
- `src/chat/contracts.ts`：`AgentTool` 新增 `renderForModel`。
- 各工具实现补 `renderForModel`：`memoryService`（update_profile/remember_fact/forget_memory）、`knowledgeService`（search_knowledge）、`historySearch`（search_history）、`tavilyTools`（web_search/web_fetch）、`skills`（技能结果）、`relationshipService`（update_relationship）。
- `evals/run.judge.eval.test.ts` + `evals/judge/scenarios.json`：断言加严、新增回归场景。
- 新增/修改单测：`agentRuntime`、`toolRegistry`、各工具、judge eval。
