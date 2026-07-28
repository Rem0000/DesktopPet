## ADDED Requirements

### Requirement: 工具元数据注册
系统 SHALL 在 ToolRegistry 中为每个工具保存 name、description、input schema、enabled、riskLevel（如 `safe` / `confirm`）与 handler 引用。未 enabled 的工具 MUST NOT 出现在 planToolCalls 可选集合中，且 MUST NOT 被执行。

#### Scenario: 禁用工具不可调用
- **WHEN** 某已注册工具的 enabled 为 false
- **THEN** Agent 规划与执行阶段均不可调用该工具，并在尝试时返回可理解错误

#### Scenario: 新增工具无需改聊天协议
- **WHEN** 开发者按统一接口注册一个新的安全工具
- **THEN** 现有聊天 IPC 与窗口协议无需修改即可在后续对话中规划并执行该工具

### Requirement: 工具调用观测事件
Agent 运行时 SHALL 在每次工具调用开始与结束时发出结构化观测事件，至少包含 requestId、sessionId、toolName、startedAt、endedAt、ok、errorCode（若失败）与 latencyMs；入参 MUST 以脱敏摘要形式记录，MUST NOT 完整记录疑似密钥内容。

#### Scenario: 成功调用产生观测
- **WHEN** 白名单工具执行成功
- **THEN** 系统记录一条 ok=true 的观测事件，并包含耗时

#### Scenario: 失败调用产生观测
- **WHEN** 工具因校验失败或执行异常而失败
- **THEN** 系统记录 ok=false 与 errorCode，且不中断对观测通道本身的写入

### Requirement: 配置驱动工具开关
系统 SHALL 允许通过本地配置覆盖默认工具的 enabled 状态；配置缺失时 SHALL 使用代码默认值（记忆与提醒工具默认启用）。

#### Scenario: 配置关闭提醒工具
- **WHEN** 用户或开发者将 schedule_reminder 配置为 disabled
- **THEN** 后续对话不再规划或执行该工具，直至重新启用
