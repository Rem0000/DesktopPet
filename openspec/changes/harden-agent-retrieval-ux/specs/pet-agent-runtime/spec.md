## ADDED Requirements

### Requirement: 工具规划失败可观测
当 `planToolCalls` 抛错或返回无效结果时，系统 MUST NOT 静默吞掉失败：MUST 记录观测或向聊天窗发出可理解提示，且 MUST 继续生成不依赖工具的正常回复。

#### Scenario: 规划失败仍可回复
- **WHEN** planToolCalls 抛出异常
- **THEN** 系统不调用任何工具，仍流式返回助手回复，并产生规划失败的可观测信号

### Requirement: 规划提示覆盖知识库检索
工具规划指令 SHALL 引导模型在用户询问本地文档、项目说明或已导入资料细节时优先考虑 `search_knowledge`（若该工具已启用），同时保留记忆与提醒类工具的既有规划规则。

#### Scenario: 文档问题规划检索
- **WHEN** 用户询问知识库中文档细节且 search_knowledge 已启用
- **THEN** planToolCalls 的可选工具集合与规划提示包含该工具，且规划结果可选择调用它

### Requirement: 有限多轮工具环
Agent 运行时 SHALL 支持在单次用户请求内执行有限多轮「规划/工具 → 再规划/再工具 → 最终回复」，并 MUST 设置最大轮数与总工具调用次数上限；超出上限后 MUST 停止继续调用工具并生成基于已有结果的回复。

#### Scenario: 先检索再写记忆
- **WHEN** 用户请求需要先查知识库再写入长期记忆，且未超过多轮上限
- **THEN** 运行时可在首轮 search_knowledge 之后再次规划并执行记忆写入工具，再生成最终回复

#### Scenario: 超出轮数上限
- **WHEN** 工具环已达配置的最大轮数
- **THEN** 系统不再发起新的工具调用，并基于已有工具结果生成回复
