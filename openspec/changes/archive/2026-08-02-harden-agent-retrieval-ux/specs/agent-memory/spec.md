## MODIFIED Requirements

### Requirement: Agent 记忆工具
系统 SHALL 向 Agent 提供白名单记忆工具 update_profile、remember_fact、forget_memory，并在写入前执行安全校验。系统 MUST NOT 提供 remember_preference。`forget_memory` MUST 标记为 riskLevel=`confirm`，执行前须经用户确认。每次聊天请求 SHALL 在回复前由 Provider 规划是否调用这些工具（对话自动写记忆）；若规划失败 MUST NOT 阻断正常回复，但 MUST 产生可观测失败信号。当用户要求的是角色口吻或输出规范时，系统 SHALL 提示应写入人设而非记忆库。

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

#### Scenario: 遗忘需确认
- **WHEN** Agent 规划调用 forget_memory 且用户未确认
- **THEN** 系统 MUST NOT 删除对应记忆条目
