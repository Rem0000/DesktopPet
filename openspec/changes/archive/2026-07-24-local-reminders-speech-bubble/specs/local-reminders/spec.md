## ADDED Requirements

### Requirement: 本地提醒持久化
系统 SHALL 将提醒任务持久化到独立于长期记忆的本地存储，每条提醒 MUST 包含 id、content、fireAt（ISO）、status（pending | fired | cancelled）与 createdAt。提醒 MUST NOT 绑定 Live2D `packageId`。

#### Scenario: 创建提醒落盘
- **WHEN** 用户或 Agent 成功创建一条提醒
- **THEN** 存储中存在 status 为 pending 的对应条目，且重启应用后仍可读取

#### Scenario: 取消待触发提醒
- **WHEN** 对一条 pending 提醒执行取消
- **THEN** 其 status 变为 cancelled，且不再被调度触发

### Requirement: 到点调度与启动补发
系统 SHALL 在 Electron 主进程调度 pending 提醒。应用未运行期间到期的提醒 MUST 仅在下次启动（或系统从休眠恢复后的重扫）时补发，MUST NOT 依赖 OS 任务计划在关机状态下唤醒应用。

#### Scenario: 应用运行中到点
- **WHEN** 当前时间到达或超过某条 pending 的 fireAt
- **THEN** 系统将该条纳入到期批次并触发展示管线

#### Scenario: 启动时补发逾期
- **WHEN** 应用启动且存在 fireAt ≤ 现在的 pending 提醒
- **THEN** 系统将这些提醒作为到期批次补发，而非丢弃

### Requirement: 同批多条合并展示
系统 SHALL 将同一触发批次内的多条到期提醒合并为一次气泡展示；单条批次直接使用该条 content 作为改写输入。

#### Scenario: 多条逾期合并
- **WHEN** 启动或调度发现同一批次有两条及以上 pending 到期提醒
- **THEN** 系统只展示一次气泡，并将该批次全部标记为 fired（或等价终态）

#### Scenario: 单条到期
- **WHEN** 批次仅含一条到期提醒
- **THEN** 系统以该条 content 为输入生成展示文案并展示一次气泡

### Requirement: 当前人设口吻改写
系统 SHALL 在展示前使用**当前激活** Live2D 包的人设（空则默认桌宠提示）调用 LLM，将合并后的提醒意图改写为一句角色口吻气泡文案。该调用 MUST NOT 写入任何聊天会话历史。改写失败、超时或无可用 Provider 时，系统 MUST 降级为可读的原文或模板文案，且仍 MUST 展示气泡。

#### Scenario: 改写成功
- **WHEN** 到期批次触发且 LLM 改写成功
- **THEN** 气泡展示改写后的角色口吻文案

#### Scenario: 改写失败降级
- **WHEN** 到期批次触发但 LLM 不可用或失败
- **THEN** 气泡仍展示，文案为降级模板或提醒原文摘要

#### Scenario: 切模型后用新人设
- **WHEN** 提醒创建时使用模型 A，到点时当前激活为模型 B
- **THEN** 口吻改写使用模型 B 的人设（或默认提示），且提醒记录本身无 packageId

### Requirement: 提醒 Agent 工具
系统 SHALL 向 Agent 提供白名单工具 schedule_reminder 与 cancel_reminder，用于创建与取消本地提醒；MUST NOT 因此默认开放文件、Shell 或网络浏览工具。

#### Scenario: 预约提醒
- **WHEN** 用户明确要求在某时刻或若干分钟后提醒某事，且模型调用 schedule_reminder
- **THEN** 系统创建 pending 提醒并可在到点触发展示管线

#### Scenario: 取消提醒
- **WHEN** 用户要求取消某条未触发提醒且模型调用 cancel_reminder
- **THEN** 对应 pending 提醒变为 cancelled 且不再触发
