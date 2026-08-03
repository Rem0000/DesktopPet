## ADDED Requirements

### Requirement: 关系与记忆隔离
系统 SHALL 将"关系/好感"类信息与长期记忆（profile/fact/commitment）严格隔离：关系状态 MUST 通过关系模块（`update_relationship` 等）读写，MUST NOT 写入记忆库；记忆条目 MUST NOT 被写入关系状态；关系状态 MUST NOT 作为记忆召回结果注入。模型口吻、称呼、输出规范类请求仍按既有规则路由到人设，关系/好感类意图路由到关系模块而非记忆或人设。

#### Scenario: 关系意图不写记忆
- **WHEN** 对话中涉及好感增减或关系变化且 Agent 规划写入
- **THEN** 系统将变更写入关系状态，记忆库条目数与内容不因此改变

#### Scenario: 记忆召回不含关系
- **WHEN** 某次对话触发记忆召回
- **THEN** 召回结果不含任何关系状态条目；关系状态仅经关系层注入

#### Scenario: 口吻类仍走人设
- **WHEN** 用户表达说话方式/称呼/输出规范类偏好
- **THEN** 系统既不写入记忆也不写入关系状态，仍按既有规则引导其编辑人设
