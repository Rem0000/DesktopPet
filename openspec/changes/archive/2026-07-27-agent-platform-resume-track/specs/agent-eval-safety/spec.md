## ADDED Requirements

### Requirement: 离线评测集
系统 SHALL 提供可本地运行的评测场景集（不少于 20 条），覆盖工具调用正确性、记忆一致性与 RAG 命中三类中的至少两类；每次运行 MUST 输出可读的通过/失败汇总。

#### Scenario: 运行评测脚本
- **WHEN** 开发者执行评测命令
- **THEN** 系统输出场景总数、通过数与失败场景标识

### Requirement: 危险工具确认
风险等级为 confirm 的工具在执行前 MUST 取得用户确认（或配置允许的自动确认关闭状态下拒绝执行）；safe 等级工具可按现有白名单直接执行。

#### Scenario: 确认后执行
- **WHEN** Agent 规划调用 riskLevel=confirm 的工具且用户确认
- **THEN** 系统执行该工具并记录观测事件

#### Scenario: 拒绝则不执行
- **WHEN** 用户拒绝确认
- **THEN** 系统不执行该工具并向对话返回已取消语义

### Requirement: 敏感信息遮罩
系统在工具观测日志、时间线详情与评测输出中 MUST 对疑似 API Key、密码等敏感片段进行遮罩；遮罩失败时 MUST 宁可截断也不完整落盘明文密钥。

#### Scenario: 日志遮罩密钥
- **WHEN** 工具入参或错误信息包含疑似密钥模式
- **THEN** 持久化日志与 UI 详情中对应片段被替换为遮罩文本
