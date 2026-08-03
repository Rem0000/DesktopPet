## MODIFIED Requirements

### Requirement: 危险工具确认
风险等级为 confirm 的工具在执行前 MUST 取得用户确认（聊天窗确认 UI 或等价 IPC）；未提供确认回调、用户拒绝、或确认超时 MUST NOT 执行该工具。safe 等级工具可按现有白名单直接执行。

#### Scenario: 确认后执行
- **WHEN** Agent 规划调用 riskLevel=confirm 的工具且用户确认
- **THEN** 系统执行该工具并记录观测事件

#### Scenario: 拒绝则不执行
- **WHEN** 用户拒绝确认
- **THEN** 系统不执行该工具并向对话返回已取消语义

#### Scenario: 超时或无确认通道
- **WHEN** 确认请求超时或聊天窗无法响应确认
- **THEN** 系统 MUST NOT 执行该工具，并记录 ok=false 的观测事件

### Requirement: 检索 IR 离线评测
系统 SHALL 提供带人工标注的检索评测集（覆盖知识库 chunk 与/或记忆条目），本地脚本 MUST 输出 P@K、R@K 与 MRR（K 值在 eval 配置中固定，默认 K=4 或 K=10）。评测 MUST 针对当前实现的单一 Hybrid 管线报告指标，MUST NOT 要求或多方案 A/B 对比实验。默认快速路径可使用 mock Embedding；系统 MUST 提供启用真实 BGE Embedding 的开关，并在文档中区分两种指标含义。

#### Scenario: 运行 IR 评测
- **WHEN** 开发者执行检索 IR 评测命令
- **THEN** 系统输出各 query 的 P@K、R@K、MRR 及汇总均值

#### Scenario: 无对比分支
- **WHEN** 执行 IR 评测
- **THEN** 输出仅包含当前 Hybrid 实现指标，不包含 baseline 对照组或多 pipeline 并排表格

#### Scenario: 真实 Embedding 评测
- **WHEN** 开发者启用真实 Embedding 开关且本地 BGE 权重可用
- **THEN** IR 评测使用真实向量管线输出指标，且输出中可区分该模式

## ADDED Requirements

### Requirement: Confirm 工具功能回归
离线功能评测集 SHALL 覆盖 confirm 级工具「确认后执行」与「拒绝不执行」两类场景，而不仅断言 riskLevel 元数据。

#### Scenario: 评测拒绝路径
- **WHEN** 运行包含 forget_memory（或等价 confirm 工具）且模拟用户拒绝的评测场景
- **THEN** 场景断言工具未执行副作用且观测记录失败/取消语义
