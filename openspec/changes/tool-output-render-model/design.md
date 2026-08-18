## Context

当前 Agent 运行时把「工具结果如何呈现给模型」收敛在一个中央函数 `formatToolResultsForModel`（`electron/chat/agentRuntime.ts:296`），内部以工具名为 key 分派：`search_history`/`web_search`/`web_fetch`/技能工具有专属内容透传分支，其余成功工具落入通用分支（`:406`）折叠为「成功，可在回复中自然确认已完成，不要复述 JSON」。

该设计已造成两次真实事故：
1. **猜数字技能（§14）**：`compare_guess` 的 status/attempts 被折叠出上下文，模型拿不到真值而编造游戏胜负。
2. **RAG 引用接地（本次）**：`search_knowledge` 的 excerpt 被剥掉。真实 LLM judge 因看不到检索原文，把 grounded 回答判 1 分；隔离实验（P1 组装层确定性复现 + P3 真模型对照）证明「原文透传即逐字引用」，故障定位在组装层而非检索或模型能力。

根因是结构性的：新增工具必须手动记得补「内容透传」分支，漏了就静默退化，无强制、无测试兜底。

约束：不引入新 native 依赖；保持 LangGraph 拓扑与工具白名单/riskLevel 语义；既有单测（293 项）与 42 条 eval 场景必须保持全绿；跨工具回复策略（失败/取消/记住意图/关系意图硬约束、不可信区隔离）必须原样保留。

## Goals / Non-Goals

**Goals:**

- 每个成功工具的真实输出内容（含检索 excerpt、技能真值）MUST 进入模型上下文，不得折叠为通用占位符。
- 渲染逻辑与工具定义同住（`AgentTool.renderForModel`），新增工具天然自带渲染。
- 注册时强制「有工具必有渲染」，缺失即 fail-fast，消灭静默退化。
- 真实 judge 断言从「至少一条 pass」加严为「与 expectedPass 符合率 ≥ 阈值」，并锁定 `citation_fidelity` 场景必过。

**Non-Goals:**

- 不切换到原生结构化 tool-use（LangChain tool messages / OpenAI function result）——那会改动 DeepSeekProvider 与所有 `stream`/`planToolCalls` 调用契约，本轮不做，记为后续方向。
- 不改动检索（BM25/BGE/RRF）、白名单 enabled 语义、riskLevel 语义、IPC 协议。
- 不重写跨工具回复策略的规则本身（记住意图/关系意图/失败/取消/不可信区），只改变「成功结果渲染」的归属。

## Decisions

### D1：用 `AgentTool.renderForModel` 下放渲染，而非原生结构化 tool-use

- **选择**：`AgentTool` 新增 `renderForModel(output, guardConfig?) => string`，每个工具负责把自身 `execute` 的成功输出渲染成提示词文本。
- **理由**：保持文本 prompt 契约（provider 不变、`formatToolResultsForModel` 调用点不变），改动面最小；所有既有工具可增量补齐。
- **替代 A（原生 tool-use）**：彻底消除 prose 重渲染，但对 provider 契约、planToolCalls 输出、流式调用全是破坏性改动，收益（本轮）不抵风险。记为 Open Question / 后续。
- **替代 B（给中央 switch 补 search_knowledge 分支）**：能修眼前的 RAG bug，但不解决结构性失效模式——下一个工具仍可能静默折叠，也没有强制校验。否决。

### D2：`renderForModel` 负责内容渲染与不可信隔离，中央函数只管跨工具策略

- `renderForModel(output, guardConfig?)`：工具自行决定是否对输出做 `markUntrustedBlock/markUntrustedList`（外部/用户可写内容如检索 excerpt、网页正文必须包不可信区；记忆/提醒等自身内容不包）。
- `formatToolResultsForModel` 重构为：遍历结果 → 成功项调 `registry.get(tool).renderForModel(...)`；失败/取消项沿用现有渲染；最后叠加跨工具硬约束（记住意图、关系意图、空成功提示）。**删除通用「成功」占位符分支**。

### D3：注册强制校验，全员实现

- `ToolRegistry.register()` 在 `renderForModel` 缺失时 `throw`。不再存在「无渲染分支」的工具。
- 无内容型工具（如 schedule_reminder 的 ok）也必须有 renderForModel——渲染一句工具专属、如实的结果行（如「schedule_reminder：已设置提醒于 …」），替代通用占位符。
- 判定「结果是否进模型」不再依赖中央 switch 是否有分支，而是「工具是否实现了 renderForModel」——注册即保证。

### D4：search_knowledge 内容透传 + 引用硬约束

- search_knowledge 的 renderForModel 对齐 search_history：命中时输出「找到 N 条命中，引用 MUST 逐字取自以下 excerpt，不得补充结果外内容」，excerpt 用 `markUntrustedList` 包裹（guard maxChars/maxItems 生效）；空命中输出「未找到相关内容，MUST 如实说明」。

### D5：真实 judge 断言加严

- real 模式门槛：`agreement = |{verdict === expectedPass}| / n`，`expect(agreement).toBeGreaterThanOrEqual(0.8)`；且 `citation_fidelity` 分类 MUST 全过（`citation` 分类 2/2）。mock 模式维持确定性（agreement 恒 1.0）。

### D6：回归测试防复发

- 单测锁定「search_knowledge 结果经 `formatToolResultsForModel` 后 excerpt 仍在提示词中」——正是今天 P1 探针复现的断言。
- 单测锁定「注册缺 renderForModel 抛错」。
- judge 场景沿用既有 `citation-faithful`，靠 D5 的断言加严兜住。

## Risks / Trade-offs

- **[所有工具的提示词文本变化]** → 缓解：内容型工具逐字保留原文；ack 型工具给出准确的具体行；跑全量 `npm test` + 42 eval + 一次真 judge 抽查。
- **[renderForModel 全量实现的迁移量]** → 缓解：机械性补齐；registry 强制校验兜底不漏；测试枚举所有工具。
- **[judge real 模式非确定性]** → 缓解：阈值 0.8（留噪声余量）+ 可重复采样；mock 确定性回归不受影响。
- **[检索/网页正文进模型上下文增大注入面]** → 缓解：不可信区隔离已在，guard 限制 maxChars/maxItems；沿用 §13.2 定位（纵深防御，非沙箱）。

## Migration Plan

1. 契约与注册：`contracts.ts` 加 `renderForModel`；`toolRegistry.register()` 强制校验。
2. 工具实现：所有既有工具补 renderForModel（先搬中央 switch 既有分支，再为 search_knowledge/skills/memory/reminders/relationship 新写）。
3. 重构 `formatToolResultsForModel`：委托 + 删通用占位符 + 保留跨工具约束。
4. 评测：judge 断言加严；补回归单测。
5. 验证：`npm run typecheck`、`npm test`、42 eval、真 judge 抽查（D5 门槛）。

回滚：改动集中在主进程单文件 + 工具定义，git revert 即可原子回退；无数据迁移、无持久化格式变化。

## Open Questions

- 原生结构化 tool-use 是否值得作为下一步（彻底去掉 prose 重渲染）？——记录为后续方向，本轮不做。
- 技能真值类结果（compare_guess 的 status/attempts）是否应超出 prose 渲染、直接回填结构化上下文？——本轮先用 renderForModel 渲染成结构化文本（对齐 §14 修复），结构化回填另行评估。
