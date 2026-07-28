## 1. 项目数据目录

- [x] 1.1 在 `electron/projectPaths.ts` 新增 `resolveDataRoot()` 与子路径 helper（chat/memory/knowledge/traces/logs/models/reminders/config）
- [x] 1.2 将 `chatController.ts` 中 ChatStore、MemoryStore、KnowledgeStore、ToolTraceStore、ReminderStore、tool-config 改为使用 data 根目录
- [x] 1.3 配置 `app.setPath('logs', ...)` 指向 `data/logs/`（若可行）
- [x] 1.4 更新 `.gitignore` 忽略 `data/`；README 补充数据位置、userData 手动迁移说明，以及 **BGE-Small-ZH-v1.5 模型手动下载/放置** 说明（含 `data/models/` 路径）

## 2. Embedding 与向量基础设施

- [x] 2.1 添加 `@xenova/transformers` 依赖，实现 `electron/retrieval/embeddingService.ts`，加载 **BGE-Small-ZH-v1.5**（`Xenova/bge-small-zh-v1.5`），权重缓存至 `data/models/`
- [x] 2.2 实现向量存储层（SQLite+vec 或 JSON 分片 MVP）及 cosine 检索 API
- [x] 2.3 实现启动时模型加载；**下载/加载失败时向用户展示错误与手动下载指引，不自动降级**；IPC/日志可观测

## 3. Hybrid 检索内核

- [x] 3.1 实现 BM25 稀疏索引（含 CJK n-gram tokenization 增强）
- [x] 3.2 实现 RRF 融合与轻量线性 Rerank（α/β/γ 可配置常量）
- [x] 3.3 导出统一 `hybridSearch(query, corpus, topK)` 接口及结果契约类型
- [x] 3.4 为 Hybrid 检索添加单元测试；覆盖 **模型下载失败时不降级、返回/展示错误** 的行为

## 4. RAG 升级

- [x] 4.1 实现 Markdown 结构感知切块（headingPath、段内二次切分与 overlap）
- [x] 4.2 重构 `knowledgeStore.ts`：双索引写入/删除、导入与重建索引 IPC
- [x] 4.3 将 `search_knowledge` 工具与 Agent 注入改为 Hybrid 检索，保留 citations 溯源字段
- [x] 4.4 更新知识库 UI：展示 headingPath；提供「重建索引」操作（可选进度）

## 5. 记忆 Hybrid 检索

- [x] 5.1 记忆写入/更新/删除时同步向量 upsert/delete
- [x] 5.2 重构 `memoryService.ts` 的 `retrieveMemories` 使用 Hybrid 内核（保留 pin/importance/衰减加权）
- [x] 5.3 启动一致性校验与记忆向量全量重建命令/IPC

## 6. 离线 IR 评测（无 A/B）

- [x] 6.1 新增 `evals/retrieval/` 标注 JSON（知识库 + 记忆 query/relevant_ids，≥15 条）
- [x] 6.2 实现 `evals/run.retrieval.eval.test.ts` 输出 P@4、R@4、MRR@10 汇总
- [x] 6.3 在 package.json 添加 `eval:retrieval` 脚本；确认不生成多 pipeline 对比报告

## 7. 集成与文档

- [x] 7.1 端到端验证：导入 `docs/rag-demo.md`、Hybrid 检索命中、trace 持久化于 `data/traces/`
- [x] 7.2 更新 `highlight_resume_pet.md` 与 `docs/interview-demo-3min.md` 中的 RAG/数据目录表述
- [x] 7.3 运行现有功能 eval + 新 IR eval，修复回归
