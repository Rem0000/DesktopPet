## Purpose

跨会话共享的用户画像与长期记忆：结构化条目、召回注入、会话摘要压缩、白名单记忆工具与用户可编辑面板。

## Requirements

### Requirement: 跨会话共享用户画像
系统 SHALL 维护一套跨所有聊天会话与所有 Live2D 模型共享的用户画像（profile）与事实类记忆（fact/commitment），并在任意模型的 Agent 调用中可被召回注入。模型口吻、称呼方式、输出规范等个性化要求 MUST NOT 作为全局 preference 存储，而 SHALL 由该模型人设文件表达。

#### Scenario: 新会话仍能使用画像
- **WHEN** 用户在新模型或新会话中发出与已知画像相关的问题
- **THEN** Agent 上下文中包含共享用户画像中的相关 profile 条目

#### Scenario: 画像更新对后续模型生效
- **WHEN** 用户画像中某 profile 字段被更新
- **THEN** 之后任意 Live2D 模型会话的召回结果反映更新后的内容

#### Scenario: 跨模型共享事实约定
- **WHEN** 用户在模型 A 的对话中写入一条 fact 或未过期的 commitment（例如稍后提醒喝水）
- **THEN** 切换到模型 B 后的召回仍可包含该条目（主动到点通知不在本需求范围）

### Requirement: 长期记忆条目管理
系统 SHALL 支持类型为 profile、fact、commitment、episode 的记忆条目，并按规则写入、更新、过期与删除。系统 MUST NOT 再将 preference 作为可写入的长期记忆类型；既有 preference 条目 MUST NOT 再注入召回上下文。

#### Scenario: 画像类按 key 覆盖
- **WHEN** 写入带相同 key 的 profile 条目
- **THEN** 系统覆盖该 key 的旧内容并更新 updatedAt

#### Scenario: 事实类追加
- **WHEN** 写入 fact 或 commitment
- **THEN** 系统追加新条目并保留来源会话与消息引用

#### Scenario: 过期约定不注入
- **WHEN** commitment 条目已超过 expiresAt
- **THEN** 召回阶段 MUST NOT 将该条目注入模型上下文

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

### Requirement: Agent 记忆工具
系统 SHALL 向 Agent 提供白名单记忆工具 update_profile、remember_fact、forget_memory，并在写入前执行安全校验。系统 MUST NOT 提供 remember_preference。`forget_memory` MUST 标记为 riskLevel=`confirm`，执行前须经用户确认。每次聊天请求 SHALL 在回复前由 Provider 规划是否调用这些工具（对话自动写记忆）；若规划失败 MUST NOT 阻断正常回复，但 MUST 产生可观测失败信号。当用户要求的是角色口吻或输出规范时，系统 SHALL 提示应写入人设而非记忆库。

#### Scenario: 通过工具更新画像
- **WHEN** 用户明确表达身份类信息且 Agent 调用 update_profile
- **THEN** 系统将画像写入共享长期记忆并可在后续任意模型召回中使用

#### Scenario: 通过工具记住事实
- **WHEN** 用户明确表达可跨模型共享的事实或约定且 Agent 调用 remember_fact
- **THEN** 系统写入共享 fact/commitment 并可在后续召回中使用

#### Scenario: 对话自动规划写入
- **WHEN** 用户在普通聊天中明确表达应长期记住的画像或事实，且未手动传入 pendingToolCalls
- **THEN** 系统在流式回复前调用 planToolCalls，并在模型选择工具时执行写入

#### Scenario: 拒绝敏感写入
- **WHEN** 工具试图写入疑似 API Key、密码或其他敏感机密
- **THEN** 系统拒绝写入并返回可理解的失败原因

#### Scenario: 遗忘需确认
- **WHEN** Agent 规划调用 forget_memory 且用户未确认
- **THEN** 系统 MUST NOT 删除对应记忆条目

### Requirement: 用户可编辑记忆
系统 SHALL 提供查看、编辑、删除与清空长期记忆的界面或 IPC 能力，使用户可纠正错误记忆。

#### Scenario: 用户删除错误记忆
- **WHEN** 用户删除某条长期记忆
- **THEN** 该条目立即从存储移除，且后续召回不再注入

#### Scenario: 用户清空记忆
- **WHEN** 用户确认清空全部长期记忆
- **THEN** 系统删除所有长期记忆条目，但保留聊天会话消息除非用户另行删除

### Requirement: 会话摘要压缩
当会话历史超过上下文预算时，系统 SHALL 生成或更新会话摘要以覆盖早期轮次，并仅将摘要与近期原文注入模型。

#### Scenario: 超预算触发摘要
- **WHEN** 会话完整历史将超出配置的上下文预算
- **THEN** 系统为早期轮次维护摘要，并在后续调用中注入该摘要而非全部早期原文

### Requirement: 可检索记忆召回
系统 SHALL 通过 Hybrid 检索（稀疏 BM25 + 向量相似度 + 轻量 Rerank）对 profile/fact/commitment 等条目打分，并结合 pin、importance、时间衰减等因素返回 top-k 结果。召回阶段 MUST 优先使用 Hybrid 检索结果，而不是仅按写入顺序截取列表。记忆向量索引 MUST 存放在项目 data 目录（`data/memory/` 或约定子路径）。

#### Scenario: 按主题检索事实
- **WHEN** 用户消息涉及已知事实主题且记忆库中存在语义相关条目
- **THEN** 召回结果优先包含与该主题相关的 fact/commitment，而非无关条目

#### Scenario: 空查询回退
- **WHEN** 检索查询为空或无法提取有效关键词
- **THEN** 系统回退到基于 important/pinned 的默认召回策略

### Requirement: 记忆向量同步
系统 SHALL 在记忆条目创建、更新或删除时同步 upsert 或删除对应向量记录；启动时 MUST 检测向量索引与 JSON 存储一致性，必要时支持全量重建。

#### Scenario: 写入后向量可检
- **WHEN** 通过工具或 UI 写入新 fact 且 Embedding 可用
- **THEN** 该条目在后续 Hybrid 记忆检索中可被语义召回

#### Scenario: 删除后向量移除
- **WHEN** 用户删除某记忆条目
- **THEN** 对应向量记录从索引移除且不再参与检索

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

### Requirement: 关系与记忆隔离
系统 SHALL 将"关系/好感"类信息与长期记忆（profile/fact/commitment）严格隔离：关系状态 MUST 通过关系模块（`update_relationship` 等）读写，MUST NOT 写入记忆库；记忆条目 MUST NOT 被写入关系状态；关系状态 MUST NOT 作为记忆召回结果注入。模型口吻、称呼、输出规范类请求仍按既有规则路由到人设，关系/好感类意图路由到关系模块而非记忆或人设。

#### Scenario: 关系意图不写记忆
- **WHEN** 对话中涉及好感增减或关系变化且 Agent 规划写入
- **THEN** 系统将变更写入关系状态，记忆库条目数与内容不因此改变

#### Scenario: 记忆召回不含关系
- **WHEN** 某次对话触发记忆召回
- **THEN** 召回结果不含任何关系状态条目；关系状态仅经关系层注入

#### Scenario: 口吻类仍走人设
- **WHEN** 用户表达说话方式/称呼/输出规范类偏好
- **THEN** 系统既不写入记忆也不写入关系状态，仍按既有规则引导其编辑人设
