## Context

检索内核 `electron/retrieval/hybridSearch.ts` 当前流程：BM25 稀疏 + BGE 向量双路召回 → RRF 融合 → 线性加权打分（`0.35*sparse + 0.55*vector + 0.1*metadata`）→ `score>=minScore && (sparse>0 || vector>=0.2)` 过滤 → 排序截 topK。知识库 `electron/chat/knowledgeStore.ts` 在 hybridSearch 之上还有一道 `vectorScore>=0.55` 后置过滤。

真实知识库评测基线（4 文档 / 292 chunk / 64 查询）：**P@4=0.55, R@10=0.56, MRR@10=0.82, NDCG@10=0.68**。诊断：MRR 高（top-1 准）但 R@10/NDCG 中等——线性重排对次级相关片段排序不佳，0.55 后置过滤提前滤掉语义分略低的相关片段。

约束：零新增 npm 依赖；不动切块（`docId:index` 标签会漂移）；不换向量库（原生依赖打包风险，自研 HNSW 在 eval:ann recall≥0.9）；app 运行时行为默认不变。

## Goals / Non-Goals

**Goals:**
- 在 RRF 候选后加入可选 cross-encoder reranker，用 rerank 分重排，提升 NDCG/MRR。
- 让知识库向量分数后置阈值可配置，配合 rerank 下调以恢复 R@10。
- 提供评测 A/B harness，同一 64 条查询对比 baseline / +reranker / +reranker+低阈值。

**Non-Goals:**
- 不改切块策略、不换 LanceDB（在提案中已排除）。
- 不默认开启 reranker（先经评测验证；app 行为不变）。
- 不做多路 reranker 或候选池超参大规模调优。

## Decisions

**D1：用 `@xenova/transformers` 的 `text-classification` 加载 bge-reranker-base 实现重排。**
`@xenova/transformers` 2.17.2 无 `rerank` 任务，但 bge-reranker-base 是 cross-encoder，`pipeline('text-classification')` 输入 `query [SEP] passage` 可输出 sigmoid 相关分。零新增依赖，复用 embeddingService 的本地优先/远程兜底/手动提示模式。
- 备选：`bge-reranker-v2-m3`（更大更准但 568M 参数）→ 体积过大；自研交叉注意力打分 → 不可行。

**D2：reranker 以注入式回调挂在 `HybridSearchOptions.reranker`，而非硬编码进 hybridSearch。**
可选参数，现有调用方（记忆 `retrieveMemories`、小说书内检索）零改动；评测可用 fake 注入 A/B，测试可用 fake 验证排序。

**D3：rerank 生效时最终排序/过滤以 rerank 分为准，失败回退线性路径。**
hybridSearch 在 results 构建后调用 reranker，把分数写回 `rerankScore`；存在 rerankScore 则 `.filter(rerankScore>0)` + 按 rerankScore 降序，否则走原线性逻辑。rerank 调用抛错时清空 rerankScore 走线性——检索不中断。
- 备选：rerank 失败直接抛错 → 会拖垮正常检索，否。

**D4：知识库 0.55 后置阈值改为构造参数，默认值不变。**
`new KnowledgeStore(kbDir, { enableRerank?, vectorScoreThreshold?, rerankTopK? })`，默认 `false / 0.55 / 20`。评测 rerank 配置显式传低阈值（0.2/0.35）+ `enableRerank: true`。

**D5：评测跑三配置对比，reranker 模型不可用只跑 baseline 不 fail。**
`run.retrieval.kb.eval.test.ts` 先 `ensureRerankerModelLoaded()`，失败打印提示跳过 rerank 配置；避免「rerank 静默回退导致 B/C 与 baseline 相同」的误导。

## Risks / Trade-offs

- **模型下载体积（~270MB）** → 首次评测触发下载；提供 `huggingface-cli download` 手动路径；下载失败只跑 baseline 并打印手动提示。
- **rerank 延迟**（20 候选 = 20 次 cross-encoder 前向，CPU 数百 ms）→ app 默认关闭；仅评测开启；若验证有效再评估默认启用。
- **rerank 分过滤可能放行低质量候选** → 用 `rerankScore>0` 作最小门（sigmoid 接近 0 的视为不相关）；配合阈值 A/B 观察 P@4 是否下滑。
- **0.55→低阈值可能提升 R@10 但拉低 P@4** → 评测三配置对比，诚实汇报权衡，不强行断言全指标提升。

## Migration Plan

1. 新建 `rerankerService.ts` + 单测（mock pipeline）；2. 扩展 types/hybridSearch（rerank 注入 + 排序分支）；3. `knowledgeStore` 构造参数；4. 评测 A/B；5. 用户跑 `npm run eval:retrieval:kb -- --reporter=verbose` 下载模型并看三组对比。回滚：`enableRerank` 默认 false，删改即回退，无数据迁移。

## Open Questions

- 若 reranker 有效，是否 app 默认开启？（待评测数据后再定）
- rerankTopK 是否随启用自动提到 20，还是保持 10？（当前设计：启用时 eval 显式传 20）
