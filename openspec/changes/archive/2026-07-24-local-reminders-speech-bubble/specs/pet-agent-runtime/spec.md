## ADDED Requirements

### Requirement: 提醒调度工具注册
Agent 运行时 SHALL 默认注册提醒白名单工具 schedule_reminder、cancel_reminder，与记忆工具一并可供 planToolCalls 选择。上述工具 MUST 仅操作本地提醒存储，MUST NOT 引入文件、Shell 或浏览器副作用。

#### Scenario: 规划到点提醒
- **WHEN** 用户在对话中明确要求稍后或某时刻提醒某事，且已注册提醒工具
- **THEN** 运行时可以在 toolBoundary 前将 schedule_reminder 纳入规划并执行

#### Scenario: 执行取消提醒工具
- **WHEN** 模型调用已注册的 cancel_reminder 且提供有效 pending 提醒 id
- **THEN** 运行时取消该提醒并返回结构化成功结果

#### Scenario: 拒绝未注册副作用工具
- **WHEN** 模型尝试调用未注册的文件或 Shell 类工具
- **THEN** 运行时拒绝执行并返回工具不存在或不可用的错误结果
