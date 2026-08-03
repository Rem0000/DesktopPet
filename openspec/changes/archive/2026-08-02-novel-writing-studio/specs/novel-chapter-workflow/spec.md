## ADDED Requirements

### Requirement: 写章上下文组装
系统 SHALL 在生成章节草稿前组装上下文，固定注入块 MUST 包含：书级主题/文风约束、本章大纲卡、POV 或主要出场角色摘要、未回收高优先级伏笔 top-N、上一已接受章结尾钩子（若存在）、相关声口样例。检索注入块 SHALL 通过书内 Hybrid（或明确降级策略）补充相关摘要与短正文片段，并受统一字符/token 预算约束。

#### Scenario: 组装含未回收伏笔
- **WHEN** 账本中存在与本章相关的未回收伏笔
- **THEN** 固定注入块优先包含这些伏笔的简要描述与状态

#### Scenario: 超预算裁剪
- **WHEN** 组装结果超过配置预算
- **THEN** 系统保留固定高优先级块与当前写章指令，并裁剪较低优先级检索片段

### Requirement: 章节草稿生成
系统 SHALL 基于组装上下文生成章节草稿，支持流式输出到工坊 UI，并 SHALL 将草稿保存为未接受版本（可多轮）。草稿生成 MUST NOT 自动修改 Canon 或伏笔生命周期。

#### Scenario: 流式草稿
- **WHEN** 用户请求撰写第 N 章
- **THEN** UI 收到流式草稿内容，并在完成后可保存为草稿修订版

#### Scenario: 生成失败保留旧草稿
- **WHEN** 草稿生成中途失败或取消
- **THEN** 已接受正文与 Canon 不变；已保存的旧草稿仍可访问

### Requirement: StateDiff 抽取与可编辑预览
草稿完成后，系统 SHALL 抽取结构化 StateDiff（至少可覆盖：角色状态变化、关系变化、知情差变化、时间线事件、新种植/强化/回收伏笔、候选 Canon 事实），并在 Accept 前向用户展示可编辑预览。

#### Scenario: 预览 Diff
- **WHEN** 草稿生成完成并完成抽取
- **THEN** 用户可查看并编辑 StateDiff 条目后再决定 Accept

#### Scenario: 抽取失败可重试
- **WHEN** StateDiff 抽取失败
- **THEN** 系统返回可理解错误，草稿仍保留，用户可重试抽取或手工填写关键变更后 Accept

### Requirement: 连续性 Guard 告警
系统 SHALL 在 Accept 前对草稿与当前状态执行连续性检查，至少覆盖：时间线矛盾、知情越权（角色得知其不应知道的信息）、已终结角色不当出场、伏笔被无说明提前回收等。Guard MUST 产出结构化告警列表；一期 MUST NOT 自动改写正文。

#### Scenario: 知情越权告警
- **WHEN** 草稿中角色使用其知情集合中不存在的秘密信息
- **THEN** Guard 返回对应告警且不自动删改正文

#### Scenario: 带告警强制 Accept
- **WHEN** 存在未消除告警且用户选择强制 Accept
- **THEN** 系统接受该章并记录 override 元数据（含告警快照）

### Requirement: 人审 Accept / Reject / 改稿
系统 SHALL 支持用户对草稿执行 Accept、Reject 或基于反馈再次生成。Accept MUST 提交正文、应用经确认的 StateDiff、更新章摘要并触发书内索引更新。Reject MUST NOT 改变 Canon。

#### Scenario: Accept 提交
- **WHEN** 用户确认 Accept 且 Diff 已确认
- **THEN** 正文进入已接受集合，状态实体按 Diff 更新，章摘要生成或更新，书内索引包含新章内容

#### Scenario: Reject 保持状态
- **WHEN** 用户 Reject 当前草稿
- **THEN** Canon、伏笔与已接受章节列表保持 Accept 前状态

#### Scenario: 按反馈改稿
- **WHEN** 用户提供改稿意见并请求重新生成
- **THEN** 系统在保留原状态的前提下生成新草稿修订版
