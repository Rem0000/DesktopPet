## ADDED Requirements

### Requirement: 工具结果内容透传
Agent 运行时在模型节点组装工具结果提示词时，对成功的工具调用 MUST 呈现该工具的真实输出内容（检索 excerpt、历史记录、网页正文、技能真值等），MUST NOT 折叠为无内容的通用成功占位符；失败/取消的工具结果 MUST 保留如实说明与禁止谎报约束。

#### Scenario: 检索引用接地
- **WHEN** search_knowledge 成功返回 excerpt 且模型基于其生成回复
- **THEN** 模型提示词包含该 excerpt，回复引用可逐字取自检索内容

#### Scenario: 技能真值可达模型
- **WHEN** 有状态多轮技能（如猜数字 compare_guess）返回状态/次数
- **THEN** 模型提示词包含该真值，模型不凭记忆编造游戏结果

#### Scenario: 失败结果如实
- **WHEN** 工具失败或被用户取消
- **THEN** 提示词如实说明失败/未执行，禁止假装成功
