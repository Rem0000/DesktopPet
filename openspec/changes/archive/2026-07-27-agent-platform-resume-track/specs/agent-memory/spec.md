## ADDED Requirements

### Requirement: 可检索记忆召回
系统 SHALL 提供基于查询文本的记忆检索接口，对 profile/fact/commitment 等条目按关键词相关性与重要度等因素打分，并返回 top-k 结果。召回阶段 MUST 优先使用检索结果，而不是仅按写入顺序截取列表。

#### Scenario: 按主题检索事实
- **WHEN** 用户消息涉及已知事实主题且记忆库中存在相关条目
- **THEN** 召回结果优先包含与该主题相关的 fact/commitment，而非无关条目

#### Scenario: 空查询回退
- **WHEN** 检索查询为空或无法提取有效关键词
- **THEN** 系统回退到基于 important/pinned 的默认召回策略

### Requirement: 记忆生命周期管理
系统 SHALL 支持记忆条目的 pin（置顶）、时间衰减权重与冲突合并规则。被 pin 的条目 MUST 在预算允许时优先注入；衰减后低于阈值的非 pin 条目 MUST 在召回中降权或可被清理策略忽略。

#### Scenario: 置顶记忆优先
- **WHEN** 用户将某条记忆标记为 pinned
- **THEN** 后续召回在同等预算下优先注入该条目

#### Scenario: 冲突画像合并
- **WHEN** 写入与已有 profile key 冲突的新内容
- **THEN** 系统覆盖该 key 并保留更新时间，召回仅使用最新内容

### Requirement: Top-k 与预算注入
记忆召回注入 MUST 先取检索 top-k，再在字符/token 预算内组装；超出预算时 MUST 按 pin > importance > 相关分 > 新旧 的优先级裁剪。

#### Scenario: 超预算裁剪
- **WHEN** top-k 记忆文本超过配置预算
- **THEN** 系统保留更高优先级条目并丢弃其余，且仍保留角色提示与当前用户消息

## MODIFIED Requirements

### Requirement: 记忆召回注入
系统 SHALL 在每次模型调用前召回相关长期记忆，并与当前模型人设（或默认提示）、会话摘要、近期对话一并组装进上下文，且受统一字符/token 预算约束。召回 MUST 基于可检索接口与生命周期权重选择条目，MUST 包含共享 profile 与相关 fact/commitment，且 MUST NOT 注入 preference。

#### Scenario: 高重要性画像优先注入
- **WHEN** 存在 importance 较高的 profile 条目
- **THEN** 系统优先将其纳入长期记忆上下文块，再按相关性补充其他 fact/commitment 条目

#### Scenario: 预算不足时裁剪
- **WHEN** 组装后的上下文超过配置预算
- **THEN** 系统保留角色提示与当前用户消息，并按优先级裁剪情景片段与较早摘要内容

#### Scenario: 检索命中优先于列表顺序
- **WHEN** 记忆库条目较多且用户问题仅与其中少数相关
- **THEN** 注入上下文的条目以检索相关性为主，而不是仅取最近写入的 N 条
