## 1. 契约与配置

- [x] 1.1 `src/chat/contracts.ts`：`ChatMessage` 增可选 `importance?: 1|2|3`；新增 `EpisodeConfig`（enabled/minMessages/intervalMessages/maxEpisodes）与 `EpisodeDistillEvent` 遥测类型
- [x] 1.2 新增 `electron/chat/messageImportance.ts`：`scoreMessageImportance(text, role, meta?)` 纯函数（关键事实/决策/数字/提问/长度加权，助手工具成功可加分，默认 2）
- [x] 1.3 新增 `electron/chat/episodeConfig.ts`：`loadEpisodeConfig(dir)`，默认 `{ enabled:true, minMessages:6, intervalMessages:6, maxEpisodes:4 }`，缺失/非法回退默认
- [x] 1.4 `electron/chat/contextConfig.ts` 扩展：`importanceTrim`（默认 true）与 `recentWindowChars`（默认 0.7·budget）可配置，非法回退默认

## 2. 消息级重要性写入

- [x] 2.1 `chatStore.ts`：加载旧 `chat-data.json` 时 `normalizeLoadedMessage` 对缺失 `importance` 按 2 补齐（向后兼容）
- [x] 2.2 `chatService.ts`：`appendMessage('user')` 时调用 `scoreMessageImportance` 写入 `importance`；助手消息若该轮有成功工具调用则加分（取 MAX 与既有值）
- [x] 2.3 单测 `messageImportance.test.ts`：关键事实/提问/长消息/普通闲聊打分明细；旧数据加载补齐

## 3. 重要性加权裁剪

- [x] 3.1 `messageImportance.ts` 导出 `trimContextWeighted(messages, budget, { recentWindowChars, importanceTrim })`：近期窗口逐字 + 窗口外按 importance 3→2→1 补齐、保最新一条、输出保序
- [x] 3.2 `agentRuntime.ts`：`trimContext` 改为调 `trimContextWeighted`（预算与 importanceTrim 经构造参数注入，默认开启）
- [x] 3.3 `memoryService.ts`：`trimToBudget` 改调 `trimContextWeighted`（复用同一内核；`recall` 的 remaining 预算逻辑不变）
- [x] 3.4 `chatController.ts`：把 `loadContextConfig` 的 importanceTrim/recentWindowChars 传入 `AgentRuntime` 与 `MemoryService` 的 assemble 路径
- [x] 3.5 单测：预算内保最新、窗口外高重要性优先、低重要性被裁、时序不变、`importanceTrim=false` 回纯 recency

## 4. episode 自动沉淀

- [x] 4.1 新增 `electron/chat/episodeDistiller.ts`：`EpisodeDistiller(store, provider.completeText, config, now)`；`maybeDistill({ packageId, messages, config, signal })`——闸门（enabled + hasKeyFactIntent/累计未沉淀数 + 间隔）→ head+tail 采样（≤8k）→ completeText JSON 抽取 → 容错解析（仿 `parseCandidates`）→ 去重（`scoreMemoryItem` 相似度/`sourceMessageIds`）→ `writeItem({ type:'episode' })`；`hasKeyFactIntent` 导出可测
- [x] 4.2 `chatController.ts`：实例化 `EpisodeDistiller`，以串行 `evaluationQueue` + `AbortController` 模式接入 `ChatService.onChatComplete`（复用关系评估接缝）；失败/取消只日志；`loadEpisodeConfig` 注入
- [x] 4.3 `memoryService.ts` / `memoryStore.ts`：确认 `episode` 追加写入 + 向量 upsert 已生效（无代码改动则仅加单测锁定）
- [x] 4.4 单测 `episodeDistiller.test.ts`：关键事实触发、平凡闲聊不触发、间隔闸门、非法 JSON 容错、去重、敏感拒绝、禁用开关、写入后向量可检

## 5. eval 场景

- [x] 5.1 `evals/scenarios.json` + `run.eval.test.ts` 新增：`episode-distill-triggered`（关键事实触发写入 episode）、`episode-distill-skip`（闲聊不触发）、`episode-distill-disabled`（配置关闭不写入）、`importance-trim-priority`（窗口外高重要性优先保留）
- [x] 5.2 `npm test` 全量通过；`npm run typecheck` 通过

## 6. 文档与验收

- [x] 6.1 `highlight_resume_pet.md`：新增 episode 沉淀与重要性裁剪章节；维护记录追加
- [ ] 6.2 手动冒烟：长对话关键事实自动沉淀到记忆面板、超预算会话早期高重要性消息仍被保留
