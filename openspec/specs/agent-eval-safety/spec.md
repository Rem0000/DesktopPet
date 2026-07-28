## Purpose

Agent 离线评测与安全兜底：场景化回归、危险工具确认与敏感信息遮罩。

## Requirements

### Requirement: 离线评测集
系统 SHALL 提供可本地运行的评测场景集：功能回归不少于 20 条（覆盖工具调用、记忆一致性、RAG 命中等），并额外提供检索 IR 标注集。每次运行 MUST 输出可读的通过/失败或指标汇总。

#### Scenario: 运行评测脚本
- **WHEN** 开发者执行功能回归评测命令
- **THEN** 系统输出场景总数、通过数与失败场景标识

#### Scenario: IR 与功能评测分离
- **WHEN** 开发者仅执行 IR 评测
- **THEN** 系统运行检索标注集并输出 P@K/R@K/MRR，不替代功能回归 pass/fail 语义

### Requirement: 检索 IR 离线评测
系统 SHALL 提供带人工标注的检索评测集（覆盖知识库 chunk 与/或记忆条目），本地脚本 MUST 输出 P@K、R@K 与 MRR（K 值在 eval 配置中固定，默认 K=4 或 K=10）。评测 MUST 针对当前实现的单一 Hybrid 管线报告指标，MUST NOT 要求或多方案 A/B 对比实验。

#### Scenario: 运行 IR 评测
- **WHEN** 开发者执行检索 IR 评测命令
- **THEN** 系统输出各 query 的 P@K、R@K、MRR 及汇总均值

#### Scenario: 无对比分支
- **WHEN** 执行 IR 评测
- **THEN** 输出仅包含当前 Hybrid 实现指标，不包含 baseline 对照组或多 pipeline 并排表格

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
