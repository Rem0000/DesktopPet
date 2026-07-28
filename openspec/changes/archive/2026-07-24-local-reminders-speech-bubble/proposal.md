## Why

用户已能通过记忆记下「稍后提醒」类约定，但系统不会到点主动提醒，桌宠也缺少「角色在说话」的台词气泡。需要在应用内补齐本地定时任务与到点表现，让约定从被动召回变成主动通知。

## What Changes

- 新增独立本地提醒（Reminder）存储与主进程调度：创建、取消、到点触发；不复用 `commitment.expiresAt` 语义。
- 应用未运行期间到期的提醒：仅在下次启动时补发（不接入 OS 任务计划）。
- 同一批到期的多条提醒合并为一次展示。
- 到点文案经 Agent/LLM 按**当前激活** Live2D 模型人设改写成角色口吻；失败则降级为原文/模板；提醒本身不绑定模型。
- 桌宠主窗口展示圆角矩形台词气泡，底边左下或右下三角指向模型；按屏边自动选侧。
- Agent 白名单工具增加 `schedule_reminder` / `cancel_reminder`。
- 可选系统 Notification 作兜底（应用不可见时）；气泡为主表现。

## Capabilities

### New Capabilities
- `local-reminders`: 本地提醒 CRUD、调度、启动补发、多条合并、人设口吻改写、IPC 与 Agent 工具契约。
- `pet-speech-bubble`: 桌宠窗内圆角气泡 UI（含指向模型的底角三角）、展示/关闭/扩窗与命中区域。

### Modified Capabilities
- `pet-agent-runtime`: 白名单记忆工具之外增加提醒调度工具；plan 提示覆盖「到点提醒」场景。
- `pet-response-presentation`: 到点气泡展示时可联动桌宠 speaking/情绪状态，结束后恢复 idle。

## Impact

- Electron 主进程：ReminderStore、Scheduler、power/resume 重扫、IPC；到点短 LLM 调用（复用现有 Provider，不写入聊天会话）。
- 渲染：`PetStage` 气泡层、临时扩高宠物窗、三角侧别。
- Agent：`toolRegistry` / `MemoryService` 旁或独立 ReminderService 注册工具；plan 文案更新。
- 数据：新 JSON 落盘（如 `reminder-data.json`），与 `memory-data.json` 分离。
- 明确不做：OS 级关机唤醒、复杂 cron 重复规则、提醒绑定固定模型、TTS 朗读。
