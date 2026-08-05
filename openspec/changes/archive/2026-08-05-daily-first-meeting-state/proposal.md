## Why

蕾姆等角色人设包含「每天第一次见面要汇报某事」的设定（如汇报当天内衣颜色）。但模型每次对话都是独立推理，**无法记住"今天是否已经首次见面"**——于是每次对话都被当成"第一次见面"，反复汇报且每次编一个不同的颜色。这需要**跨会话的按包持久化状态**：记录每个 Live2D 包"当日是否已首次对话"，首次注入"今天第一次见面，按人设完成首见行为"，同日后续注入"今天已见过面，除非主人再次询问否则不要重复"。

## What Changes

- **新增 `DailyMeetStore`（按包持久化）**：记录每个包最近一次"首次见面"的日期（`data/memory/daily-meet.json`，原子写 + 串行队列，与 memory 同目录）。存储 `{ version:1, byPackage: { [packageId]: { lastMeetDate: 'YYYY-MM-DD' } } }`。
- **`MemoryService.assemble` 注入「今日首见状态」**：组装 systemPrompt 时按当前包查询——若 `lastMeetDate !== 今天` 则标记「今天首次见面，请按人设完成首见行为」并写回今天；否则标记「今天已见过面，除非主人再次询问否则不要重复首见行为」。
- **顺带注入当前日期**：systemPrompt 增加「今天是 YYYY 年 M 月 D 日（星期X）」，一并修复"模型不知道今天几号导致编造日期"的问题（此前排查的根因）。
- 注入块始终**追加在人设之后**，作为角色行为约束，不受角色元认知覆盖。

## Capabilities

### New Capabilities

- `daily-first-meeting`: 每日首次见面状态——按包记录"当日是否已首见"、上下文注入首见/已见指令、注入当前日期

### Modified Capabilities

- `pet-agent-runtime`: 系统提示组装——新增日期注入与按包每日首见状态注入

## Impact

- **主进程**：新增 `electron/chat/dailyMeetStore.ts`（轻量按包状态存储）、`electron/chat/memoryService.ts`（`assemble` 注入日期 + 首见状态）、`electron/chat/chatController.ts`（实例化 store 传入 memoryService）
- **共享契约**：`src/chat/contracts.ts`（`DailyMeetRecord` 类型）
- **数据**：`data/memory/daily-meet.json`（gitignored）
- **测试**：`dailyMeetStore.test.ts`（跨日首次/同日非首次/并发写）、`memoryService.test.ts`（注入首见与已见文案）
- **隔离**：按包隔离（不同包各自计数），不写记忆/关系/小说
