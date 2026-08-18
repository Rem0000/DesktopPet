## Why

真实知识库 IR 评测（4 文档 / 292 chunk / 64 查询）基线为 **P@4=0.55, R@10=0.56, MRR@10=0.82, NDCG@10=0.68**：top-1 命中强但覆盖不足、分级排序中等。诊断结论是当前「RRF 融合 + 线性加权」的轻量 Rerank 对次级相关片段排序不佳，且知识库 `vectorScore>=0.55` 后置过滤会把相关但语义分略低的 chunk 提前滤掉——这两处是提升检索质量的主要杠杆。

## What Changes

- **新增可选 cross-encoder Reranker**（`hybrid-retrieval`）：用 `@xenova/transformers` 的 `text-classification` 加载 `bge-reranker-base`（输入 `query [SEP] passage`，输出 sigmoid 分），在 RRF 融合候选后对候选集重排；最终排序在 rerank 生效时以 rerank 分为准。零新增 npm 依赖，模型走本地优先/远程兜底。
- **Rerank 容错**：reranker 模型不可用或单次调用失败时回退现有线性 Rerank 路径，检索不中断。
- **过滤阈值可配置**（`local-rag`）：`KnowledgeStore` 的 `vectorScore >= 0.55` 后置过滤阈值改为构造参数（默认 0.55，行为不变），配合 rerank 可下调以恢复召回。
- **评测 A/B harness**：`run.retrieval.kb.eval.test.ts` 对同一 64 条查询跑 `baseline / +reranker / +reranker+低阈值` 三组并打印 P@4/R@4/R@10/MRR@10/NDCG@10 对比。
- **app 默认不开启**：`enableRerank` 默认 `false`，运行时行为不变；先经评测验证有效后再决定是否默认启用。

## Capabilities

### New Capabilities
<!-- 无新增 capability：reranker 服务作为 hybrid-retrieval 的 Rerank 增强实现 -->

### Modified Capabilities
- `hybrid-retrieval`: 「轻量 Rerank」扩展为「可选 cross-encoder 重排 + 线性重排兜底」；检索结果契约增加可选 rerank 分；过滤阈值改为可配置。
- `local-rag`: 「检索增强回答」中的知识库后置向量分数阈值由硬编码 0.55 改为可配置，且允许在启用 rerank 时下调。

## Impact

- 代码：`electron/retrieval/hybridSearch.ts`、`electron/retrieval/types.ts`、`electron/retrieval/rerankerService.ts`（新建）、`electron/chat/knowledgeStore.ts`、`evals/run.retrieval.kb.eval.test.ts`。
- 依赖：无新增 npm 依赖；需下载 `Xenova/bge-reranker-base`（onnx int8 约 270MB）到 `data/models/bge-reranker-base/`。
- 行为：app 运行时默认不变；评测新增 rerank 配置分支。现有 hybridSearch/knowledgeStore 调用方（记忆、小说书内检索）不受影响（reranker 为可选参数）。
