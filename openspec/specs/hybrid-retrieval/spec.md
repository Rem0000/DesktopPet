## Purpose

统一 Hybrid 检索内核：BM25 稀疏 + BGE 向量 + RRF 融合 + 轻量 Rerank；记忆与知识库共用。

## Requirements

### Requirement: 统一 Hybrid 检索接口
系统 SHALL 提供统一的 Hybrid 检索接口，接受查询文本、候选集合类型（memory 或 knowledge）与 top-k 参数，返回按最终融合分排序的结果列表。接口 MUST 组合稀疏检索（BM25 或等价倒排）与稠密向量相似度两路召回，并通过融合策略（如 RRF 或等价可复现公式）产生最终排序。

#### Scenario: 双路召回后融合
- **WHEN** 调用方对知识库或记忆库发起检索且 Embedding 模型与向量索引均已就绪
- **THEN** 系统分别执行稀疏与向量召回，融合后返回不超过 top-k 条结果及可追溯分数元数据

#### Scenario: 模型下载失败不降级
- **WHEN** 首次或后续自动下载 BGE-Small-ZH-v1.5 权重失败
- **THEN** 系统 MUST NOT 自动切换备选模型或降级为纯稀疏检索；MUST 向用户展示可理解的失败原因、`data/models/` 目标路径及手动下载/放置说明，并阻止依赖向量的 Hybrid 检索直至用户完成手动放置并重试加载成功

### Requirement: Embedding 模型加载失败处理
系统 SHALL 在 BGE-Small-ZH-v1.5 权重自动下载或加载失败时，向用户返回明确错误信息，包含模型名称、期望缓存目录（`data/models/`）及手动下载指引。此场景下 MUST NOT 静默降级为纯 BM25、切换其他 Embedding 模型或继续提供完整 Hybrid 检索。

#### Scenario: 手动放置后重试成功
- **WHEN** 用户按指引将权重放入 `data/models/` 并触发重试加载
- **THEN** 系统成功加载模型并恢复向量索引与 Hybrid 检索能力

### Requirement: 轻量 Rerank
系统 SHALL 对融合后的候选集（默认 top-10）执行轻量 Rerank，综合归一化 BM25 分、向量 cosine 分与域内元数据加权（如记忆 pin/importance、RAG heading 匹配）。Rerank MUST 在本地 CPU 可接受延迟内完成，MUST NOT 依赖云端 API。

#### Scenario: 记忆 pin 加权
- **WHEN** 两条记忆条目稀疏与向量分接近且其中一条为 pinned
- **THEN** Rerank 后 pinned 条目排名不低于未 pin 条目（在同等相关语义下）

### Requirement: 检索结果契约
Hybrid 检索返回的每条结果 MUST 包含稳定 id（memoryId 或 chunkId）、原文摘要、最终 score、以及 recall 来源标记（sparse/vector/both）。供 Agent 注入与 UI 溯源使用。

#### Scenario: RAG 命中带来源
- **WHEN** 知识库 Hybrid 检索命中某 chunk
- **THEN** 结果包含 documentId、chunkId、headingPath（若存在）与 score
