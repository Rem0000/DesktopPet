## ADDED Requirements

### Requirement: 规划提示覆盖历史会话检索
工具规划指令 SHALL 引导模型在用户引用更早对话（如"我之前说过…""上次你说…"）且当前上下文缺少该细节、`search_history` 已启用时，调用 `search_history` 检索当前模型包的历史会话；普通对话 MUST NOT 因默认流程调用该工具。`search_history` MUST 保持单发检索，MUST NOT 进入二次规划触发集。

#### Scenario: 引用早前对话时规划检索
- **WHEN** 用户引用更早对话中的内容且 search_history 已启用
- **THEN** 规划提示包含该工具，模型可选择调用它以找回逐字上下文

#### Scenario: 普通对话不触发
- **WHEN** 用户普通闲聊且未引用更早对话
- **THEN** 规划提示不诱导调用 search_history
