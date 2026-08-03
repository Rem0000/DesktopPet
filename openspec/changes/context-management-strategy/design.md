## Context

DesktopPet 的聊天上下文组装管线：`ChatService` 把全量 `session.messages` 交给 `AgentRuntime` 的 LangGraph，图内 `normalize` 先 `trimContext(messages, 24_000)` 丢弃最老轮次，`recall` 再调 `MemoryService.assemble` 组装「人设 + 关系层 + 记忆块 + 摘要块 + 近期原文」，`model` 把最终 systemPrompt + 近期原文发给 DeepSeek。

已确认的缺陷：
1. `ensureSessionSummary` 的触发条件 `total > budget` 在 `normalize` 裁剪后计算（`recall` 收到的是已裁到 ≤24k 的消息），恒不成立 → 会话摘要几乎从不生成。
2. 预算 24k 字符偏保守（DeepSeek 64k token，中文约 1 字 ≈ 1 token），且为硬编码。
3. 对话轮次不自动沉淀，模型只靠近期窗口 + （失效的）摘要；用户引用更早原话时无逐字兜底。

策略依据：参考 Claude Code 的分层上下文——Level 0 系统提示（人设/关系，恒在）→ Level 1 可检索长期记忆（按需）→ Level 2 滚动会话摘要（压缩早期）→ Level 3 近期原文（逐字）；本 change 修通 Level 2，并把 Level 2.5「包级历史会话按需检索」作为逐字兜底。

## Goals / Non-Goals

**Goals:**
- 修通滚动会话摘要：基于**裁剪前完整历史**计算，长对话真正生成摘要；`coveredUntilMessageId` 增量推进，避免反复全量概括
- 预算默认 24k → 40k，且经 `data/config/context-config.json` 可配置
- 新增 `search_history` 工具：BM25-only、作用域当前活跃包**全部会话**、结果带出处、硬约束、窄触发
- 轻量上下文占用观测：IPC 暴露预算 + 估算占用，聊天窗展示占用水位
- 覆盖单测 + eval 场景，离线 eval 保持全绿

**Non-Goals:**
- 对话级向量索引（conversation RAG / 每轮检索）——本产品偏重，不做
- 自动 episode 沉淀到长期记忆——另行立项
- 消息级重要性加权裁剪（替换 recency 窗口）——后续优化
- 修改 LangGraph 图结构语义、工具白名单边界、IPC 主体协议
- `search_history` 进入 replan 触发集（保持单发检索）
- 新增外部依赖

## Decisions

### D1. 滚动摘要基于裁剪前完整历史：图状态增 `allMessages`
- **选择**：`AgentState` 增加 `allMessages`；`normalize` 把原始 `state.messages` 存入 `allMessages`、`messages` 仍是 `trimContext` 结果；`recall` 调 `assemble({ messages: state.allMessages, ... })`，`assemble` 内部用完整历史做 `ensureSessionSummary`、用 `trimToBudget` 产出近期窗口（两者都基于完整历史，`normalize` 的裁剪仅作图内早期边界，被 `recall` 覆盖）。
- **理由**：修复触发失效的最小改动；`model`/`plan` 继续消费 `state.messages`（近期窗口），语义不变。
- **备选**：去掉 `normalize` 裁剪、只靠 `assemble` → 否决（图内早期仍应有界，且改动面更大）。

### D2. 摘要增量推进 + 早期代表性采样
- **选择**：沿用 `coveredUntilMessageId` 缓存；`early`（完整历史 − 近期窗口）有进展才重摘要。`provider.summarize` 输入从"仅取头部 8000 字"改为**头部 + 尾部**各采样（覆盖最老设定与最新被挤出内容），避免只概括最开头。
- **理由**：滚动摘要避免每次全量重概括；head+tail 采样比纯头部更代表"被挤出窗口的对话"。
- **备选**：递归摘要（摘要再摘要）→ 本期不做，跨天超长会话再引入。

### D3. 预算默认 40k + `context-config.json` 可配置
- **选择**：`AgentRuntime` 构造预算从 `chatController` 读取：`loadContextConfig(configDir)`（`{ version: 1, budgetCharacters }`，默认 40_000，缺失按默认），校验范围 [16_000, 64_000]。
- **理由**：40k 仍远小于 64k token 上限，显著缓解日常长对话；可配置便于按设备/模型调整，且与既有 `tool-config.json` 模式一致。
- **备选**：仅常量提升 → 否决（不可调）；做成 UI 设置 → 否决（本期范围外）。

### D4. `search_history` 用 BM25-only（独立于 embedding）
- **选择**：新增 `electron/chat/historySearch.ts`，复用 `electron/retrieval/bm25Index.ts` 的 `Bm25Index` 对活跃包全部会话的 complete 消息建内存倒排，`search(query, topK)` 返回带出处的命中。
- **理由**：项目规则是 embedding 加载失败即报错（无 keyword 降级）；一个兜底工具不该被 embedding 依赖拖垮。包级消息量（百级）内存 BM25 足够快。
- **备选**：复用 `hybridSearch`（BM25+向量+RRF）→ 否决（依赖 embedding）；预建持久化索引 → 否决（会话常变，实时建更简单）。

### D5. `search_history` 输出形状与硬约束
- **选择**：输出 `{ ok, hits: [{ messageId, sessionId, role, createdAt, excerpt, score }], empty }`；`formatToolResultsForModel` 对 `search_history` 增加约束：有命中则「引用 MUST 逐字取自结果、不得补充」；`empty` 时「MUST 说明未在历史中找到，禁止编造」。工具经 `ToolRegistry` 注册（`enabled=true, riskLevel=safe`），可被 `tool-config.json` 关闭。
- **理由**：与 `search_knowledge` 同构；硬约束防"口头说找到但没搜到"。
- **备选**：复用 `KnowledgeCitation` 形状 → 否决（语义不符：历史消息无 headingPath/title）。

### D6. 规划窄触发 + 单发检索
- **选择**：`PLAN_TOOL_INSTRUCTION` 增加一条：仅当用户引用更早对话（"我之前说过…""上次你说…"）且当前上下文缺少该细节时调用 `search_history`；普通对话不要调用。`search_history` **不**加入 `REPLAN_TRIGGER_TOOLS`，单发检索后结果进模型。
- **理由**：检索是 query 驱动的兜底，窄触发避免每轮多一次工具调用与幻觉面扩大；单发保持简单（不开放"先搜再写记忆"链，防止双写与重复检索）。
- **备选**：加入 replan 触发 → 否决（扩大多轮环，当前无记忆写入诉求）。

### D7. 上下文占用观测（轻量）
- **选择**：`chat:context:usage` IPC 返回 `{ budgetCharacters, usedCharacters, ratio }`（used = systemPrompt + 近期窗口长度估算）；聊天窗在输入区旁展示占用水位（如 "上下文 42%"），超 90% 警示。
- **理由**：对齐 Claude Code 的可观测性；成本低，直观暴露预算压力。
- **备选**：仅常量/IPC 不做 UI → 否决（用户不可见则价值打折）。

### D8. 隔离与安全
- `search_history` 仅读活跃包会话（`ChatStore.listSessions(packageId)` + `getSession`），不写记忆/关系/小说；IPC/工具入参沿用 `require*` 校验；不向渲染进程回传未脱敏全文（excerpt 截断 + 时间/角色元数据）。

## Risks / Trade-offs

- **[Risk] 摘要基于完整历史每次重算可能偏慢** → Mitigation：`coveredUntilMessageId` 缓存 + head+tail 采样控制输入规模（≤8k 字符）；仅当 early 推进时重摘要。
- **[Risk] `search_history` 误用（每轮触发）** → Mitigation：规划提示窄触发 + 默认 enabled 可配置关闭 + 单发（不进 replan）。
- **[Risk] 预算提升 → 单轮 token 成本略升** → Mitigation：40k 远小于 64k 上限；摘要/记忆块按比例缩放，窗口仍受预算约束。
- **[Risk] BM25 对中文口语命中率一般** → Mitigation：兜底语义本就靠 Level 1 记忆检索；`search_history` 定位为"逐字找回"，够用即可，后续可加向量路。
- **[Trade-off] 摘要仍是有损压缩** → 接受：逐字细节靠 `search_history` 兜底，二者互补。

## Migration Plan

1. `ensureDataDirs` 预创建空 `data/config/`（已有）；无历史配置需迁移，缺失按默认 40k。
2. 新代码与现有行为并存；默认 `layered` 等既有语义不变。删除 `data/config/context-config.json` 即回退默认预算；移除 `search_history` 注册（或 `tool-config.json` 关闭）即回退旧行为。
3. 回滚：改 `AgentRuntime` 回 24k 常量、移除 `allMessages` 与 `historySearch` 注册即可，不影响聊天/记忆/关系数据。

## Open Questions

- 上下文占用指示的 UI 落点（输入区旁 vs 时间线头部）——实现时按聊天窗布局定
- `search_history` 命中是否要在聊天时间线显示引用卡片（对齐 `search_knowledge`）——本期先只展示工具调用，不加引用卡片
