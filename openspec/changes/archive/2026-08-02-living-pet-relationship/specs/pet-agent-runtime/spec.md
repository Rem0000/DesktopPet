## ADDED Requirements

### Requirement: 关系感知的系统提示词组装
Agent 每次模型调用 SHALL 在现有 persona（或默认系统提示）基础上并入关系层——关系块（按 policy 渲染）与已生效演化覆盖——作为角色约束的组成部分。关系层 MUST 由 `MemoryService.assemble` 在 recall 阶段统一注入，MUST NOT 引入新图节点、新工具或改变现有工具白名单边界。

#### Scenario: 带关系层回复
- **WHEN** 某包存在关系状态且用户发送消息
- **THEN** Agent 组装出的角色提示包含 persona 与关系层，回复反映该关系层的语气与私密度约束

#### Scenario: 人设缺失仍并入关系层
- **WHEN** 某包无 persona 但存在关系状态
- **THEN** 默认系统提示仍与关系层一并注入，Agent 行为由默认角色 + 关系约束共同决定
