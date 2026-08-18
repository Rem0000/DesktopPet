## MODIFIED Requirements

### Requirement: 轻量 Rerank
系统 SHALL 对融合后的候选集（默认 top-10）执行轻量 Rerank，综合归一化 BM25 分、向量 cosine 分与域内元数据加权（如记忆 pin/importance、RAG heading 匹配）。Rerank MUST 在本地 CPU 可接受延迟内完成，MUST NOT 依赖云端 API。
当启用可选 Cross-Encoder Reranker 时，系统 SHALL 先对 RRF 融合后的候选集执行 cross-encoder 打分，最终结果排序 MUST 以 rerank 分为准（而非线性加权分）；reranker 不可用或单次打分失败时 MUST 回退到线性 Rerank，检索 MUST NOT 因此失败。

#### Scenario: 记忆 pin 加权
- **WHEN** 两条记忆条目稀疏与向量分接近且其中一条为 pinned
- **THEN** Rerank 后 pinned 条目排名不低于未 pin 条目（在同等相关语义下）

#### Scenario: Cross-Encoder 重排生效
- **WHEN** 启用 Cross-Encoder Reranker 且候选集的 rerank 分与线性加权分排序不一致
- **THEN** 最终返回顺序跟随 rerank 分降序

#### Scenario: Reranker 失败回退
- **WHEN** Cross-Encoder Reranker 模型不可用或打分抛错
- **THEN** 检索回退到线性 Rerank 结果继续返回，不中断、不报错

## ADDED Requirements

### Requirement: 可选 Cross-Encoder Reranker
系统 SHALL 提供可选的 cross-encoder reranker 服务：通过 `@xenova/transformers` 的 text-classification 任务加载本地或远端 BGE reranker 模型，对 `query [SEP] passage` 打分得到相关性分数。该服务 SHALL 支持本地权重优先加载、远端兜底、加载状态可观测；模型缺失时 SHALL 给出可下载提示，且不阻断未启用 reranker 的既有检索路径。

#### Scenario: 本地权重优先
- **WHEN** `data/models/bge-reranker-base/` 存在本地权重
- **THEN** reranker 以 `local_files_only` 加载本地模型，不访问网络

#### Scenario: 模型缺失提示
- **WHEN** 启用 reranker 但本地权重缺失且远端加载失败
- **THEN** 服务状态置为 error 并输出模型下载路径提示，检索按未启用 reranker 路径运行
