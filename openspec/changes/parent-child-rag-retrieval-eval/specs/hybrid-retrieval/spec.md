## MODIFIED Requirements

### Requirement: 统一 Hybrid 检索接口
系统 SHALL 提供统一的 Hybrid 检索接口，接受查询文本、候选集合类型（memory 或 knowledge）与 top-k 参数，返回按最终融合分排序的结果列表。接口 MUST 组合稀疏检索（BM25 或等价倒排）与稠密向量相似度两路召回，并通过融合策略（如 RRF 或等价可复现公式）产生最终排序。对于 knowledge 集合，Hybrid 检索 MUST 以子块作为稀疏/向量/Rerank 候选单元，以父块作为最终返回单元，并在应用 top-k 前按父块去重；对于 memory 集合，既有单层结果行为保持不变。

#### Scenario: 双路召回后融合
- **WHEN** 调用方对知识库或记忆库发起检索且 Embedding 模型与向量索引均已就绪
- **THEN** 系统分别执行稀疏与向量召回并融合；知识库结果按最佳命中子块映射为不超过 top-k 条去重父块，记忆结果返回既有单层条目，二者均附带可追溯分数元数据

#### Scenario: 模型下载失败不降级
- **WHEN** 首次或后续自动下载 BGE-Small-ZH-v1.5 权重失败
- **THEN** 系统 MUST NOT 自动切换备选模型或降级为纯稀疏检索；MUST 向用户展示可理解的失败原因、`data/models/` 目标路径及手动下载/放置说明，并阻止依赖向量的 Hybrid 检索直至用户完成手动放置并重试加载成功

### Requirement: 检索结果契约
Hybrid 检索返回的每条结果 MUST 包含稳定 id、原文摘要、最终 score、以及 recall 来源标记（sparse/vector/both）。对于知识库结果，稳定返回 id MUST 标识被召回的父块，并且结果 MUST 包含 `documentId`、父块 ID、命中的子块 ID、父块正文、子块命中偏移、`headingPath`（若存在）与 score；子块命中信息 MUST 可用于精确溯源。对于记忆结果，稳定 id 继续为 memoryId。供 Agent 注入与 UI 溯源使用。

#### Scenario: RAG 子块命中带父块来源
- **WHEN** 知识库 Hybrid 检索命中某子块
- **THEN** 结果包含该子块的 documentId、childChunkId、parentChunkId、父块正文、headingPath（若存在）与 score，且稳定返回 id 与父块一致

#### Scenario: 父块去重保持精确证据
- **WHEN** 同一个 parentChunkId 下有多个子块在融合候选中命中
- **THEN** 返回列表中该父块仅保留一次，并携带最终排序最高的子块 ID、偏移、recall 来源和分数作为命中证据
