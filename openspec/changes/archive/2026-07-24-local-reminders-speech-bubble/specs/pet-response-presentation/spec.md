## ADDED Requirements

### Requirement: 提醒气泡与桌宠状态联动
系统 SHALL 在提醒气泡展示期间将桌宠主窗口置于与「正在说话」一致或等价的表现状态，并 SHALL 在气泡关闭、超时或展示失败降级结束后恢复空闲状态。该联动 MUST NOT 将口吻改写的 LLM 调用写入聊天会话。

#### Scenario: 气泡展示中
- **WHEN** 提醒气泡开始在桌宠主窗口展示
- **THEN** 桌宠进入 speaking（或产品定义的等价）状态

#### Scenario: 气泡结束后恢复
- **WHEN** 提醒气泡被关闭或超时消失
- **THEN** 桌宠主窗口恢复 idle 状态
