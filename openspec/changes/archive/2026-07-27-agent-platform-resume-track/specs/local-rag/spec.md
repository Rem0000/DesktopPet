## ADDED Requirements

### Requirement: 本地文档导入
系统 SHALL 允许用户导入本地 md/txt 文档到知识库目录，并为每个文档分配稳定 documentId；导入失败时 SHALL 返回可理解错误且不破坏已有索引。

#### Scenario: 成功导入 Markdown
- **WHEN** 用户选择一个有效的 .md 文件导入
- **THEN** 系统保存源文件副本并生成可检索索引条目

#### Scenario: 拒绝不支持格式
- **WHEN** 用户导入不支持的文件类型
- **THEN** 系统拒绝导入并提示支持的格式

### Requirement: 切块与索引
系统 SHALL 将导入文档切分为带 documentId、chunkId、正文与偏移信息的块，并建立可供关键词检索的本地索引。删除文档时 MUST 同步移除其全部块与索引项。

#### Scenario: 删除文档清理索引
- **WHEN** 用户删除某已导入文档
- **THEN** 该文档的源文件与全部 chunk 索引不再参与检索

### Requirement: 检索增强回答
系统 SHALL 提供知识库检索能力（工具或召回注入），将 top-k 相关片段提供给 Agent；无命中时 MUST 明确可观测的空结果，MUST NOT 捏造文档内容。

#### Scenario: 命中后增强
- **WHEN** 用户问题与某文档片段相关且检索命中
- **THEN** Agent 可基于该片段生成回答，并附带可追溯的来源元数据

#### Scenario: 未命中
- **WHEN** 知识库为空或查询无关
- **THEN** 检索返回空列表，回复不声称引用了不存在的本地文档

### Requirement: 知识库与用户记忆隔离
知识库文档与用户长期记忆（profile/fact 等）MUST 分库存储与分别管理；清空记忆 MUST NOT 删除知识库，删除知识库 MUST NOT 清空用户记忆。

#### Scenario: 清空记忆保留知识库
- **WHEN** 用户清空全部长期记忆
- **THEN** 已导入知识库文档与索引仍然可用
