## 1. Reminder 存储与类型

- [x] 1.1 新增 Reminder 类型与 `reminder-data.json` 路径约定（与 memory 分离）
- [x] 1.2 实现 ReminderStore：create / list / cancel / markFired / listDue
- [x] 1.3 为 ReminderStore 补充单元测试（落盘、取消、到期查询）

## 2. 主进程调度与到点管线

- [x] 2.1 实现 ReminderScheduler：启动扫 overdue、next-timer、`powerMonitor` resume 重扫
- [x] 2.2 实现同批合并逻辑（单条原文 / 多条要点列表）
- [x] 2.3 实现口吻改写：读当前激活包人设 → 短 LLM → 超时/失败降级模板
- [x] 2.4 到点后 IPC 通知宠物窗展示气泡，并将批次标记 fired
- [x] 2.5 （可选）后台不可见时发送 Electron Notification，点击聚焦宠物窗

## 3. IPC 与 Agent 工具

- [x] 3.1 注册 reminders 相关 IPC（create/list/cancel）与 `pet:show-bubble` / `pet:dismiss-bubble`
- [x] 3.2 实现 schedule_reminder / cancel_reminder 工具并挂到 toolRegistry
- [x] 3.3 更新 planToolCalls 提示：到点提醒走 schedule_reminder，非仅 remember_fact
- [x] 3.4 preload / contracts 暴露必要类型与 API

## 4. 气泡 UI 与窗口行为

- [x] 4.1 实现圆角矩形气泡组件 + `tail-bl` / `tail-br` CSS 三角
- [x] 4.2 按宠物窗相对 workArea 左右余量自动选三角侧
- [x] 4.3 展示时临时向上扩高宠物窗，关闭/超时后恢复 bounds
- [x] 4.4 气泡可点击关闭与超时自动关闭；穿透模式下保证气泡可命中
- [x] 4.5 气泡展示联动 speaking 状态，结束后恢复 idle

## 5. 接线与验收

- [x] 5.1 应用启动时初始化 Scheduler 并执行 overdue 补发
- [x] 5.2 手动验收：对话预约提醒 → 到点气泡口吻；多条逾期合并一条；改写失败仍出气泡
- [x] 5.3 确认提醒不写入聊天会话历史，且 Reminder 无 packageId
