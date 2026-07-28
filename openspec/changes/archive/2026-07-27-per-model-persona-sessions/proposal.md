## Why

用户已支持导入并切换多个 Live2D 模型，但系统提示仍是全局一份，聊天会话也与模型无关。切换模型后继续同一会话会导致「一人设历史、另一人设回复」的混聊；同时角色口吻与用户画像、跨模型事实需要分层，否则个性化要求会串到所有模型。

## What Changes

- 为人设（角色系统提示）按 Live2D 模型包落盘：存于对应 `import-*` 目录，管理窗可编辑，**热更新**（下一轮对话立即生效）；空则使用默认桌宠提示词。
- **会话绑定模型**：一个模型对应若干聊天会话；切换模型后聊天侧栏只显示该模型的会话列表，禁止跨模型续聊。
- **删除模型级联删除**该模型下全部会话及会话摘要；全局用户记忆保留。
- **记忆边界修订**：**BREAKING** 取消全局 `preference` 写入路径；`profile` 与 `fact`/`commitment` 继续跨模型共享；模型口吻/称呼/输出规范写入人设文件（Agent 可提示「建议写入人设」），不做模型私有 preference 库。
- **移除非 Live2D 默认桌宠**：应用始终以 Live2D 运行；内置默认包为 `import-2026-07-16T09-28-47-370Z`（不可删除）。首次启动或用户导入库为空时回退到该默认包。
- 不做系统级「到点主动提醒」；共享 fact 仅保证换模型后约定仍可被召回，定时通知另开需求。

## Capabilities

### New Capabilities
- `model-persona`: 按 Live2D 包读写人设文件、热更新注入 Agent 系统提示、空人设回退默认提示；管理窗编辑入口。

### Modified Capabilities
- `live2d-model-library`: 默认内置包不可删；删光用户包后回退默认包；删除时级联清理该包聊天会话；管理窗增加人设编辑入口。
- `live2d-session-restore`: 启动与空库回退改为默认 Live2D 包，不再回退非 Live2D 皮肤。
- `pet-chrome-cleanup`: 移除/废弃「退出 Live2D / 默认非 Live2D」相关体验假设（与始终 Live2D 对齐）。
- `pet-chat-window`: 会话按当前模型过滤；切模型切换会话视图；展示当前角色上下文。
- `pet-agent-runtime`: 系统提示改为「当前模型人设（热读）或默认」；不再依赖单一硬编码角色作为唯一来源。
- `agent-memory`: 取消全局 preference；明确 profile + fact/commitment 跨模型共享；个性化不写入记忆库而写入人设。

## Impact

- Electron：Live2D 库/会话恢复、默认包保护、删除级联聊天数据；人设文件 IPC。
- 聊天：`ChatSession` 增加 `packageId`；列表/新建/删除按模型隔离；`ChatApp` 订阅模型切换。
- Agent：`MemoryService.assemble` / `DEFAULT_SYSTEM_PROMPT` 注入路径改为人设优先；废弃或改写 `remember_preference`。
- UI：管理窗人设编辑；可移除 `DefaultPet` 主路径。
- 数据：既有无 `packageId` 的会话需迁移策略（挂到默认包或一次性归档）。
- 明确不实现：本地定时任务 / 系统通知提醒。
