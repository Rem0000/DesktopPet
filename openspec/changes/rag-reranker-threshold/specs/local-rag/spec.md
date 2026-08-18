## MODIFIED Requirements

### Requirement: 检索增强回答
系统 SHALL 通过 Hybrid 检索（稀疏 + 向量 + 轻量 Rerank，可选启用 Cross-Encoder Reranker 重排）获取 top-k 相关片段并提供给 Agent；无命中时 MUST 明确可观测的空结果，MUST NOT 捏造文档内容。检索 MUST 使用 `data/knowledge/` 下的索引与 `data/models/` 下的 Embedding 权重。知识库检索的后置向量分数过滤阈值 SHALL 可配置（默认 0.55，行为与现有一致）；启用 Cross-Encoder Reranker 时 SHALL 允许下调该阈值以恢复被过早过滤的相关片段。

#### Scenario: 命中后增强
- **WHEN** 用户问题与某文档片段语义相关且 Hybrid 检索命中
- **THEN** Agent 可基于该片段生成回答，并附带 documentId、chunkId、headingPath 等溯源元数据

#### Scenario: 未命中
- **WHEN** 知识库为空或查询无关
- **THEN** 检索返回空列表，回复不声称引用了不存在的本地文档

#### Scenario: 阈值可配置
- **WHEN** 调用方以非默认的向量分数阈值构造知识库存储（如启用 reranker 时下调阈值）
- **THEN** 后置过滤按该阈值执行，且默认构造行为与既有实现一致
