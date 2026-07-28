## Why

当前记忆与 RAG 检索均为启发式关键词打分（非标准 BM25、无向量召回），召回质量与面试可讲性不足；同时聊天数据、记忆、知识库、工具 trace、向量模型权重等持久化在 Electron `userData`（通常在 C 盘），不利于开发调试、备份与简历演示。秋招前需要将检索链路升级为可量化的 Hybrid 方案，并将运行时数据统一落到项目目录。

## What Changes

- 引入 **Hybrid Retrieval 管线**：BM25（或等价稀疏检索）+ 本地向量召回 + 轻量 Rerank 融合，统一用于长期记忆与知识库 RAG。
- RAG **结构感知切块**：按 Markdown 标题/段落边界切块，保留层级元数据，替代固定 500 字滑动窗口。
- 本地 **Embedding 模型**：**BGE-Small-ZH-v1.5**（`Xenova/bge-small-zh-v1.5`），权重下载并缓存到 `data/models/`；**下载失败时不自动降级**，提示用户手动下载权重。
- **项目内数据根目录**：新增 `resolveDataRoot()`（默认 `<projectRoot>/data/`），迁移 chat、memory、knowledge、traces、logs、models 等；支持 `DESKTOP_PET_DATA` 环境变量覆盖。
- **离线 IR 评测**：新增带标注的检索评测集，输出 P@K、R@K、MRR；**不做** A/B 对比实验或多方案并排 benchmark。
- **BREAKING**：首次启动或升级后，旧 `userData` 数据不会自动迁移；文档说明手动拷贝或重新导入。

## Capabilities

### New Capabilities

- `hybrid-retrieval`: 统一稀疏+向量+重排检索接口，供记忆与 RAG 共用；含融合打分与 top-k 输出契约。
- `project-data-store`: 项目目录下运行时数据根路径解析、子目录约定与环境变量覆盖。

### Modified Capabilities

- `local-rag`: 结构感知切块、向量索引、Hybrid 检索与引用溯源要求升级。
- `agent-memory`: 记忆检索从纯关键词改为 Hybrid；条目向量化与索引生命周期。
- `agent-eval-safety`: 扩展离线评测，增加检索 IR 指标（P@K/R@K/MRR），不含对比实验要求。

## Impact

- **代码**：`electron/projectPaths.ts`、`electron/chat/chatController.ts`、`knowledgeStore.ts`、`memoryService.ts`、`memoryStore.ts`、`toolTraceStore.ts`、新增 `retrieval/` 与 `embedding/` 模块。
- **依赖**：本地 embedding 运行时 `@xenova/transformers` + 模型 **BGE-Small-ZH-v1.5**（`Xenova/bge-small-zh-v1.5`）；可能增加 `better-sqlite3` 或 LanceDB 类向量存储（design 阶段定案）。
- **磁盘**：`data/` 目录（gitignore）；模型权重首次下载约数百 MB。
- **评测**：`evals/` 新增检索标注集与 IR 指标脚本；现有 20 条功能回归保留。
- **文档/简历**：`highlight_resume_pet.md` 可更新 Hybrid RAG 与可量化召回表述。
