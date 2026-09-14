## MODIFIED Requirements

### Requirement: 子目录约定

系统 SHALL 使用固定子目录名：`chat/`、`memory/`、`knowledge/`、`traces/`、`logs/`、`models/`、`reminders/`、`config/`、`novels/`、`relationships/`。模块 MUST NOT 在 data 根外散落写入持久化文件（日志路径 SHOULD 指向 `data/logs/`）。小说一书一库数据 MUST 落在 `novels/<bookId>/` 下。链路追踪数据 MUST 落在 `traces/` 下的固定子路径：会话事件流位于 `traces/sessions/<sessionId>.jsonl`，超大字段的外置原文位于 `traces/blobs/<内容摘要>`，历史格式的旧日志位于 `traces/legacy/`（只读保留）；链路日志的清理 MUST 仅作用于上述路径内，MUST NOT 影响 `chat/`、`memory/`、`knowledge/` 等其他子目录。

#### Scenario: 首次启动创建目录
- **WHEN** 应用首次启动且 data 子目录不存在
- **THEN** 系统自动创建所需子目录结构，包含 `novels/`、`relationships/` 与 `traces/sessions/`、`traces/blobs/`

#### Scenario: 小说数据落在 novels 子目录
- **WHEN** 用户新建一本书并保存元信息
- **THEN** 对应文件位于 `data/novels/<bookId>/`（或 `DESKTOP_PET_DATA` 覆盖后的等价路径）下，而不写入 `memory/` 或 `knowledge/`

#### Scenario: 关系状态落 data 根
- **WHEN** 某包产生关系状态
- **THEN** 状态写入 `data/relationships/<packageId>.json`，不写入 Electron userData

#### Scenario: 链路数据落 traces 子目录
- **WHEN** 一次对话产生链路事件与外置原文
- **THEN** 事件流位于 `data/traces/sessions/`，外置原文位于 `data/traces/blobs/`，均不写入 data 根之外

#### Scenario: 清理不越界
- **WHEN** 触发链路日志保留策略清理
- **THEN** 仅删除 `traces/` 内超期数据，聊天、记忆与知识库数据不受影响
