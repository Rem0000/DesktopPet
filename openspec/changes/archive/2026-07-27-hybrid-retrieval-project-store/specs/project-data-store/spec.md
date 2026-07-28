## ADDED Requirements

### Requirement: 项目数据根目录
系统 SHALL 通过 `resolveDataRoot()` 解析运行时持久化根目录，默认位于 `<projectRoot>/data/`。环境变量 `DESKTOP_PET_DATA` MUST 可覆盖该路径。所有需持久化的业务数据（聊天、记忆、知识库、trace、提醒、配置、模型权重缓存）MUST 存放在该根目录的子路径下，MUST NOT 默认写入 Electron userData（C 盘 AppData）。

#### Scenario: 默认使用项目 data 目录
- **WHEN** 应用启动且未设置 `DESKTOP_PET_DATA`
- **THEN** ChatStore、MemoryStore、KnowledgeStore、ToolTraceStore 等使用 `<projectRoot>/data/` 下约定子目录

#### Scenario: 环境变量覆盖
- **WHEN** 设置 `DESKTOP_PET_DATA=D:\PetData`
- **THEN** 全部持久化模块使用该路径作为根目录

### Requirement: 子目录约定
系统 SHALL 使用固定子目录名：`chat/`、`memory/`、`knowledge/`、`traces/`、`logs/`、`models/`、`reminders/`、`config/`。模块 MUST NOT 在 data 根外散落写入持久化文件（日志路径 SHOULD 指向 `data/logs/`）。

#### Scenario: 首次启动创建目录
- **WHEN** 应用首次启动且 data 子目录不存在
- **THEN** 系统自动创建所需子目录结构

### Requirement: Git 与备份友好
`data/` 目录 MUST 列入 `.gitignore`。README 或等价文档 MUST 说明数据位置、备份方式及从旧 userData 手动迁移步骤。

#### Scenario: 仓库 clone 不含用户数据
- **WHEN** 开发者 clone 仓库
- **THEN** `data/` 不在版本控制中，首次运行生成空数据目录
