## Context

DesktopPet 当前将 chat、memory、knowledge、agent-traces 等写入 Electron `app.getPath('userData')`（Windows 上通常在 `%APPDATA%`，即 C 盘）。记忆与 RAG 检索均为自定义关键词/n-gram 打分，无向量索引，切块为固定 500 字滑动窗口。项目已有 `resolveProjectRoot()` 与 `layer-packs/` 先例，适合将运行时数据迁至项目目录。

约束：4060 8GB GPU（TTS 已搁置）；开发环境 Python 使用 `D:\PythonEnv\agent`；秋招演示需可讲清 Hybrid RAG 与 IR 指标，但用户明确**不需要 A/B 对比实验**。

## Goals / Non-Goals

**Goals:**

- 统一 Hybrid Retrieval：稀疏（BM25）+ 稠密向量 + 融合/轻量 Rerank，记忆与 RAG 共用检索内核。
- RAG 结构感知切块（Markdown 标题/段落边界），保留 heading 路径元数据。
- 本地 Embedding 模型权重与向量索引、业务 JSON/SQLite 数据均落在 `<projectRoot>/data/`（可 `DESKTOP_PET_DATA` 覆盖）。
- 离线检索评测集输出 P@K、R@K、MRR；保留现有功能回归 eval。
- 首次启动在新数据根创建目录；README 说明从旧 userData 手动迁移。

**Non-Goals:**

- A/B 或多方案并排对比实验、线上实验框架。
- 自动从 userData 一键迁移（可选手动文档步骤，非程序强制）。
- 云端向量库、多用户权限、分布式索引。
- Cross-encoder 大模型 Rerank（4060 资源留给 Live2D/聊天主链路）。
- 记忆/RAG 合并为单一库（仍分库，仅检索算法统一）。

## Decisions

### 1. 数据根目录布局

**决策**：新增 `resolveDataRoot()` → `process.env.DESKTOP_PET_DATA || path.join(resolveProjectRoot(), 'data')`。

**子目录约定**：

| 路径 | 用途 |
|------|------|
| `data/chat/` | ChatStore 会话与消息 |
| `data/memory/` | MemoryStore JSON |
| `data/knowledge/` | 源文档、`index.json`、向量分片 |
| `data/traces/` | tool trace JSONL |
| `data/logs/` | 应用日志（替代默认 logs 路径） |
| `data/models/` | Embedding ONNX/weights 缓存 |
| `data/reminders/` | ReminderStore |
| `data/config/` | tool-config.json 等 |

**理由**：与 `layer-packs/` 模式一致，便于 gitignore、备份与面试演示「打开项目即见数据」。

**备选**：继续 userData + 符号链接 → 跨机器路径不稳定，放弃。

### 2. Embedding 运行时

**决策**：Node 侧使用 `@xenova/transformers`，模型 **`Xenova/bge-small-zh-v1.5`**（BGE-Small-ZH-v1.5，中文检索优化、体积适中），缓存目录 `data/models/`。

**理由**：中文 RAG/记忆场景为主，BGE-Small-ZH 在中文语义检索上更合适；纯 JS/WASM，与 Electron 主进程集成简单；无需 Python 子进程维护 embedding 服务。

**备选**：`Xenova/paraphrase-multilingual-MiniLM-L12-v2`（中英兼顾但中文检索偏弱）；Python sentence-transformers 子进程 → 部署复杂；OpenAI Embedding API → 离线/demo 不稳定。

**模型下载失败策略**：自动下载 **BGE-Small-ZH-v1.5** 失败时，**MUST NOT** 自动切换备选模型、回退纯 BM25 或其他隐式降级；**SHALL** 向用户展示明确错误，说明目标路径 `data/models/` 及手动下载/放置权重的步骤，由用户完成后再重试加载。

### 3. 向量存储

**决策**：SQLite + `sqlite-vec` 扩展（或 fallback：`vectors.json` 分片 + 内存 cosine，文档条目 <5000 时可接受）。

**表设计（概念）**：`chunks(id, document_id, content, heading_path, sparse_doc_freq...)` + `embeddings(chunk_id, vector BLOB)`；记忆条目同理 `memory_embeddings(memory_id, vector)`。

**理由**：单文件、可拷贝、与项目 data 目录共存；规模适合个人桌面 pet。

### 4. BM25 稀疏检索

**决策**：引入轻量 BM25 实现（如 `wink-bm25-text-search` 或自研 inverted index），对 chunk/记忆文本建索引；保留现有 CJK n-gram 作为中文 fallback tokenization 增强。

**理由**：面试可称「标准 BM25 + 中文 n-gram 增强」，区别于当前启发式 TF。

### 5. Hybrid 融合与 Rerank

**决策**：

1. 稀疏 top-20 + 向量 top-20 各自召回。
2. **RRF**（Reciprocal Rank Fusion, k=60）合并为候选 top-10。
3. **轻量 Rerank**：对 top-10 用 `(α * norm_bm25 + β * cosine + γ * metadata_boost)` 线性融合；metadata 含 heading 匹配、pin、importance（记忆侧）。

**理由**：RRF 无需标定训练数据；线性 rerank 可解释、CPU 友好；用户不要 A/B，单一融合公式即可。

**备选**：Cross-encoder rerank → 延迟与显存成本高。

### 6. 结构感知切块

**决策**：Markdown 按 `#`/`##`/`###` 分段；段内超 800 字再按段落/句子二次切，overlap 80；每块存 `headingPath: string[]`（如 `["秋招路线", "P0 工具平台"]`）。

**理由**：简历/演示文档本身有标题结构，固定 500 字易切断语义单元。

### 7. 记忆向量化生命周期

**决策**：写入/更新/删除 memory item 时同步 upsert/delete 向量；启动时校验 index 版本，缺失则全量重建。

### 8. IR 评测（无 A/B）

**决策**：`evals/retrieval/` 放置 JSON 标注（query, relevant_chunk_ids 或 relevant_memory_ids）；脚本输出 P@4、R@4、MRR@10；**不**实现多 pipeline 对比报告。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 首次下载模型慢/失败 | 启动时显示进度；支持离线预置 `data/models/`；**下载失败时不自动降级**，提示用户手动下载并放置权重后重试 |
| SQLite-vec 在 Electron 原生模块编译 | 优先 WASM/纯 JS 向量检索；或 json 分片 MVP |
| 数据迁到项目目录后多 clone 副本 | `.gitignore` 覆盖 `data/`；README 说明 |
| Hybrid 延迟增加 | 向量 batch、索引预热、top-k 限制 |
| userData 旧数据丢失感 | README 迁移步骤；**不**自动迁移避免静默损坏 |

## Migration Plan

1. 实现 `resolveDataRoot()` 并替换 `chatController` 等处 `userData` 传参。
2. 设置 `app.setPath('logs', resolveDataRoot('logs'))`（可选）。
3. 新安装直接使用 `data/`；老用户按文档将 `%APPDATA%/DesktopPet/` 对应子目录复制到 `data/`。
4. 知识库 re-index：导入时触发结构切块 + 向量重建；提供 IPC「重建索引」。
5. 回滚：环境变量指回旧路径或恢复 userData 传参（保留一个 release 的兼容开关 `DESKTOP_PET_USE_USER_DATA=1` 仅开发用，非 spec 要求）。

## Open Questions

- sqlite-vec 在目标 Electron 版本的预构建二进制是否可用；若否 MVP 用内存 cosine + JSON 持久化。
- 记忆条目较短，是否与 RAG 共用 embedding 模型（倾向共用 BGE-Small-ZH-v1.5）。
