## ADDED Requirements

### Requirement: 独立检索测试集与指标报告
系统 SHALL 提供与现有 source-evidence 语料、查询和开发调参集隔离的冻结知识库检索测试集，并使用真实 BGE-Small-ZH-v1.5 Hybrid 检索路径评估父子分块。数据集 MUST 为源文档和查询证据提供版本标识、唯一 evidence anchor 与 SHA-256 校验；评测 MUST 在运行前校验全部源文档及锚点有效性。

#### Scenario: 独立数据集校验
- **WHEN** 运行独立检索评测
- **THEN** 系统加载专用版本的数据集与 corpus，校验每个源文件 SHA-256，且每个 evidence anchor 在指定源文档中恰好出现一次；校验失败时评测失败并不输出成功指标

#### Scenario: 父块结果覆盖证据
- **WHEN** 查询返回按父块去重的 top-k 结果
- **THEN** 评测以返回父块正文覆盖的 evidence anchor 计算相关性，不依赖实现生成的父块/子块 ID，并记录未映射 evidence

#### Scenario: 输出 Recall 与 MRR
- **WHEN** 独立评测的所有查询完成
- **THEN** 系统输出机器可读报告，至少包含数据集版本、语料 hash、索引/切分配置、模型标识、topK、每查询诊断、平均 Recall@K、required Recall@K 与首个 required evidence 的 MRR@K

### Requirement: 真实评测隔离与可复现
独立真实评测 SHALL 只能通过专用 npm lifecycle 命令启用，普通单元测试 MUST 跳过真实模型加载；评测 MUST 禁止 mock embedding、关键词降级或云端 API，并在报告中记录实际模型与运行配置。测试集内容和标签在评测运行期间 MUST 视为只读，不得由评测代码改写。

#### Scenario: 普通测试不触网
- **WHEN** 用户运行 `npm test` 或其他未授权的普通 Vitest 命令
- **THEN** 独立真实评测不加载 BGE 权重、不下载模型、不访问云端，并明确显示跳过或不纳入普通测试结果

#### Scenario: 专用命令真实运行
- **WHEN** 用户通过专用 npm 命令运行独立评测且本地模型已就绪
- **THEN** 评测执行真实 embedding 与 Hybrid 检索，输出 Recall@K/MRR@K 及逐查询结果；模型缺失或加载失败时命令失败并包含模型路径指引
