## Context

对话上下文组装管线：`ChatService.execute` 把全量 `session.messages` 交给 `AgentRuntime` 的 LangGraph；图内 `normalize` 用 `trimContext(messages, budget)` 按时间丢弃最老消息，`recall` 再调 `MemoryService.assemble` 组装「人设 + 关系层 + 记忆块 + 摘要块 + 近期原文」。`context-management-strategy` 已把摘要改为基于完整历史滚动生成、预算默认 40k 可配置、并新增 `search_history` 逐字兜底。

仍缺的两环（该 change 明确列为 Non-Goal）：
1. **不自动沉淀**：对话轮次不自动进长期记忆，仅靠模型显式 `remember_fact`/`update_profile`；模型漏写即永久丢失。
2. **纯 recency 裁剪**：`trimContext`/`trimToBudget` 都是「从最新往回走到预算即止」，窗口外**最老的消息先丢**，不区分重要性。重要早期事实会被琐碎闲聊顶掉。

另外，`MemoryType` 已支持 `'episode'` 类型、`MemoryItem` 已有 `sourceSessionId`/`sourceMessageIds` 溯源字段，`MemoryStore.writeItem` 支持 `episode` 追加写入——**基础契约已就位**，只差产生 episode 的机制与按重要性裁剪。

约束：不改变 LangGraph 图结构语义、不新增 Agent 工具、不碰关系/小说数据路径；`ChatMessage` 是持久化契约（`chat-data.json`），新字段必须向后兼容。

## Goals / Non-Goals

**Goals:**
- 对话完成后非阻塞抽取关键事实 → `episode` 记忆（带溯源），触发有闸门、频率有限、可配置开关
- `ChatMessage.importance`（1–3）写入期启发式打分，纯函数可单测
- 超预算裁剪改为「近期窗口逐字 + 窗口外按 importance 优先」，保持输出时序，受预算约束
- 补单测 + eval 场景，离线 eval 保持全绿

**Non-Goals:**
- 给 Agent 新增写作记忆的工具（保持工具白名单不变；episode 由后台沉淀器写入）
- 对话级向量索引 / 每轮对话 RAG
- 重要性由 LLM 在每轮对话前打分（每轮一次 LLM 太贵；采用启发式 + 抽取器带 LLM）
- 修改图结构、工具边界、IPC 主体协议
- 与关系模块/小说模块耦合

## Decisions

### D1. episode 抽取挂接在 `onChatComplete` 后，复用关系评估的「串行非阻塞队列」模式
- **选择**：`ChatService.execute` 完成回复后已触发 `onChatComplete({ packageId, messages })`（`chatService.ts:221-226`）。新增一个 `EpisodeDistiller`，像 `RelationshipEvaluator` 一样由 `chatController` 以串行 `evaluationQueue` + `AbortController` 模式接入 `onChatComplete`；抽取失败/取消只记日志，绝不影响聊天。
- **理由**：无需动图结构；与关系演化评估同一接缝，模式已被验证；后台执行避免阻塞用户看到回复。
- **备选**：在 `commit` 节点内同步抽取 → 否决（阻塞回复、且图内拿不到会话归属所需的完整服务依赖）。

### D2. 触发闸门 + 频率限制，避免每轮烧 token
- **选择**：`maybeDistill` 在 LLM 抽取前检查：`config.enabled`；未抽取的消息中是否存在 `hasKeyFactIntent`（关键事实正则：决定/约定/姓名/生日/职业/偏好事实等）**或**累计未沉淀 complete 用户消息数 ≥ `minMessages`（默认 6）；距上次抽取 ≥ `intervalMessages`（默认 6 条）；否则跳过。写入时对内容做 `assertSafeMemoryContent`。
- **理由**：普通闲聊大量存在，每轮都抽是浪费；启发式命中即抽、否则攒到阈值再抽，保证「关键事实不漏」且成本可控。
- **备选**：每轮都抽 → 否决（成本高、大量空结果）；仅靠长度阈值 → 否决（关键事实可能短）。

### D3. 结构化抽取 + 容错解析，仿 `RelationshipEvaluator.parseCandidates`
- **选择**：输入 = 尚未沉淀的完整消息片段（head+tail 采样，≤8k 字符）+ 当前包 persona 片段；`DeepSeekProvider.completeText` 返回 `{"episodes":[{"content","importance"}]}`；解析用同样的「剥代码围栏 → 取首 `{` 尾 `}` → JSON.parse → 防御性字段提取」模式，非法形状返回空数组（不污染、不阻断）。`content` 去重：与既有 fact/episode 列表按归一化子串/关键词相似度（`scoreMemoryItem` 阈值）或 `sourceMessageIds` 去重。
- **理由**：LLM 形状不可靠是已知坑（novel StateDiff、relationship candidates 都因此做了规范化）；容错 + 去重保证 episode 质量。
- **备选**：要求 strict JSON mode → 否决（provider 未必支持）；不解析直接写入 → 否决（格式抖动会污染记忆）。

### D4. `ChatMessage.importance` 用写入期启发式，纯函数可测
- **选择**：`contracts.ts` 给 `ChatMessage` 增 `importance?: 1|2|3`。`ChatService` 写入用户消息时调用 `scoreMessageImportance(text, role, meta)`（纯函数，`electron/chat/messageImportance.ts`）：关键事实/决策/数字/提问/长消息加权，可选项 `hasToolSuccess` 对助手消息加分；默认 2，落盘时若未显式赋值则写入启发式结果。旧 `chat-data.json` 无该字段时按 2 处理（`normalizeLoadedMessage` 补齐）。
- **理由**：LLM 打分每轮太贵；启发式覆盖「事实/决策/提问」足够支撑裁剪；纯函数便于单测回归。
- **备选**：LLM 打分 → 否决（成本与延迟）；不做重要性只优化 recency → 否决（本 change 目标）。

### D5. 裁剪策略：近期窗口逐字 + 窗口外按重要性优先，输出保序
- **选择**：新 `trimContextWeighted(messages, budget, { recentWindowChars, importanceTrim })`（默认 `recentWindowChars = 0.7·budget`、`importanceTrim = true`）：
  1. 从最新往回尽量取满 `recentWindowChars`（逐字保序）；
  2. 剩余预算按 importance 3→2→1 从**窗口外**的消息中补齐（高重要性优先，仍保时序）；
  3. 至少保留最新一条（现有语义）。
  `MemoryService.trimToBudget` 同步改为同一内核（抽到 `electron/chat/messageImportance.ts` 导出），`recall` 的 `remaining` 预算逻辑不变。
- **理由**：recency 优先保留最近上下文连续性，importance 兜住早期关键事实；比纯 recency 或纯 importance 更稳。
- **备选**：纯 importance 全局排序 → 否决（破坏上下文连续性、token 碎片）；维持纯 recency → 否决（本 change 目标）。

### D6. 配置：复用 `data/config/`，可开关
- **选择**：新增 `electron/chat/episodeConfig.ts`（`data/config/episode-config.json`，`{ version:1, enabled?:boolean, minMessages?:number, intervalMessages?:number, maxEpisodes?:number }`，缺失回退默认）；`context-config.json` 增可选 `importanceTrim?:boolean`、`recentWindowChars?:number`（`contextConfig.ts` 只读扩展，非法回退默认）。与既有 `tool-config.json`/`context-config.json` 模式一致。
- **理由**：避免硬编码；与现有多配置风格一致；用户可关掉 episode 自动沉淀或调裁剪策略。

### D7. 隔离与安全
- episode 只写 `data/memory/memory-data.json`（`MemoryStore.writeItem({ type:'episode' })`），不写关系/小说/人设；不新增白名单工具；抽取入参脱敏（不把全文回传渲染进程）；`assertSafeMemoryContent` 拒绝密钥类内容；失败只日志不阻断聊天。

## Risks / Trade-offs

- **[Risk] 抽取 LLM 每间隔一次调用可能偏慢/失败** → Mitigation：非阻塞队列 + AbortController 可取消；失败 catch 只日志；间隔闸门限制频率；`completeText` 有 60s 超时。
- **[Risk] episode 质量参差（幻觉/冗余）** → Mitigation：结构化 JSON + 防御解析 + 去重；内容短、重要性归一化；与既有记忆同库可被用户经记忆面板审计/删除。
- **[Risk] importance 启发式误判** → Mitigation：默认 2 中位；关键事实正则保守；高/低仅 ±1；单测锁关键正则。
- **[Risk] 加权裁剪改变既有长对话行为** → Mitigation：默认 `importanceTrim=true` 时窗口外高重要性才可能保更多早期内容；总预算不变；`trimContextWeighted` 单测断言「预算内、保最新、高重要性先于低重要性」。
- **[Trade-off] 重要性是写入期静态打分，非语义** → 接受：LLM 语义打分留给 episode 抽取器（长周期），裁剪用便宜启发式。

## Migration Plan

1. 新增字段向后兼容：`ChatMessage.importance` 可选；`chatStore.normalizeLoadedMessage` 缺失按 2。
2. 新代码默认行为：episode 抽取默认 `enabled=true`、间隔 6 条；importance 裁剪默认开启，但即便开启也只在超预算且窗口外有高重要性消息时多保留早期内容，不改变正常短对话行为。
3. 回滚：删 `data/config/episode-config.json` 或把 `enabled=false` 即关闭 episode；`context-config.json` 里 `importanceTrim=false` 即回纯 recency；移除相关服务注入即可，不影响既有数据。

## Open Questions

- episode 是否要在记忆面板单独分组/打标（与 fact 区分展示）——实现时按 `type=episode` 在记忆面板加小标签即可，无需新 IPC。
- 加权裁剪是否默认开启——默认开启，但提供 `importanceTrim=false` 逃生门；实现后跑 eval 与手动冒烟确认无回归。
