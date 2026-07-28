## MODIFIED Requirements

### Requirement: 可检索记忆召回
系统 SHALL 通过 Hybrid 检索（稀疏 BM25 + 向量相似度 + 轻量 Rerank）对 profile/fact/commitment 等条目打分，并结合 pin、importance、时间衰减等因素返回 top-k 结果。召回阶段 MUST 优先使用 Hybrid 检索结果，而不是仅按写入顺序截取列表。记忆向量索引 MUST 存放在项目 data 目录（`data/memory/` 或约定子路径）。

#### Scenario: 按主题检索事实
- **WHEN** 用户消息涉及已知事实主题且记忆库中存在语义相关条目
- **THEN** 召回结果优先包含与该主题相关的 fact/commitment，而非无关条目

#### Scenario: 空查询回退
- **WHEN** 检索查询为空或无法提取有效关键词
- **THEN** 系统回退到基于 important/pinned 的默认召回策略

## ADDED Requirements

### Requirement: 记忆向量同步
系统 SHALL 在记忆条目创建、更新或删除时同步 upsert 或删除对应向量记录；启动时 MUST 检测向量索引与 JSON 存储一致性，必要时支持全量重建。

#### Scenario: 写入后向量可检
- **WHEN** 通过工具或 UI 写入新 fact 且 Embedding 可用
- **THEN** 该条目在后续 Hybrid 记忆检索中可被语义召回

#### Scenario: 删除后向量移除
- **WHEN** 用户删除某记忆条目
- **THEN** 对应向量记录从索引移除且不再参与检索
