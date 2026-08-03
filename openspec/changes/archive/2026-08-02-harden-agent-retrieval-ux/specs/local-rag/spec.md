## MODIFIED Requirements

### Requirement: 向量索引生命周期
系统 SHALL 在文档导入、更新或删除时同步维护向量索引；启动时 MUST 校验索引版本，必要时提供重建索引能力（IPC 或开发者命令）。索引写入 MUST 使用向量存储的批量落盘路径，避免逐条全量写文件造成主进程长时间阻塞。重建索引时 SHALL 向调用方报告进度（已完成/总数）。

#### Scenario: 导入后立即可向量检索
- **WHEN** 用户成功导入新文档且 Embedding 模型可用
- **THEN** 新 chunk 的向量写入索引并参与后续 Hybrid 检索

#### Scenario: 重建索引
- **WHEN** 用户或开发者触发知识库索引重建
- **THEN** 系统基于现有源文件重新切块并重建稀疏与向量索引

#### Scenario: 重建进度可观测
- **WHEN** 用户触发重建索引且文档量大于一批
- **THEN** 调用方能收到至少一次中间进度更新（done/total）
