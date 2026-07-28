## ADDED Requirements

### Requirement: 会话绑定 Live2D 包
每个聊天会话 SHALL 绑定一个 `packageId`（Live2D 导入包目录名）。新建会话 MUST 使用当前活跃模型的 `packageId`。系统 MUST NOT 允许在绑定其他包的会话中继续发送消息。

#### Scenario: 新建会话归属当前模型
- **WHEN** 用户在某 Live2D 模型为活跃时新建对话
- **THEN** 新会话的 `packageId` 等于当前活跃包 id

#### Scenario: 拒绝跨模型续聊
- **WHEN** 当前活跃包与会话的 `packageId` 不一致且用户尝试发送消息
- **THEN** 系统拒绝发送或先切换到匹配会话，且 MUST NOT 在同一会话中混入另一角色的新回复

### Requirement: 按模型过滤会话列表
聊天窗口侧栏 SHALL 仅列出当前活跃 Live2D 包对应的会话。

#### Scenario: 切换模型后刷新列表
- **WHEN** 用户将活跃模型从包 A 切换到包 B
- **THEN** 侧栏仅显示 `packageId` 为 B 的会话，并选中 B 的最近会话；若 B 无会话则自动新建空会话

## MODIFIED Requirements

### Requirement: 会话和消息持久化
系统 SHALL 持久化会话标识、所属 `packageId`、标题、创建与更新时间以及用户和桌宠消息，并 SHALL 支持在当前模型作用域内新建、切换和删除会话。删除某个 Live2D 包时，系统 SHALL 删除该 `packageId` 下全部会话。

#### Scenario: 重启后恢复当前模型会话
- **WHEN** 应用重启且存在历史会话，且当前活跃为某 Live2D 包
- **THEN** 聊天窗口仅显示该包下的历史会话列表并可继续其中任一会话

#### Scenario: 删除会话
- **WHEN** 用户确认删除一个会话
- **THEN** 系统删除该会话及其消息，且其他会话不受影响

#### Scenario: 删除模型级联会话
- **WHEN** 用户删除某非默认 Live2D 包
- **THEN** 该包下所有聊天会话被删除
