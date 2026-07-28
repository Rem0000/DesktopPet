# DesktopPet 知识库演示片段

本仓库的秋招智能体路线包含以下能力：

- 可插拔 Tool Registry 与工具调用可观测性
- 可检索长期记忆（Hybrid：BM25 + BGE 向量 + pin/预算注入）
- 本地知识库 RAG：结构感知切块、Hybrid 检索、`search_knowledge`、引用溯源
- 回答时展示引用来源，无命中不伪造引用

入口模块：`electron/chat/knowledgeStore.ts` 与 `knowledgeService.ts`。
