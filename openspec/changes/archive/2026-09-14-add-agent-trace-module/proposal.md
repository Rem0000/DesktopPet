## Why

桌宠 Agent 主链路（LangGraph `normalize → recall → plan → toolBoundary → maybeReplan → model → commit`）目前只有「一次工具调用结束」这一个落盘点：`data/traces/YYYY-MM-DD.jsonl` 里只有工具名、耗时、成败与 160 字入参摘要（`electron/chat/toolTraceStore.ts`），而**工具输出在 `chatService.handleToolEvent` 被直接丢弃**（只留 citations）。除此之外整条链路都是黑洞：用户消息、模型请求信封、7 个节点的耗时、规划为何没调工具、上下文如何组装、**每次调用消耗多少 token（`DeepSeekProvider.stream` 把 LangChain 的 `usage_metadata` 扔掉了，全仓 grep 不到任何 usage 字段）**——全都不可见。

后果是三类问题无法复盘：某轮回复为什么慢（recall 慢还是 model 慢、TTFT 多少）、为什么贵（哪次调用烧了多少 token）、为什么答错（模型看到了哪些工具结果与检索片段、系统提示词长什么样）。同时这套链路是「可观测的 Agent 工程能力」最直接的证据，现在缺一块。

对标 DeepSeek Harness 的 `session.jsonl`（会话级 append-only 事件流 + 首行 header + 稠密 seq + 崩溃可修复 + 从日志折叠出的 token/上下文/统计投影），把桌宠的观测从「工具调用日志」升级为「完整链路追踪」。

## What Changes

- **新增会话级链路日志**：`data/traces/sessions/<sessionId>.jsonl`，append-only 事件流（首行不可变 header + 稠密 `seq` + epoch ms `time`），覆盖 `turn/step/user message/assistant message/request header/request context/plan/model call/tool call/tool confirm/tool result/retrieval hits/skill route/error`。
- **工具事件升级**：`ToolBoundaryEvent` 增加原始入参、真实输出、callId 与轮次；`chatService` 不再丢弃 `event.output`。默认 `level: full`（本机落原文），密钥仍经既有 `redactSensitive` 遮罩，超大 payload 走外置 blob + 预览 + locator。
- **Provider 契约扩展（BREAKING）**：`ChatProvider.stream`/`planToolCalls`/`summarize`/`completeText` 返回值从 `string` 改为携带 `{ text, usage?, ttftMs?, finishReason?, latencyMs }`，由 LangChain 的 `usage_metadata`（流式末帧）采集 token 用量；provider 不回 usage 时标记为估算值。
- **token 计量与投影**：四桶互斥用量（未缓存输入 / 输出 / 缓存读 / 缓存写，`reasoningTokens` 作为输出子集不重复累加）+ 按轮与会话聚合，**只呈现 token 用量、不做金额换算**；从事件流折叠出「用量投影」「上下文压力投影」，作为上下文占用与用量的真值来源（既有 `ContextUsageTracker` 可保留为读缓存，但缓存必须可从日志重建）。
- **新增「链路追踪台」窗口**：左列会话列表（轮数/总 token/耗时/成功率），右侧 turn 时间轴（step 甘特条 → 模型调用卡 → 工具卡（参数原文 + 结果 + 耗时 + citations）→ 本轮汇总），支持实时 tail、按轮折叠、一键查看原始 JSONL。
- **崩溃与取消语义**：取消记 `turn/end{status:'cancelled'}`；启动时若日志停在轮次中间，**追加**合成收尾事件（而非截断已完成轮次），使追踪台显示「已中断」而不是挂着的半截 span。
- **写入强度与保留策略**：`emit()` 同步、零 await、不抛；磁盘写入走 write-behind 批处理，fsync 档位 `never | checkpoint | turn`；`retentionDays`/`maxSessions`/`maxFileMB` + 手动 GC/导出。
- **向后兼容**：`tools:traces:by-session` 与 `ToolTraceRecord` 保留，实现改为「从新事件流折叠出的投影」，聊天窗既有时间线回填与 `evals` 的 `obs-trace-stats` 场景行为不变；旧 `YYYY-MM-DD.jsonl` 进入只读双读期。

**非目标（本次不含）**：小说工坊链路（`novel-*`）、后台 LLM 调用（episode 抽取 / 关系演化评估 / 会话摘要）的追踪。事件信封预留前向兼容规则（未知类型须带 `ignorable` 标记），后续可独立变更接入。

## Capabilities

### New Capabilities

- `agent-trace-log`: 会话级链路追踪——append-only 事件日志的格式与写入强度、脱敏与外置、读取/分页/实时推送、token 与上下文的投影、崩溃修复、保留与导出，以及追踪台界面。

### Modified Capabilities

- `agent-tool-observability`: 从「工具调用 JSONL + 汇总」升级为「会话级统一事件流中的工具事件」，要求记录工具真实入参与输出、归属轮次与 callId，并按 `ToolTraceRecord` 投影保持既有查询兼容。
- `pet-agent-runtime`: 工具观测事件契约扩展（callId、原始入参、真实输出、轮次、规划结果与丢弃原因）；每次模型调用与图节点执行须产生可观测事件；取消/中断须有明确终态。
- `pet-chat-window`: 工具时间线的数据来源改为 trace 投影；新增本轮 token 用量展示；上下文占用改为读取投影结果而非仅内存快照。
- `context-management`: 上下文占用可观测从「内存中最近一次」改为「每次请求落盘 + 由 trace 投影提供」，并补充缓存命中率等用量观测。
- `deepseek-chat-provider`: Provider 调用须上报 provider 返回的 token 用量与首字延迟（不可得时标记估算），且用量上报 MUST NOT 泄露凭据。
- `agent-eval-safety`: 遮罩范围扩展到链路日志的全部字段与导出副本；新增「轨迹忠实性」评测断言（用量必有记录或标记估算、工具参数/结果与真实执行一致、落盘失败不影响聊天）。
- `project-data-store`: `traces/` 子目录新增 `sessions/`、`blobs/`、`legacy/` 布局与保留策略约束。

## Impact

- 新增主进程模块：`electron/trace/traceStore.ts`（事件流读写/seq/崩溃修复）、`electron/trace/traceRecorder.ts`（emit 接口）、`electron/trace/projections.ts`（用量/上下文/统计折叠）、`electron/trace/traceConfig.ts`（`data/config/trace-config.json`）。
- 改造：`electron/chat/agentRuntime.ts`（节点 span + 工具事件字段 + plan 结果）、`electron/chat/chatService.ts`（turn 边界、取消终态、不再丢弃 output）、`electron/chat/deepSeekProvider.ts`（usage/TTFT/finishReason）、`electron/chat/toolTraceStore.ts`（降级为兼容投影）、`electron/chat/contextUsage.ts`（投影化）、`electron/chat/retrieval/*` 与 `memoryService`（检索命中事件）。
- 契约：新增 `src/trace/contracts.ts`（链路事件/信封/用量/投影，与 `src/chat/contracts.ts`、`src/novel/contracts.ts` 的共享契约约定一致）；`src/chat/contracts.ts` 的 `ChatProvider` 返回值变更（P1，5 处调用点 + `providerFactory.test.ts`/`agentRuntime.test.ts` mock 同步更新）。
- 新增窗口：`trace.html` + `src/trace/TraceApp.tsx` + `electron/main.ts` 第五个 BrowserWindow + `vite.config.ts` input + `electron/preload.ts` 新 IPC（`traces:list-sessions`/`read-session`/`stats`/`live`/`export`/`gc`）。
- 数据布局：`data/traces/sessions|blobs|legacy/`（`electron/projectPaths.ts`）。
- 测试与评测：`electron/trace/*.test.ts`、`src/chat/*` 兼容测试；`evals/scenarios.json` 新增 `trace-*` 场景；现有 37/37 与 `obs-trace-stats` 须保持通过。
- 文档：`openspec/specs/agent-tool-observability/spec.md` 等能力归档同步、`docs/worklog/YYYY-MM-DD.md`、`highlight_resume_pet.md` 维护记录。
