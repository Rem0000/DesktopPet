## MODIFIED Requirements

### Requirement: 项目数据根目录
系统 SHALL 通过 `resolveDataRoot()` 解析运行时持久化根目录，默认位于 `<projectRoot>/data/`。环境变量 `DESKTOP_PET_DATA` MUST 可覆盖该路径。所有需持久化的业务数据（聊天、记忆、知识库、trace、提醒、配置、模型权重缓存、小说工坊数据）MUST 存放在该根目录的子路径下，MUST NOT 默认写入 Electron userData（C 盘 AppData）。

#### Scenario: 默认使用项目 data 目录
- **WHEN** 应用启动且未设置 `DESKTOP_PET_DATA`
- **THEN** ChatStore、MemoryStore、KnowledgeStore、ToolTraceStore、NovelStoryStore 等使用 `<projectRoot>/data/` 下约定子目录

#### Scenario: 环境变量覆盖
- **WHEN** 设置 `DESKTOP_PET_DATA=D:\PetData`
- **THEN** 全部持久化模块（含小说工坊）使用该路径作为根目录

### Requirement: 子目录约定
系统 SHALL 使用固定子目录名：`chat/`、`memory/`、`knowledge/`、`traces/`、`logs/`、`models/`、`reminders/`、`config/`、`novels/`。模块 MUST NOT 在 data 根外散落写入持久化文件（日志路径 SHOULD 指向 `data/logs/`）。小说一书一库数据 MUST 落在 `novels/<bookId>/` 下。

#### Scenario: 首次启动创建目录
- **WHEN** 应用首次启动且 data 子目录不存在
- **THEN** 系统自动创建所需子目录结构（含空的 `novels/`）

#### Scenario: 小说数据落在 novels 子目录
- **WHEN** 用户新建一本书并保存元信息
- **THEN** 对应文件位于 `data/novels/<bookId>/`（或 `DESKTOP_PET_DATA` 覆盖后的等价路径）下，而不写入 `memory/` 或 `knowledge/`
