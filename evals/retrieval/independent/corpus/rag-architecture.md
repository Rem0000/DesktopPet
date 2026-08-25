# DesktopPet RAG Architecture

本地知识库 RAG 将外部知识切块、向量化并注入生成上下文。Hybrid 检索同时使用 BM25 与 BGE 向量：BM25 擅长精确词、专有名词和编号，向量检索擅长语义改写。两路结果通过 RRF 融合，再按 headingPath 做轻量元数据加分。

知识库与用户长期记忆分库存储。知识库父块保存章节上下文，子块承担精确检索与向量索引；最终按 parentChunkId 去重后返回父块正文，并保留 childChunkId 作为引用证据。
