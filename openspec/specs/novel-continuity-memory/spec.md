## Purpose

小说工坊连续性记忆：书内召回、与聊天记忆严格隔离、声口样例与书内索引生命周期。

## Requirements

### Requirement: 小说连续性记忆与聊天记忆隔离
系统 SHALL 维护仅服务于小说工坊的连续性记忆召回，数据来源于该书 StoryStore 与书内索引。召回结果 MUST NOT 混入聊天用户画像/事实记忆，聊天召回 MUST NOT 混入小说 Canon 或章节正文。

#### Scenario: 写章召回不含用户 profile
- **WHEN** 系统为写章组装连续性上下文
- **THEN** 注入内容不包含 `data/memory/` 中的用户 profile/fact 条目（除非用户显式将某设定写入该书 Canon——仍存于小说库）

#### Scenario: 聊天召回不含小说正文
- **WHEN** 聊天 Agent 执行记忆/知识召回
- **THEN** 结果不包含 `data/novels/` 下章节或小说状态

### Requirement: 固定块与检索块预算策略
系统 SHALL 将写章上下文分为固定块与检索块，并分别受配置预算约束。固定块 MUST 优先保留主题约束、本章大纲卡、关键未回收伏笔与声口样例；检索块 SHALL 使用书内 Hybrid 检索（稀疏 + 向量 + 轻量 Rerank，与现有内核一致）获取相关摘要/片段。

#### Scenario: 固定块优先于检索块
- **WHEN** 总预算不足
- **THEN** 系统先满足固定块最小集合，再填充检索块，必要时丢弃低分检索结果

#### Scenario: 书内 Hybrid 命中章摘要
- **WHEN** 本章涉及早前事件且书内存在相关章摘要
- **THEN** 检索块优先返回相关摘要而非无关章节

### Requirement: 声口样例注入
系统 SHALL 为主要角色维护短声口样例（来自已接受正文或用户录入），并在该角色为 POV 或主要对话者时注入写章上下文，以降低对话声口漂移。

#### Scenario: POV 角色注入声口
- **WHEN** 本章 POV 角色存在声口样例
- **THEN** 组装上下文包含该角色样例片段

### Requirement: 书内索引生命周期
系统 SHALL 在章节 Accept、章节删除或用户触发重建时同步维护该书检索索引。删除书籍 MUST 移除其全部索引。索引 MUST 存放在该书目录下，MUST NOT 写入全局 `data/knowledge/`。

#### Scenario: Accept 后可检索新章
- **WHEN** 用户 Accept 新章且 Embedding 可用
- **THEN** 后续书内检索可命中该章摘要或正文块

#### Scenario: 删书清理索引
- **WHEN** 用户删除某书
- **THEN** 该书索引文件一并删除且不再参与任何检索

### Requirement: Embedding 不可用时的明确降级
当书内向量检索因 Embedding 不可用而无法完整执行时，系统 SHALL 向用户展示明确提示。若仍允许写章，MUST 标注连续性风险，并 MAY 仅使用固定块与稀疏检索；MUST NOT 声称已完成完整 Hybrid 召回。

#### Scenario: 向量不可用提示
- **WHEN** Embedding 模型未加载成功且用户发起写章
- **THEN** UI 显示可理解的风险提示与模型放置指引
