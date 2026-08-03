## MODIFIED Requirements

### Requirement: 子目录约定
系统 SHALL 使用固定子目录名：`chat/`、`memory/`、`knowledge/`、`traces/`、`logs/`、`models/`、`reminders/`、`config/`、`novels/`、`relationships/`。模块 MUST NOT 在 data 根外散落写入持久化文件（日志路径 SHOULD 指向 `data/logs/`）。

#### Scenario: 首次启动创建目录
- **WHEN** 应用首次启动且 data 子目录不存在
- **THEN** 系统自动创建所需子目录结构，包含 `novels/` 与 `relationships/`

#### Scenario: 关系状态落 data 根
- **WHEN** 某包产生关系状态
- **THEN** 状态写入 `data/relationships/<packageId>.json`，不写入 Electron userData
