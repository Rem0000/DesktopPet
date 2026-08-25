# Proposal: source-evidence retrieval benchmark

## Why

现有检索评测把 gold label 写成 `documentAlias:chunkIndex`。替换 Markdown chunker 后，文档内容不变但 chunk 边界和编号变化，测试集必须重写，无法进行可比的 A/B 实验。

## What Changes

- 固定四份带 SHA-256 校验的知识库源文档。
- 用 64 条现有查询和 88 个原文 evidence 锚点构成版本化数据集。
- 运行时通过当前 `KnowledgeStore` 动态切分，再按规范化原文锚点映射到 chunk。
- 以 evidence 去重计算 Recall@10、Required Evidence Recall@10 和 Required Evidence MRR@10。
- 单 chunk 完整包含 anchor 才算映射；未映射 evidence 单独报告，保留在 Recall 分母且不给 MRR credit。
- 删除旧的 chunk-ID 检索数据、生成器和评测脚本。
- 真实知识库 faithfulness 评测改用同一冻结语料和 evidence 数据集。

## Scope

本变更只影响评测数据、评测辅助代码、评测命令和文档，不改变生产检索排序或 chunker 实现。