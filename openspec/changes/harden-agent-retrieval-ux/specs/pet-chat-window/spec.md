## MODIFIED Requirements

### Requirement: 工具调用时间线
聊天窗口 SHALL 在助手回复关联的工具调用发生时展示可折叠的调用时间线，至少包含工具名、状态（进行中/成功/失败）与耗时。当本轮存在工具调用时，时间线 MUST 默认展开；用户可手动折叠。详情（脱敏入参摘要与错误信息）SHALL 可展开查看。

#### Scenario: 显示成功工具调用
- **WHEN** Agent 在一次回复中成功执行一个或多个工具
- **THEN** 聊天窗对该轮回复展示对应工具调用条目与成功状态

#### Scenario: 显示失败工具调用
- **WHEN** 某工具调用失败
- **THEN** 时间线显示失败状态与可理解错误摘要，且用户仍可看到后续助手回复（若有）

#### Scenario: 重开聊天窗恢复历史时间线
- **WHEN** 用户关闭聊天窗口后重新打开，且历史助手消息存在已落盘的工具调用记录
- **THEN** 系统从本地观测日志回填对应消息的工具调用时间线与引用来源

#### Scenario: 本轮工具默认展开
- **WHEN** 本轮助手消息开始出现工具调用
- **THEN** 时间线默认处于展开状态

## ADDED Requirements

### Requirement: 工具执行中状态提示
在工具调用尚未全部结束、助手正文尚未开始流式输出时，聊天窗口 SHALL 向用户展示「正在调用工具」或等价状态，MUST NOT 仅显示无区分的「思考中」。

#### Scenario: 工具进行中
- **WHEN** 至少一个工具处于 start 且尚未 end，且助手内容仍为空
- **THEN** UI 显示工具执行中状态文案

### Requirement: Confirm 工具确认 UI
当 Agent 请求执行 riskLevel=confirm 的工具时，聊天窗口 SHALL 展示确认界面（含工具名与脱敏入参摘要），并提供确认与拒绝操作；拒绝或超时 MUST 回传否定结果给主进程。

#### Scenario: 用户确认
- **WHEN** 确认 UI 展示后用户点击确认
- **THEN** 主进程收到肯定答复并继续执行该工具

#### Scenario: 用户拒绝
- **WHEN** 确认 UI 展示后用户点击拒绝
- **THEN** 主进程收到否定答复且不执行该工具

### Requirement: Embedding 模型状态横幅
当 Embedding 模型处于 loading 或 error 时，聊天窗口 SHALL 展示可见状态提示；error 时 MUST 提供重试入口或手动放置指引入口。

#### Scenario: 加载中提示
- **WHEN** Embedding 模型状态为 loading
- **THEN** 聊天窗显示加载中横幅或等价提示
