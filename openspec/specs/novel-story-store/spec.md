## Purpose

小说一书一库持久化：实体模型、Canon/草稿分离、伏笔账本与原子写入。

## Requirements

### Requirement: 一书一库持久化
系统 SHALL 为每本书分配稳定 `bookId`，并将全部叙事数据持久化在 `data/novels/<bookId>/` 下，包括但不限于：元信息、大纲、Canon、角色、关系、知情差、时间线、伏笔账本、已接受章节正文、草稿、章摘要与书内检索索引。不同 `bookId` 的数据 MUST 相互隔离。

#### Scenario: 创建书籍目录
- **WHEN** 用户新建一本书
- **THEN** 系统在 `data/novels/<bookId>/` 创建约定文件结构并可成功读写元信息

#### Scenario: 书籍间隔离
- **WHEN** 用户在书 A 更新角色状态
- **THEN** 书 B 的角色与 Canon 不被修改

### Requirement: 现实向核心实体
系统 SHALL 支持现实向长篇所需的核心实体模型：书籍元信息（含文类/主题）、角色卡（含动机/秘密/声口样例等字段）、有向关系边、知情差条目、时间线锚点、伏笔（Promise）条目、卷章大纲节点、Canon 事实条目。系统 MUST NOT 将用户聊天记忆类型（profile/fact/commitment）作为小说状态的存储载体。

#### Scenario: 写入角色秘密字段
- **WHEN** 用户或 Accept 流程更新某角色的秘密/动机字段
- **THEN** 该字段持久化在该书角色存储中，且可在后续打开时读回

#### Scenario: 拒绝写入聊天记忆库
- **WHEN** 小说服务尝试将叙事事实写入聊天 MemoryStore
- **THEN** 系统 MUST NOT 执行该写入；叙事事实仅写入小说 StoryStore

### Requirement: Canon 与草稿分离
系统 SHALL 区分未接受草稿与已接受章节正文。草稿 MUST 可多轮保存；仅当用户 Accept 某章时，该章正文进入已接受集合，并将经确认的 StateDiff 应用于 Canon 与相关状态实体。

#### Scenario: 草稿不晋升 Canon
- **WHEN** 系统生成第 N 章草稿但用户未 Accept
- **THEN** Canon、伏笔生命周期与已接受章节列表不因该草稿而变更

#### Scenario: Accept 后正文可回读
- **WHEN** 用户 Accept 第 N 章
- **THEN** 该章正文以稳定路径可回读，并出现在已接受章节列表中

### Requirement: 伏笔账本生命周期
系统 SHALL 为伏笔条目维护至少包含 `planted`、`reinforced`、`paid_off`、`subverted`、`abandoned` 的状态，并记录首次出现章节与最近触及章节。休眠超过配置阈值的未回收伏笔 MUST 可被查询列出。

#### Scenario: 种植伏笔
- **WHEN** Accept 的 StateDiff 包含新种植伏笔
- **THEN** 账本新增状态为 planted（或等价初始态）的条目并关联章节号

#### Scenario: 列出休眠伏笔
- **WHEN** 某伏笔自种植后超过配置章数未强化或回收
- **THEN** 状态查询接口返回该条目于休眠/告警列表

### Requirement: 原子写入与损坏恢复
系统 SHALL 对关键 JSON 状态文件使用原子写入策略（与现有 `fsAtomic` 模式一致）。加载损坏文件时 SHALL 返回可理解错误且 MUST NOT 静默清空其他书籍数据。

#### Scenario: 写入中断不损坏旧文件
- **WHEN** 写入过程异常中断
- **THEN** 磁盘上仍保留上一次成功写入的完整状态文件，或明确进入可恢复错误态
