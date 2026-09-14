## MODIFIED Requirements

### Requirement: 上下文占用可观测

系统 SHALL 提供 IPC 暴露当前上下文预算与占用估算（usedCharacters 与 ratio），供聊天窗展示占用水位；占用超过预算 90% 时 SHALL 提供警示信号。占用观测 MUST 按每次模型请求落盘到会话链路日志，并由链路投影提供查询结果，MUST NOT 仅保留最近一次的内存快照。除字符占用外，系统 SHALL 一并暴露该次请求的 token 用量与缓存命中情况（provider 未提供时标注为估算）。

#### Scenario: 查询占用
- **WHEN** 渲染进程请求上下文占用
- **THEN** 返回 budgetCharacters、usedCharacters 与 ratio

#### Scenario: 高占用警示
- **WHEN** 估算占用超过预算的 90%
- **THEN** 聊天窗展示警示，提示上下文接近上限

#### Scenario: 历史轮次占用可查
- **WHEN** 用户或追踪台查询同一会话的多个历史轮次
- **THEN** 每轮各自的占用拆分与用量均可返回，而非只有最近一次的数值

#### Scenario: 按来源拆分
- **WHEN** 某轮上下文包含系统提示词、工具目录、技能规则、记忆召回与消息窗口
- **THEN** 返回的占用按这些来源分别给出字符数，使占用构成可解释
