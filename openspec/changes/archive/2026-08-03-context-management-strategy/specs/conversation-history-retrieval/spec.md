## ADDED Requirements

### Requirement: 历史会话按需检索工具
系统 SHALL 提供白名单工具 `search_history`（riskLevel=safe、默认 enabled、可经 `data/config/tool-config.json` 关闭），用于按需检索**当前活跃 Live2D 模型包全部历史会话**的已提交消息原文，并返回带出处（messageId/sessionId/role/createdAt/excerpt/score）的命中。检索 MUST 仅作用于活跃包，MUST NOT 混入其他包、长期记忆或小说数据。

#### Scenario: 包级全量检索
- **WHEN** 用户在对话中引用更早内容且模型调用 search_history
- **THEN** 工具在当前活跃包的全部历史会话中检索并返回相关已提交消息命中

#### Scenario: 仅返回已提交消息
- **WHEN** 某消息仍处于 streaming 或错误状态
- **THEN** 检索结果不包含该消息

#### Scenario: 不写记忆不串库
- **WHEN** search_history 执行
- **THEN** 不产生任何记忆/关系/小说写入，且检索范围限于活跃包会话

### Requirement: 检索不依赖向量 Embedding
`search_history` MUST 基于稀疏 BM25 在会话消息上建索引并检索，MUST NOT 依赖 BGE/向量 Embedding 可用性；Embedding 不可用时 MUST 仍可检索且不得报错。

#### Scenario: Embedding 不可用仍可检索
- **WHEN** 向量 Embedding 模型加载失败或不可用
- **THEN** search_history 仍通过 BM25 返回结果，不抛错

### Requirement: 检索结果硬约束
`search_history` 结果注入模型时 MUST 满足硬约束：有命中时模型引用 MUST 逐字取自结果、不得补充结果外的内容；无命中（empty=true）时模型 MUST 说明未在历史中找到，禁止编造或复述不存在的内容。

#### Scenario: 引用必须逐字
- **WHEN** search_history 返回命中且模型据此回复
- **THEN** 生成约束要求引用与结果逐字一致，不得补充结果外的内容

#### Scenario: 无命中不编造
- **WHEN** search_history 无命中（empty=true）
- **THEN** 模型 MUST 说明未在历史中找到，禁止声称找到或复述不存在的内容

### Requirement: 规划窄触发
工具规划指令 SHALL 仅引导模型在用户引用更早对话（如"我之前说过…""上次你说…"）且当前上下文缺少该细节时调用 `search_history`；普通对话 MUST NOT 因默认流程调用该工具。`search_history` MUST 保持单发检索，MUST NOT 作为二次规划触发工具。

#### Scenario: 引用早前对话时规划检索
- **WHEN** 用户引用更早对话中的内容且当前上下文缺少该细节
- **THEN** 规划提示包含该工具，模型可选择调用它以找回逐字上下文

#### Scenario: 普通对话不触发
- **WHEN** 用户普通闲聊且未引用更早对话
- **THEN** 规划提示不诱导调用 search_history
