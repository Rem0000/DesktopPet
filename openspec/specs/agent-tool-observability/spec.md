## Purpose

工具调用链路的本地可观测性：结构化日志落盘、按会话查询与按工具汇总统计。

## Requirements

### Requirement: 结构化工具调用日志
系统 SHALL 将工具调用观测事件持久化为本地结构化日志（如 JSONL），按 requestId/sessionId 可关联查询，并 SHALL 支持按时间范围列出最近调用。

#### Scenario: 落盘成功
- **WHEN** 一次工具调用结束
- **THEN** 对应观测事件写入本地日志文件且可读回

#### Scenario: 按会话查询
- **WHEN** 客户端请求某 sessionId 的工具调用记录
- **THEN** 系统返回该会话相关调用列表（按时间排序）

### Requirement: 调用统计摘要
系统 SHALL 能汇总一段时间内的工具调用次数、成功率与平均耗时（按 toolName 分组），供本地调试或评测对照使用。

#### Scenario: 汇总成功率
- **WHEN** 存在多次同名工具调用记录
- **THEN** 统计接口返回该工具的调用次数、成功次数与平均 latencyMs
