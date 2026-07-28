## ADDED Requirements

### Requirement: 向量批量写入
向量存储层 SHALL 提供批量 upsert/delete API：同一批次内的多条向量变更 MUST 在内存更新后以单次持久化落盘，MUST NOT 对批内每条记录各自触发一次全量写文件。

#### Scenario: 批量索引单次落盘
- **WHEN** 知识库或记忆索引对 N（N>1）条向量执行批量 upsert
- **THEN** 持久化文件写入次数为 1（成功路径），且全部 N 条随后可被检索

### Requirement: Embedding 加载态可观测
Embedding 服务 SHALL 通过既有或扩展的状态通道暴露 idle/loading/ready/error；应用启动预加载期间 MUST 将 loading 状态对外可见。加载失败行为仍遵守「不自动降级」要求。

#### Scenario: 启动预加载可见
- **WHEN** 应用启动并开始加载 BGE 模型
- **THEN** 状态查询返回 loading（或随后 ready/error），聊天窗可据此展示提示
