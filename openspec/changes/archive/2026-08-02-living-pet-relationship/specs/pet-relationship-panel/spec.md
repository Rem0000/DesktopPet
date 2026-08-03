## ADDED Requirements

### Requirement: 关系状态查看
系统 SHALL 提供关系面板展示当前包的好感温度、关系阶段、当下态度描述、阶段/温度变更历史、persona 原文与已生效演化覆盖。面板 MUST 仅展示当前活跃或选中模型包的关系状态，MUST NOT 混入聊天记忆或小说数据。

#### Scenario: 查看当前关系
- **WHEN** 用户在面板中查看某模型的关系
- **THEN** 面板显示其 affinity、stage、temperatureNote、历史记录与已生效演化，且不含记忆/小说条目

### Requirement: 手工修正与重置
系统 SHALL 允许用户在面板中手工修正好感温度与当下态度描述，并允许一键重置关系状态到默认值（policy=layered、affinity=初始、stage=stranger、清空演化与历史）。修正与重置 MUST 持久化，且重置 MUST 不影响 persona.md、聊天会话与记忆。

#### Scenario: 手工修正温度
- **WHEN** 用户将某包 affinity 改为指定值
- **THEN** 后续组装使用新值并写入历史

#### Scenario: 重置关系
- **WHEN** 用户确认重置某包关系状态
- **THEN** 状态回到默认值，persona.md、聊天会话与记忆均不受影响

### Requirement: 策略配置
系统 SHALL 在面板中提供 `layered`、`persona-first`、`dynamic-first` 三种策略的通俗化选择（默认 layered），用户切换后 MUST 持久化并立即生效（下一次模型调用即按新策略渲染）。

#### Scenario: 切换策略
- **WHEN** 用户把某包策略从 layered 改为 dynamic-first
- **THEN** 该包关系状态中的 policy 字段更新，下一次组装即按新策略渲染，无需重启

### Requirement: 演化审阅
系统 SHALL 在面板中列出待审候选演化（含 personaQuote、change 与 evidence），并允许用户接受、拒绝或忽略；接受后状态进入已生效列表，拒绝后不再作为待审项。审阅操作 MUST 持久化。

#### Scenario: 审阅提案
- **WHEN** 面板中存在 `status=proposed` 的候选演化且用户点击接受
- **THEN** 候选标记为 applied 并在后续组装中覆盖注入
