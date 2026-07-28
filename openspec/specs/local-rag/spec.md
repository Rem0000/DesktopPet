## Purpose

本地知识库 RAG：文档导入、切块索引、检索增强与引用溯源；与用户长期记忆分库。

## Requirements

### Requirement: 本地文档导入
系统 SHALL 允许用户导入本地 md/txt 文档到知识库目录，并为每个文档分配稳定 documentId；导入失败时 SHALL 返回可理解错误且不破坏已有索引。

#### Scenario: 成功导入 Markdown
- **WHEN** 用户选择一个有效的 .md 文件导入
- **THEN** 系统保存源文件副本并生成可检索索引条目

#### Scenario: 拒绝不支持格式
- **WHEN** 用户导入不支持的文件类型
- **THEN** 系统拒绝导入并提示支持的格式

### Requirement: 切块与索引
系统 SHALL 将导入文档切分为带 documentId、chunkId、正文、偏移与 headingPath（标题层级路径）信息的块，并建立稀疏（BM25 或等价）与向量双索引。删除文档时 MUST 同步移除其全部块、稀疏索引项与向量记录。切块 MUST 优先按 Markdown 标题与段落边界分割；仅当段落超过配置最大长度时才二次切分并保留 overlap。

#### Scenario: 删除文档清理索引
- **WHEN** 用户删除某已导入文档
- **THEN** 该文档的源文件、全部 chunk 及稀疏/向量索引不再参与检索

#### Scenario: 标题边界切块
- **WHEN** 导入含 `##` 小节标题的 Markdown
- **THEN** 每个 chunk 的 headingPath 反映其所属标题层级，且不在标题行中间切断

### Requirement: 检索增强回答
系统 SHALL 通过 Hybrid 检索（稀疏 + 向量 + 轻量 Rerank）获取 top-k 相关片段并提供给 Agent；无命中时 MUST 明确可观测的空结果，MUST NOT 捏造文档内容。检索 MUST 使用 `data/knowledge/` 下的索引与 `data/models/` 下的 Embedding 权重。

#### Scenario: 命中后增强
- **WHEN** 用户问题与某文档片段语义相关且 Hybrid 检索命中
- **THEN** Agent 可基于该片段生成回答，并附带 documentId、chunkId、headingPath 等溯源元数据

#### Scenario: 未命中
- **WHEN** 知识库为空或查询无关
- **THEN** 检索返回空列表，回复不声称引用了不存在的本地文档

### Requirement: 向量索引生命周期
系统 SHALL 在文档导入、更新或删除时同步维护向量索引；启动时 MUST 校验索引版本，必要时提供重建索引能力（IPC 或开发者命令）。

#### Scenario: 导入后立即可向量检索
- **WHEN** 用户成功导入新文档且 Embedding 模型可用
- **THEN** 新 chunk 的向量写入索引并参与后续 Hybrid 检索

#### Scenario: 重建索引
- **WHEN** 用户或开发者触发知识库索引重建
- **THEN** 系统基于现有源文件重新切块并重建稀疏与向量索引

### Requirement: 知识库与用户记忆隔离
知识库文档与用户长期记忆（profile/fact 等）MUST 分库存储与分别管理；清空记忆 MUST NOT 删除知识库，删除知识库 MUST NOT 清空用户记忆。

#### Scenario: 清空记忆保留知识库
- **WHEN** 用户清空全部长期记忆
- **THEN** 已导入知识库文档与索引仍然可用
