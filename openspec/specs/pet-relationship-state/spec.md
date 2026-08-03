## Purpose

按 Live2D 包维护的关系状态存储：好感温度、关系阶段、演化提案与历史，原子写入并与人设/记忆/小说隔离。

## Requirements

### Requirement: 按包关系状态存储
系统 SHALL 为每个 Live2D 导入包维护独立的关系状态，持久化于 `data/relationships/<packageId>.json`，至少包含：优先级策略 `policy`、好感温度 `affinity`、关系阶段 `stage`、当下态度描述 `temperatureNote`、演化提案 `evolutions` 与历史 `history`。该状态 MUST 与 persona.md、聊天记忆、小说数据分离存储，且 MUST 使用原子写（复用 `fsAtomic`）。

#### Scenario: 首次对话自动初始化
- **WHEN** 用户首次与某导入包对话且该包不存在关系状态文件
- **THEN** 系统按默认值初始化（policy=layered、affinity=初始值、stage=stranger），并保证后续组装可读取

#### Scenario: 状态更新持久化
- **WHEN** 好感温度或关系阶段发生变化
- **THEN** 系统将最新状态原子写入 `data/relationships/<packageId>.json`，重启后可恢复

### Requirement: 好感温度与关系阶段
系统 SHALL 维护 `affinity` 为连续值（建议 0–100）与 `stage` 为离散阶段（stranger → acquaintance → friendly → close → intimate），并 SHALL 按既定阈值规则在温度变化后推进或回退阶段。阶段推进 MUST 记录到 `history` 并可被 UI 展示。

#### Scenario: 温度上升推进阶段
- **WHEN** 连续正面互动使 affinity 越过下一阶段阈值
- **THEN** 系统推进 stage 到更高阶段，并写入一条含时间与原因的阶段变更记录

#### Scenario: 温度回退
- **WHEN** 连续负面互动使 affinity 跌破当前阶段下限
- **THEN** 系统回退 stage 并记录原因，且该回退不影响 persona.md 原文

### Requirement: 关系状态生命周期
系统 SHALL 在删除某 Live2D 导入包时级联删除其关系状态文件；对缺失文件的旧包 SHALL 视为未初始化并按默认值使用，不得报错中断聊天。

#### Scenario: 删包清理
- **WHEN** 用户删除某已导入模型包
- **THEN** 系统同时移除该包的关系状态文件，且其他包与聊天记忆不受影响

#### Scenario: 旧包按默认初始化
- **WHEN** 未升级前的旧数据目录中不存在任何关系状态文件
- **THEN** 聊天正常启动并按默认关系状态工作
