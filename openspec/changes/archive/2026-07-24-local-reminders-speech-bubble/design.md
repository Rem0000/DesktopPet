## Context

当前 `commitment.expiresAt` 仅用于召回过滤（过期不注入），不会主动到点提醒。桌宠主窗口为透明置顶 360×420，已有 Tray，无应用内台词气泡。`per-model-persona-sessions` 已明确将「本地定时 / 主动通知」另开需求；本 change 独立实现。

约束：复用现有 DeepSeek Provider；提醒不写入聊天会话历史；人设热读当前激活包；Windows 桌面、Electron 主进程调度。

## Goals / Non-Goals

**Goals:**
- 独立 Reminder 落盘与主进程调度（创建 / 取消 / 到点 / 启动补发）
- 同批多条合并为一次气泡展示
- 到点用当前激活模型人设做短 LLM 口吻改写（失败降级）
- 宠物窗内圆角矩形气泡 + 底边左下/右下指向三角
- Agent 工具 `schedule_reminder` / `cancel_reminder`

**Non-Goals:**
- OS 任务计划 / 关机唤醒
- cron 重复规则、snooze UI（可后续加）
- Reminder 绑定固定 `packageId`
- TTS 朗读
- 把提醒语义塞进 `commitment.expiresAt`

## Decisions

### 1. Reminder 与 Memory 分离
- **选择**：新建 `reminder-data.json` + `ReminderStore`，不复用 commitment。
- **理由**：`expiresAt` =「别再提」；`fireAt` =「到点说」；混用会导致过期后既不召回也不提醒的语义混乱。
- **备选**：commitment 增加 `notifyAt` → 拒绝，字段职责过载。

### 2. 调度放主进程 + 单次 next-timer
- **选择**：启动扫 overdue → 合并触发；对最近 `pending` 设 `setTimeout`；`powerMonitor.on('resume')` 后重扫。
- **理由**：与 Chat/Memory 同进程，无需额外 daemon；避免大量并行 timer。
- **备选**：渲染进程 `setInterval` → 拒绝（窗销毁/休眠不可靠）。

### 3. 未运行仅启动补发；同批合并
- **选择**：`pending && fireAt ≤ now` 在启动（及 resume 扫）时一并收集，合并为一次展示；准时触发时若积压多条同样合并。
- **合并**：1 条用原文；≥2 条先列要点再交给改写。展示后本批全部 `fired`。
- **备选**：逐条串行气泡 → 用户已选合并。

### 4. 口吻改写：短 LLM，不进会话
- **选择**：fire 时读当前激活包 `persona.md`（空则默认提示），用 Provider 单轮生成一句气泡文案；超时/无 Key/失败 → 模板降级（单条原文或多条「该提醒你：A；B」）。
- **理由**：产品要求角色口吻；不污染聊天记录与摘要。
- **不绑模型**：Reminder 无 `packageId`；改写瞬间用「当时激活」的人设。

### 5. 气泡在宠物窗内 + 临时扩高
- **选择**：`PetStage` overlay；展示时主进程/渲染协调临时增加窗口高度（向上扩展），关闭后恢复。
- **三角**：CSS `::after`；class `tail-bl` / `tail-br`；按宠物窗相对 workArea 左右余量选侧。
- **备选**：独立 BrowserWindow → 二期再考虑。

### 6. Agent 工具
- `schedule_reminder({ content, fireAt? | delayMinutes? })`：至少提供一种时间表达；入库 `pending`。
- `cancel_reminder({ id })`：仅 `pending` 可取消。
- plan 提示：用户明确「到点提醒 / N 分钟后提醒」走提醒工具，而非仅 `remember_fact`。
- 不默认双写 commitment（避免双源真相）。

### 7. 系统 Notification（可选兜底）
- 气泡为主；若宠物窗不可见或应用在后台，可额外发 Electron `Notification`；点击聚焦宠物窗。一期可实现最小路径。

### 数据模型（示意）

```ts
type ReminderStatus = 'pending' | 'fired' | 'cancelled'

type Reminder = {
  id: string
  content: string
  fireAt: string // ISO
  status: ReminderStatus
  createdAt: string
  sourceSessionId?: string
  firedAt?: string
}
```

### 到点管线

```
due batch → merge intent → load active persona
  → LLM rewrite (or fallback) → IPC pet:show-bubble
  → mark batch fired → (optional) Notification
  → bubble dismiss / timeout → pet idle + restore bounds
```

## Risks / Trade-offs

- [休眠导致 setTimeout 漂移] → resume 后全量重扫 overdue
- [口吻 LLM 慢/失败] → 严格超时 + 模板降级，气泡仍必出
- [扩窗与拖动/多屏] → 扩高时钳制在 workArea 内；关闭恢复原 bounds
- [click-through 挡住气泡点击] → 展示期间保证气泡区域可命中（临时关穿透或分区）
- [与进行中 per-model-persona-sessions 竞合] → 人设读取复用其 `readPackagePersona` / 默认提示；本 change 不依赖其会话隔离即可跑，但口吻质量依赖「当前激活包」API

## Migration Plan

- 新文件 `reminder-data.json`，无旧数据迁移。
- 回滚：停用 Scheduler 与工具注册；忽略气泡 IPC；保留 JSON 无害。

## Open Questions

无（产品决策已锁定：启动补发、合并一条、Agent 口吻、不绑模型）。
