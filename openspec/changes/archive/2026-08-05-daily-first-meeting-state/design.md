## Context

`MemoryService.assemble`（memoryService.ts:484）每次对话组装 systemPrompt = `[rolePrompt, relationshipLayer, memoryBlock, summaryBlock]`。rolePrompt 来自包 persona（`readPersona`）。模型没有跨对话记忆，人设里"每天第一次见面要汇报"这类**依赖当日状态**的规则无法被自然执行。

约束：最小侵入；按包隔离；不新增大依赖；与记忆/关系/小说零耦合。

## Goals / Non-Goals

**Goals:**
- 按包记录"当日是否已首次对话"（跨会话、跨应用重启持久化）
- 首次对话注入"今天第一次见面，按人设完成首见行为"；同日后续注入"今天已见过，除非被问否则不重复"
- 顺带在系统提示注入当前日期（修复日期幻觉）
- 单测覆盖跨日/同日逻辑

**Non-Goals:**
- 记录每次对话内容（已有 chat-data）
- 为每个包生成"当天固定颜色"（用户要的是"只报一次"，不是"固定颜色"）
- 修改 persona.md 文件本身（保持用户手写 canon）
- 给 UI 加开关

## Decisions

### D1. 轻量 DailyMeetStore，复用 memory 目录 + 原子写
- **选择**：新增 `electron/chat/dailyMeetStore.ts`，单 JSON `data/memory/daily-meet.json`，结构 `{ version:1, byPackage: { [packageId]: { lastMeetDate } } }`；原子写 + 串行队列（复用 `fsAtomic`）。API：`getLastMeetDate(packageId)`、`setMeetToday(packageId, date)`。
- **理由**：与 memory 同目录天然 gitignored；单文件小；复用已有原子写模式。
- **备选**：独立目录 `data/daily/` → 否决（多一处目录，无收益）；塞进 memory-data.json → 否决（污染记忆库结构）。

### D2. assemble 注入「今日首见状态 + 当前日期」
- **选择**：`MemoryService` 构造增可选 `readDailyMeet/getTodayDate` 回调（默认空实现，不注入）；`assemble` 在 rolePrompt 之后插入一块：
  - 若 `lastMeetDate !== 今天`：`【今日首见】今天是今天第一次见到主人（今天是 {日期}）。请按人设完成首见行为（如汇报当日衣着）。` 并 `setMeetToday`。
  - 若相同：`【今日状态】今天是 {日期}。你今天已经见过主人了，除非主人主动询问，否则不要重复首见行为。`
- **理由**：注入块在人设之后，作为行为约束不被角色元认知覆盖；跨日自动翻转。
- **备选**：在 planToolCalls 判断 → 否决（生成阶段同样需要，assemble 一处即可）。

### D3. 日期注入顺带修复
- **选择**：`getTodayLabel()` 输出 `2026年8月5日（星期三）` 与 `2026-08-05`。注入到同一状态块，避免单独加块。
- **理由**：一次改动解决"日期幻觉"（模型编造 2024-01-20 的根因）。

### D4. 不写 persona、不改人设文件
- 状态由代码管理；persona.md 保持用户手写。用户已把人设改成"可以使用实时网络查询的魔法"解决工具调用，本次只加"每日首见"状态层。

## Risks / Trade-offs

- **[Risk] 时区/跨日边界** → Mitigation：用本地日期（`toLocaleDateString('sv-SE')` 或手动拼 YYYY-MM-DD），按本地日切分；同日多次对话只首见一次。
- **[Risk] 注入块挤占预算** → Mitigation：固定短文案（<80 字），成本可忽略。
- **[Trade-off] 用户改了人设措辞后文案可能不匹配** → 接受：状态块是通用引导（"按人设完成首见行为"），不绑定具体角色。

## Migration Plan

纯新增：新 store + assemble 注入，默认行为改变仅在有人设首见需求时体现。回滚：移除注入块 + 删 daily-meet.json 即回退。

## Open Questions

- 是否需要清理过期包记录（删除包时）——本期不清理，文件极小；如需要可后续加。
