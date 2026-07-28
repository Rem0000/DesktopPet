## ADDED Requirements

### Requirement: 跨会话共享用户画像
系统 SHALL 维护一套跨所有聊天会话共享的用户画像与长期记忆，并在任意会话的 Agent 调用中可被召回注入。

#### Scenario: 新会话仍能使用画像
- **WHEN** 用户新建会话并发出与已知偏好相关的问题
- **THEN** Agent 上下文中包含共享用户画像中的相关 preference/profile 条目

#### Scenario: 画像更新对后续会话生效
- **WHEN** 用户画像中某 preference 被更新
- **THEN** 之后任意会话的召回结果反映更新后的内容

### Requirement: 长期记忆条目管理
系统 SHALL 支持类型为 profile、preference、fact、commitment、episode 的记忆条目，并按规则写入、更新、过期与删除。

#### Scenario: 画像类按 key 覆盖
- **WHEN** 写入带相同 key 的 profile 或 preference 条目
- **THEN** 系统覆盖该 key 的旧内容并更新 updatedAt

#### Scenario: 事实类追加
- **WHEN** 写入无冲突 key 的 fact 或 commitment
- **THEN** 系统追加新条目并保留来源会话与消息引用

#### Scenario: 过期约定不注入
- **WHEN** commitment 条目已超过 expiresAt
- **THEN** 召回阶段 MUST NOT 将该条目注入模型上下文

### Requirement: 记忆召回注入
系统 SHALL 在每次模型调用前召回相关长期记忆，并与角色提示、会话摘要、近期对话一并组装进上下文，且受统一字符/token 预算约束。

#### Scenario: 高重要性画像优先注入
- **WHEN** 存在 importance 较高的 profile/preference 条目
- **THEN** 系统优先将其纳入长期记忆上下文块，再按相关性补充其他条目

#### Scenario: 预算不足时裁剪
- **WHEN** 组装后的上下文超过配置预算
- **THEN** 系统保留角色提示与当前用户消息，并按优先级裁剪情景片段与较早摘要内容

### Requirement: Agent 记忆工具
系统 SHALL 向 Agent 提供白名单记忆工具 remember_preference、update_profile、remember_fact、forget_memory，并在写入前执行安全校验。每次聊天请求 SHALL 在回复前由 Provider 规划是否调用这些工具（对话自动写记忆）；若规划失败 MUST NOT 阻断正常回复。

#### Scenario: 通过工具记住偏好
- **WHEN** 用户明确表达偏好且 Agent 调用 remember_preference
- **THEN** 系统将偏好写入共享长期记忆并可在后续召回中使用

#### Scenario: 对话自动规划写入
- **WHEN** 用户在普通聊天中明确表达应长期记住的偏好或画像，且未手动传入 pendingToolCalls
- **THEN** 系统在流式回复前调用 planToolCalls，并在模型选择工具时执行写入

#### Scenario: 拒绝敏感写入
- **WHEN** 工具试图写入疑似 API Key、密码或其他敏感机密
- **THEN** 系统拒绝写入并返回可理解的失败原因

### Requirement: 用户可编辑记忆
系统 SHALL 提供查看、编辑、删除与清空长期记忆的界面或 IPC 能力，使用户可纠正错误记忆。

#### Scenario: 用户删除错误记忆
- **WHEN** 用户删除某条长期记忆
- **THEN** 该条目立即从存储移除，且后续召回不再注入

#### Scenario: 用户清空记忆
- **WHEN** 用户确认清空全部长期记忆
- **THEN** 系统删除所有长期记忆条目，但保留聊天会话消息除非用户另行删除

### Requirement: 会话摘要压缩
当会话历史超过上下文预算时，系统 SHALL 生成或更新会话摘要以覆盖早期轮次，并仅将摘要与近期原文注入模型。

#### Scenario: 超预算触发摘要
- **WHEN** 会话完整历史将超出配置的上下文预算
- **THEN** 系统为早期轮次维护摘要，并在后续调用中注入该摘要而非全部早期原文
