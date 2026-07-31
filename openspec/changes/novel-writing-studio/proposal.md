## Why

桌宠已具备对话 Agent、长期记忆与 Hybrid 检索，但缺少面向长篇小说的结构化写作能力。长篇现实文依赖角色心理、知情差、时间线与伏笔回收，不能复用聊天用户记忆或单靠长上下文。需要一个与聊天完全隔离的小说工坊模块，以「AI 出大纲、人审章」方式支撑长篇创作。

## What Changes

- 新增独立「小说工坊」窗口与入口（托盘/右键），不接入聊天会话与聊天记忆
- 新增一书一库的叙事状态存储（Canon、角色、关系、知情差、时间线、伏笔账本、大纲、章正文/草稿/摘要）
- 新增小说专用 LangGraph 工作流：建书 → AI 生成/修订大纲（人可改）→ 写章组装 → 草稿 → 状态 Diff → 连续性告警 → 人审 Accept
- 新增书内 Hybrid 检索索引（复用 Embedding/检索内核，与 `data/knowledge/`、`data/memory/` 分库）
- 现实向字段与面板优先：心理/秘密、关系边、知情差、时间线、声口样例；不引入玄幻设定体系
- 扩展项目数据目录约定，增加 `data/novels/`
- **不**将写作工具注册进聊天 ToolRegistry；**不**与用户 profile/fact 记忆互通

## Capabilities

### New Capabilities
- `novel-studio-shell`: 独立小说工坊窗口、书架、入口与 IPC 边界（与聊天窗口隔离）
- `novel-story-store`: 一书一库叙事状态持久化与读写契约（Canon/角色/关系/知情/时间线/伏笔/大纲/章）
- `novel-outline-workflow`: AI 生成与修订大纲，人工编辑锁定，允许正文偏离后显式 Divergence 记账
- `novel-chapter-workflow`: 写章组装、草稿生成、StateDiff 抽取、连续性 Guard、人审 Accept/Reject/改稿
- `novel-continuity-memory`: 现实向连续性记忆召回与注入预算（固定块 + 检索块），含伏笔账本生命周期

### Modified Capabilities
- `project-data-store`: 数据子目录约定增加 `novels/`，确保小说数据落在项目 `data/` 根下且可备份/gitignore

## Impact

- **前端**：新增 `src/novel/` 与 `novel.html`（模式对齐 `chat`）；桌宠菜单/托盘增加入口
- **主进程**：新增 `electron/novel/`（store/service/runtime/controller）；`main.ts` 增加独立 BrowserWindow 与 IPC
- **路径**：`projectPaths.ts` 的 `DataSubpath` 增加 `novels`
- **复用**：DeepSeek Provider、Embedding、Hybrid 检索内核、原子写文件、窗口脚手架
- **隔离**：不修改聊天 MemoryStore 语义；不把小说状态写入 `data/memory/`；不修改聊天 Agent 默认工具集
- **依赖**：无新强制外部服务；仍使用现有 LLM Provider 与本地 BGE Embedding
