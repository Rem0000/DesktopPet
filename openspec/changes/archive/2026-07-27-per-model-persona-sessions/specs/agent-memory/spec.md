## MODIFIED Requirements

### Requirement: 跨会话共享用户画像
系统 SHALL 维护一套跨所有聊天会话与所有 Live2D 模型共享的用户画像（profile）与事实类记忆（fact/commitment），并在任意模型的 Agent 调用中可被召回注入。模型口吻、称呼方式、输出规范等个性化要求 MUST NOT 作为全局 preference 存储，而 SHALL 由该模型人设文件表达。

#### Scenario: 新会话仍能使用画像
- **WHEN** 用户在新模型或新会话中发出与已知画像相关的问题
- **THEN** Agent 上下文中包含共享用户画像中的相关 profile 条目

#### Scenario: 画像更新对后续模型生效
- **WHEN** 用户画像中某 profile 字段被更新
- **THEN** 之后任意 Live2D 模型会话的召回结果反映更新后的内容

#### Scenario: 跨模型共享事实约定
- **WHEN** 用户在模型 A 的对话中写入一条 fact 或未过期的 commitment（例如稍后提醒喝水）
- **THEN** 切换到模型 B 后的召回仍可包含该条目（主动到点通知不在本需求范围）

### Requirement: 长期记忆条目管理
系统 SHALL 支持类型为 profile、fact、commitment、episode 的记忆条目，并按规则写入、更新、过期与删除。系统 MUST NOT 再将 preference 作为可写入的长期记忆类型；既有 preference 条目 MUST NOT 再注入召回上下文。

#### Scenario: 画像类按 key 覆盖
- **WHEN** 写入带相同 key 的 profile 条目
- **THEN** 系统覆盖该 key 的旧内容并更新 updatedAt

#### Scenario: 事实类追加
- **WHEN** 写入 fact 或 commitment
- **THEN** 系统追加新条目并保留来源会话与消息引用

#### Scenario: 过期约定不注入
- **WHEN** commitment 条目已超过 expiresAt
- **THEN** 召回阶段 MUST NOT 将该条目注入模型上下文

### Requirement: 记忆召回注入
系统 SHALL 在每次模型调用前召回相关长期记忆，并与当前模型人设（或默认提示）、会话摘要、近期对话一并组装进上下文，且受统一字符/token 预算约束。召回 MUST 包含共享 profile 与相关 fact/commitment，且 MUST NOT 注入 preference。

#### Scenario: 高重要性画像优先注入
- **WHEN** 存在 importance 较高的 profile 条目
- **THEN** 系统优先将其纳入长期记忆上下文块，再按相关性补充其他 fact/commitment 条目

#### Scenario: 预算不足时裁剪
- **WHEN** 组装后的上下文超过配置预算
- **THEN** 系统保留角色提示与当前用户消息，并按优先级裁剪情景片段与较早摘要内容

### Requirement: Agent 记忆工具
系统 SHALL 向 Agent 提供白名单记忆工具 update_profile、remember_fact、forget_memory，并在写入前执行安全校验。系统 MUST NOT 提供 remember_preference。每次聊天请求 SHALL 在回复前由 Provider 规划是否调用这些工具（对话自动写记忆）；若规划失败 MUST NOT 阻断正常回复。当用户要求的是角色口吻或输出规范时，系统 SHALL 提示应写入人设而非记忆库。

#### Scenario: 通过工具更新画像
- **WHEN** 用户明确表达身份类信息且 Agent 调用 update_profile
- **THEN** 系统将画像写入共享长期记忆并可在后续任意模型召回中使用

#### Scenario: 通过工具记住事实
- **WHEN** 用户明确表达可跨模型共享的事实或约定且 Agent 调用 remember_fact
- **THEN** 系统写入共享 fact/commitment 并可在后续召回中使用

#### Scenario: 对话自动规划写入
- **WHEN** 用户在普通聊天中明确表达应长期记住的画像或事实，且未手动传入 pendingToolCalls
- **THEN** 系统在流式回复前调用 planToolCalls，并在模型选择工具时执行写入

#### Scenario: 拒绝敏感写入
- **WHEN** 工具试图写入疑似 API Key、密码或其他敏感机密
- **THEN** 系统拒绝写入并返回可理解的失败原因
