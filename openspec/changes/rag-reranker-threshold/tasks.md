## 1. Reranker 服务

- [x] 1.1 在 `electron/retrieval/types.ts` 增加 `BGE_RERANKER_MODEL_ID` / `BGE_RERANKER_LOCAL_DIR` / `buildRerankerManualDownloadHint`
- [x] 1.2 新建 `electron/retrieval/rerankerService.ts`：单例 `pipelinePromise` + 状态机（idle/loading/ready/error），镜像 `embeddingService.ts`（本地权重优先、`local_files_only`、sharp stub、远程兜底）
- [x] 1.3 实现 `ensureRerankerModelLoaded()` / `getRerankerModelStatus()` / `resetRerankerServiceForTests()` / `setRerankerPipelineForTests()`
- [x] 1.4 实现 `rerank(query, items: {id,text}[], topK)`：分批（每批 8）`AutoTokenizer + AutoModel` 加载 `Xenova/bge-reranker-base`，输入 `query [SEP] text`（`text_pair`），取 logit 手动 sigmoid 分降序截 topK
- [x] 1.5 新建 `electron/retrieval/rerankerService.test.ts`（mock pipeline：分批调用、topK 截断、加载失败 error 状态）

## 2. hybridSearch 集成

- [x] 2.1 `electron/retrieval/types.ts`：`HybridSearchResult` 加 `rerankScore?: number`；`HybridSearchOptions` 加 `reranker?: (query, candidates: {id,text}[]) => Promise<{id, score}[]>`（可选）
- [x] 2.2 `electron/retrieval/hybridSearch.ts`：results 构建后，若 `options.reranker` 存在则对 `results.map(({id,text}))` 打分并写回 `rerankScore`；抛错时清空 rerankScore 回退线性
- [x] 2.3 `electron/retrieval/hybridSearch.ts`：有 rerankScore 时按 `rerankScore>0` 过滤 + rerankScore 降序 + slice topK；否则走原线性路径（minScore/sparse/vector 门）
- [x] 2.4 `electron/retrieval/hybridSearch.test.ts` 增补：fake reranker（反转顺序）断言最终顺序跟随 rerank；无 reranker 行为不变

## 3. KnowledgeStore 可配置

- [x] 3.1 `electron/chat/knowledgeStore.ts` 构造加 `options: { enableRerank?: boolean; vectorScoreThreshold?: number; rerankTopK?: number }`，默认 `false / 0.55 / 20`，现状行为不变
- [x] 3.2 `search` 在 `enableRerank` 时注入 `reranker: (q, c) => rerankService.rerank(q, c, rerankTopK)`；后置过滤硬编码 `0.55` 换成 `options.vectorScoreThreshold`
- [x] 3.3 回归：knowledgeStore / chatController 现有测试在默认构造下行为不变

## 4. 评测 A/B

- [x] 4.1 `evals/run.retrieval.kb.eval.test.ts` 抽 `runConfig(label, store)` 跑 64 查询返回 summary
- [x] 4.2 开始先 `ensureRerankerModelLoaded()`；失败打印 `[retrieval-kb-eval] reranker 模型不可用...` 并只跑 baseline、不 fail
- [x] 4.3 三配置对比打印：baseline（默认）/ `+reranker`（enableRerank, vectorScoreThreshold 0.2, rerankTopK 20）/ `+reranker 阈值0.35`（vectorScoreThreshold 0.35）
- [x] 4.4 输出 P@4 / R@4 / R@10 / MRR@10 / NDCG@10 三组对比

## 5. 验证

- [x] 5.1 `npx tsc -p tsconfig.node.json --noEmit` 通过
- [x] 5.2 `npm test -- electron/retrieval/hybridSearch.test.ts electron/retrieval/rerankerService.test.ts` 通过（mock，不触网）
- [x] 5.3 `npm run eval:retrieval:kb -- --reporter=verbose`：本地 bge-reranker-base 生效，三组对比全指标提升 —— baseline P@4=0.546/R@4=0.427/R@10=0.556/MRR@10=0.820/NDCG@10=0.677 → +reranker(阈值0.2) P@4=0.574/R@4=0.454/R@10=0.585/MRR@10=0.880/NDCG@10=0.741 → 阈值0.35 NDCG=0.742；阈值 0.2/0.35 差异可忽略
  - **决策（2026-08-18）**：评测全指标提升，但实测 rerank 开启 ~1.3s/次检索（vs baseline ~46ms），app **默认关闭**、保留可选项；chatController 不改，延迟优化（候选池/批处理/缓存）后再议。
