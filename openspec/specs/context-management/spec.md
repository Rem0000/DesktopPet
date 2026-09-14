## Purpose

聊天 Agent 的上下文预算与占用管理：统一预算配置、占用可观测与 RAG 检索开关。
## Requirements
### Requirement: 上下文预算默认值与配置
系统 SHALL 默认将聊天上下文预算设为 40,000 字符，并 SHALL 允许通过 `data/config/context-config.json` 覆盖；配置缺失、格式非法或超出允许范围时 MUST 回退到默认值，MUST NOT 中断聊天。上下文组装（长期记忆块、会话摘要块、近期原文窗口）SHALL 在统一预算内按既有比例分配。

#### Scenario: 默认预算
- **WHEN** 未提供上下文配置
- **THEN** Agent 以 40,000 字符预算组装上下文

#### Scenario: 配置覆盖预算
- **WHEN** 配置文件提供合法 budgetCharacters
- **THEN** 后续上下文组装使用配置值，无需重启

#### Scenario: 非法配置回退
- **WHEN** 配置文件缺失、格式非法或数值超出允许范围
- **THEN** 系统回退到默认预算并正常聊天

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

### Requirement: RAG 检索开关
系统 SHALL 提供知识库检索（RAG）开关：关闭后 `search_knowledge` MUST 不进入规划集合、执行时 MUST 被拒绝，对话不再检索知识库，以减少无关场景下的上下文占用。开关 MUST 持久化（经 `data/config/` 配置），MUST 可由聊天窗知识库面板切换，MUST NOT 影响长期记忆召回与历史会话检索。

#### Scenario: 关闭后不检索
- **WHEN** 用户关闭 RAG 开关后发送对话
- **THEN** search_knowledge 不在规划集合，且即使被调用也返回失败，模型不检索知识库

#### Scenario: 重新开启恢复
- **WHEN** 用户重新开启 RAG 开关
- **THEN** search_knowledge 恢复进入规划集合，对话可再次检索知识库

#### Scenario: 不影响记忆与历史检索
- **WHEN** RAG 开关关闭
- **THEN** 长期记忆召回（Level 1）与 `search_history`（Level 2.5）仍正常可用

