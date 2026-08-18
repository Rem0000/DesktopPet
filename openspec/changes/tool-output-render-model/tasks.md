## 1. 契约与注册强制校验

- [x] 1.1 `src/chat/contracts.ts`：`AgentTool` 新增 `renderForModel(output, guardConfig?) => string` 签名
- [x] 1.2 `electron/chat/toolRegistry.ts`：`register()` 强制校验 `renderForModel` 存在，缺失 `throw`（fail-fast）
- [x] 1.3 单测：注册缺 `renderForModel` 的工具抛错；`toolRegistry.test.ts` 全绿

## 2. 工具 renderForModel 实现

- [x] 2.1 `historySearch.ts`：`search_history` renderForModel（命中 excerpt 逐字透传 + markUntrustedList + 引用 MUST 约束；空命中如实）
- [x] 2.2 `tavilyTools.ts`：`web_search` renderForModel（hits + AI answer，markUntrustedList + 逐字约束）
- [x] 2.3 `tavilyTools.ts`：`web_fetch` renderForModel（正文 markUntrustedBlock + 基于原文约束）
- [x] 2.4 `knowledgeService.ts`：`search_knowledge` renderForModel（新写：命中 excerpt 透传 + markUntrustedList + 引用 MUST 逐字；空命中如实）——关键修复
- [x] 2.5 `skills/skillRegistry.ts`：技能结果 renderForModel（含 compare_guess 真值 status/attempts 渲染，对齐 §14 修复）
- [x] 2.6 `memoryService.ts`：`update_profile` / `remember_fact` / `forget_memory` 工具专属成功行（替代通用占位符）
- [x] 2.7 `relationshipService.ts` 与提醒工具：`update_relationship` / `schedule_reminder` / `cancel_reminder` 专属成功行

## 3. 重构 formatToolResultsForModel

- [x] 3.1 `agentRuntime.ts`：成功项改为委托 `registry.get(tool).renderForModel(output, guardConfig)`，删除通用「成功，不要复述 JSON」占位符分支
- [x] 3.2 保留跨工具策略：失败/取消/记住意图/关系意图硬约束、空成功提示、不可信区隔离不变
- [x] 3.3 回归单测：`search_knowledge` 结果经 `formatToolResultsForModel` 后 excerpt 仍在提示词中（即今天 P1 探针的断言，防复发）
- [x] 3.4 回归单测：既有 guard 场景（web 结果隔离、记忆非指令）与既有工具相关 eval 场景保持绿

## 4. 评测断言加严

- [x] 4.1 `evals/run.judge.eval.test.ts`：real 模式断言改为「与 expectedPass 符合率 ≥ 0.8」+ `citation` 分类必过（2/2）
- [x] 4.2 mock 模式保持确定性回归（verdict === expectedPass），`judgePrompt.test.ts` 适配
- [x] 4.3 `evals/judge/scenarios.json` 复核 citation-faithful / citation-fabricated 标注仍准确

## 5. 验证与文档

- [x] 5.1 `npm run typecheck` 双配置通过
- [x] 5.2 `npm test` 全量绿（现有 293 项 + 新增，无回归）
- [x] 5.3 `npm run eval:judge`（mock）绿；有 `DEEPSEEK_API_KEY` 时真跑一次并满足 D5 门槛
- [x] 5.4 更新 `docs/worklog/` 当日日志与 `highlight_resume_pet.md` 维护记录（含事故根因与本重做）
