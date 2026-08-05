## 1. DailyMeetStore

- [x] 1.1 新增 `electron/chat/dailyMeetStore.ts`：`DailyMeetStore(memoryDir)`；`getLastMeetDate(packageId)` / `setMeetToday(packageId, date)`；数据 `data/memory/daily-meet.json`（`{ version:1, byPackage: { [id]: { lastMeetDate } } }`），原子写 + 串行队列，缺失文件按空初始化
- [x] 1.2 `src/chat/contracts.ts` 增 `DailyMeetRecord` / `DailyMeetDatabase` 类型
- [x] 1.3 单测 `dailyMeetStore.test.ts`：首次写入/同日覆盖/跨包隔离/缺失回退/跨实例持久化

## 2. assemble 注入

- [x] 2.1 `MemoryService` 构造增可选回调 `dailyMeet`（getLastMeetDate/setMeetToday/now），默认空实现
- [x] 2.2 `assemble`：rolePrompt 后插入状态块——首见（含"今天第一次见面 + 当前日期"）或已见（"今天已见过，除非被问否则不重复 + 当前日期"）；日期用 `dateUtils.ts` 本地 `YYYY年M月D日（星期X）`
- [x] 2.3 `chatController.ts`：实例化 `DailyMeetStore`，把回调注入 `MemoryService`
- [x] 2.4 单测 `memoryService.test.ts`：注入首见文案 / 已见文案 / 无回调时零注入

## 3. 验证与文档

- [x] 3.1 `npm test` 全量通过（222）；`npm run typecheck` 通过
- [ ] 3.2 手动冒烟：同一天两次对话只首见一次；跨日（改系统日期或模拟）翻转；问"今天几号"回答正确
- [ ] 3.3 `highlight_resume_pet.md` 维护记录追加
