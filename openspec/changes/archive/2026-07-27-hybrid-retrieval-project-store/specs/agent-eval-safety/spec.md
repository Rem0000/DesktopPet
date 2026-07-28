## ADDED Requirements

### Requirement: 检索 IR 离线评测
系统 SHALL 提供带人工标注的检索评测集（覆盖知识库 chunk 与/或记忆条目），本地脚本 MUST 输出 P@K、R@K 与 MRR（K 值在 eval 配置中固定，默认 K=4 或 K=10）。评测 MUST 针对当前实现的单一 Hybrid 管线报告指标，MUST NOT 要求或多方案 A/B 对比实验。

#### Scenario: 运行 IR 评测
- **WHEN** 开发者执行检索 IR 评测命令
- **THEN** 系统输出各 query 的 P@K、R@K、MRR 及汇总均值

#### Scenario: 无对比分支
- **WHEN** 执行 IR 评测
- **THEN** 输出仅包含当前 Hybrid 实现指标，不包含 baseline 对照组或多 pipeline 并排表格

## MODIFIED Requirements

### Requirement: 离线评测集
系统 SHALL 提供可本地运行的评测场景集：功能回归不少于 20 条（覆盖工具调用、记忆一致性、RAG 命中等），并额外提供检索 IR 标注集。每次运行 MUST 输出可读的通过/失败或指标汇总。

#### Scenario: 运行评测脚本
- **WHEN** 开发者执行功能回归评测命令
- **THEN** 系统输出场景总数、通过数与失败场景标识

#### Scenario: IR 与功能评测分离
- **WHEN** 开发者仅执行 IR 评测
- **THEN** 系统运行检索标注集并输出 P@K/R@K/MRR，不替代功能回归 pass/fail 语义
