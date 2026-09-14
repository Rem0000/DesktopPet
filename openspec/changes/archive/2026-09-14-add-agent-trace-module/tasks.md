## 1. 契约与存储骨架（P0）

- [x] 1.1 `src/trace/contracts.ts`（新增，遵循 `src/chat|novel/contracts.ts` 的共享契约约定）：事件信封 `TraceEvent`、`TraceEventMap`、`TraceHeader`、`TokenUsage`、`TraceConfig`、投影类型、读取结果与实时推送类型
- [x] 1.2 `src/chat/contracts.ts`：`ChatStreamEvent.complete` 新增 `usage?`（本轮用量），由 `chatService` 从记录器读取（`recorder.getTurnUsage()`），既有事件形状保持兼容
- [x] 1.3 seq 分配纪律由写入器 API 强制（`TraceSessionWriter.append` 内部递增并返回事件；调用方无法传入 seq），未单独建 `traceTypes.ts`
- [x] 1.4 `electron/projectPaths.ts`：`traces/` 下新增 `sessions`、`blobs`、`legacy` 子路径、`ensureDataDirs()` 创建与 `encodeTraceSegment()` 路径段转义
- [x] 1.5 `electron/trace/traceConfig.ts`：加载 `data/config/trace-config.json`（enabled/level/maxFieldChars/fsync/retentionDays/maxSessions/maxFileMB），缺失或非法回退默认，不中断聊天
- [x] 1.6 单测：`traceConfig.test.ts` 默认值、逐项非法回退、`level=off` 归一停写、版本不符回退

## 2. 写入器与崩溃修复（P0）

- [x] 2.1 `electron/trace/traceWriter.ts`：`TraceSessionWriter`（首行 header 写入、append 句柄复用、会话内串行化）
- [x] 2.2 `emit()` 同步、零 await、不抛：只入内存队列并分配稠密 seq；异常仅记诊断与丢弃计数
- [x] 2.3 write-behind 批处理（`scheduleDrain` 链 + `flush()` 屏障），fsync 档位 `never | checkpoint | turn`，默认 `checkpoint`
- [x] 2.4 大字段处理：超过 `maxFieldChars` 落 `{preview, byteLength, characters, sha256, blobRef}`，原文写 `traces/blobs/<sha256>`（`wx` 幂等）
- [x] 2.5 写入侧遮罩：`electron/trace/traceFields.ts` 复用 `redactSensitive` 全文遮罩，API Key 不入日志
- [x] 2.6 `electron/trace/traceReader.ts`：解析忽略尾部残行、seq 空洞判定损坏并保留前缀、未知类型带前向兼容标记则跳过、未知版本返回 `unsupportedVersion`；`paginateEvents` 支持分页/轮次/类型过滤
- [x] 2.7 `repairInterruptedSession` / `repairAllSessions`：为停在轮次中间的日志**追加**合成收尾（工具结果未知、节点结束、中断终态），不截断已完成轮次
- [x] 2.8 单测：`traceWriter.test.ts` + `traceReader.test.ts` 共 18 项（seq 稠密、重开续号、外置原文、meta 档不外置、遮罩、写通道不可用不抛、残行、空洞、未知类型/版本、修复幂等）

## 3. 采集接入：图节点、工具与轮次（P0）

- [x] 3.1 `electron/trace/traceRecorder.ts`：`TraceRecorder`（类型化事件 API + `span`）+ `TraceStore` 门面（`electron/trace/traceStore.ts`）
- [x] 3.2 `agentRuntime.ts`：`run({ …, trace })` 注入记录器；7 个节点经 `wrap()` 产生 `step/start|step/end` 与耗时
- [x] 3.3 `agentRuntime.ts`：`ToolBoundaryEvent` 扩展 callId/riskLevel/原始入参/真实输出；`toolBoundary` 发出 `tool/call` 与 `tool/result`
- [x] 3.4 `agentRuntime.ts`：confirm 闸门发出 `tool/confirm`（同意/拒绝 + 等待时长）
- [x] 3.5 `agentRuntime.ts`：`plan` 发出 `plan/result`（候选数、规划出的调用、被丢弃调用及原因：not_allowed/duplicate/already_succeeded/over_budget）
- [x] 3.6 `chatService.ts`：轮次边界 `turn/start`（含 requestId）/`turn/end`（completed/cancelled/error + 耗时 + 用量汇总），并**不再丢弃** `event.output`
- [x] 3.7 `chatService.ts`：用户/助手消息事件；链路写入不参与 `chat:stream` 推送路径（失败不影响回复）
- [x] 3.8 单测：`traceIntegration.test.ts` 断言节点 span、工具真实入参/输出、规划丢弃原因、首字延迟与取消终态；`chatService.test.ts` 断言轮次边界、requestId 关联与取消终态
- [x] 3.9 单测：断言 50 个流式 token 不产生逐 token 事件（事件数与 token 数无关）

## 4. 兼容层与旧日志迁移（P0.5）

- [x] 4.1 `toolTraceStore.ts`：保留 `listBySession`/`summarize` API，读取改为从链路事件折叠 `ToolTraceRecord` 投影（`projectEventsToToolRecords`）
- [x] 4.2 `migrateLegacyDayFiles()` 把旧 `traces/*.jsonl` 迁入 `traces/legacy/`，读取同时覆盖 legacy/ 与 traces 根（双读过渡）；`append()` 保留给遗留调用方与评测
- [x] 4.3 单测：投影字段等价（requestId/messageId/inputSummary/citations/回推 startedAt）、legacy 迁移后仍可读、无来源时为空且不抛
- [x] 4.4 回归：`npm test` 351 通过；`evals/run.eval.test.ts` 的 `obs-trace-stats` 与既有场景保持绿（唯一失败项 `evals/run.judge.eval.test.ts` 缺 `evals/judge/scenarios.json`，该 fixture 从未提交，与本次改动无关）

## 5. Provider 计量契约（P1，**BREAKING**）

- [x] 5.1 `src/chat/contracts.ts`：`ChatProvider.stream/planToolCalls/summarize/completeText` 返回值改为 `ProviderCallResult`/`ProviderPlanResult`（`{ text, usage?, ttftMs?, finishReason? }`）
- [x] 5.2 `deepSeekProvider.ts`：流式收集末帧 `usage_metadata`、首字延迟与 `finish_reason`；非流式取 `usage_metadata`/`response_metadata.usage`；两套字段都缺失时按字符密度估算并标记 `estimated`
- [x] 5.3 用量口径 `toTokenUsage()`：未缓存输入（prompt − 缓存读）、输出、缓存读、缓存写四类互斥，推理 token 单列不重复累加；兼容 DeepSeek 的 `prompt_cache_hit_tokens`
- [x] 5.4 更新调用点：`agentRuntime.ts`（规划 + 流式，用量/首字延迟写入 `model/result`）、`chatController.ts`（摘要 / 记忆摘要 / 关系评估 / episode 抽取的 `.text` 适配；后台 LLM 用量按非目标显式丢弃）
- [x] 5.5 更新 mock：`agentRuntime.test.ts`、`chatService.test.ts`、`memoryService.test.ts`、`agentRuntimeRelationship.test.ts`、`traceIntegration.test.ts`；`npm run typecheck` 通过
- [x] 5.6 单测：`deepSeekProvider.test.ts` 覆盖四桶互斥映射、DeepSeek 原始字段、缺失返回 undefined、CJK 估算与 `estimated` 标记

## 6. 请求、模型与检索事件（P1）

- [x] 6.1 `agentRuntime.ts`：规划前发 `request/header`（kind=plan，含工具名表与提示长度/摘要，不含凭据）；回复前发 `request/context`（预算与按来源拆分占用）
- [x] 6.2 `agentRuntime.ts`：规划与回复各发一对 `model/call`/`model/result`（类型、耗时、首字延迟、结束原因、用量、取消/失败终态）
- [x] 6.3 `agentRuntime.ts` recall 节点：记忆召回发 `retrieval/hits`（source=memory、命中 id/分数/内容摘要与耗时）
- [x] 6.4 `agentRuntime.ts` toolBoundary + `retrievalHitsFromOutput()`：知识库检索发 `retrieval/hits`（复用 hybridSearch 已算出的稀疏/向量/融合/重排分与 recallSource）
- [x] 6.5 同路径覆盖 `search_history`（source=history，命中标识回退 `sessionId/messageId/id`）；空结果如实记为空数组
- [x] 6.6 `agentRuntime.ts` recall 节点：技能路由发 `skill/route`（命中与否、技能 id、规则字符数）
- [x] 6.7 单测：`traceIntegration.test.ts` 断言检索命中字段、空命中不伪造、节点 span 完整性、模型用量与首字延迟、取消终态

## 7. 投影：用量、上下文与统计（P1）

- [x] 7.1 `electron/trace/projections.ts`：`addUsage`/`foldTokenUsage`/`foldUsageByTurn`（只从 `model/result` 折叠，避免与消息/轮次上的同值用量重复累加；`estimated` 透传）
- [x] 7.2 `foldContextPressure`：最新一次 `request/context` + provider 报告的提示规模（未缓存输入 + 缓存读 + 缓存写）与预算占比
- [x] 7.3 `foldToolStats`/`foldStats`/`summarizeSession`：次数、成功率、平均与 p95 耗时、会话轮数与终态
- [x] 7.4 `contextUsage.ts`：新增 `projectionToUsage()`；`chat:context:usage` 优先读链路投影，内存 `ContextUsageTracker` 退为快路径缓存
- [x] 7.5 单测：`projections.test.ts` 覆盖四桶折叠、按轮拆分、上下文压力、工具分位耗时、会话摘要与 TraceStore 投影入口
- [x] 7.6 单测：断言投影与摘要中不出现 cost/price/金额/单价等字段（只呈现 token）

## 8. IPC 与链路追踪台窗口（P2）

- [x] 8.1 `chatController.ts`：新增 `traces:list-sessions`（只读首行折叠摘要）、`traces:read-session`（分页 + 轮次/类型过滤 + 按轮用量）、`traces:session-summary`、`traces:export`（保存对话框）、`traces:gc`；既有 `tools:traces:stats` 保留（按工具统计，兼容旧接口），**不做跨会话聚合视图**
- [x] 8.2 `traces:live`：主进程按订阅者（webContents id）推送增量事件，发送时清理已销毁窗口；提供 `traces:live-subscribe`/`-unsubscribe`
- [x] 8.3 `preload.ts`：暴露 `petAPI.traces.*`（列表/读取/摘要/导出/清理/打开窗口/实时订阅），沿用类型化契约
- [x] 8.4 `trace.html` + `src/trace/main.tsx` + `TraceApp.tsx`：会话列表（轮数/耗时/工具成功率/累计 token/终态）+ 轮次时间轴（用户消息、节点耗时、模型卡、工具卡、检索命中、助手回复）
- [x] 8.5 工具卡可展开真实入参与真实输出（外置原文给出提示），模型卡展示 kind/耗时/首字延迟/四类 token/结束原因；失败显示错误码
- [x] 8.6 `vite.config.ts` 增加 `trace` input；`electron/main.ts` 新增追踪台窗口、托盘菜单项与 `traces:open-console`；聊天窗菜单新增「🔍 链路追踪台」入口
- [x] 8.7 `src/trace/trace.css`：深色观测台样式（状态徽章、用量高亮、卡片与节点标签）
- [x] 8.8 组件测试：`src/trace/TraceViews.test.tsx`（6 项）覆盖分组与终态、用量格式化与估算标注、外置原文提示、完整时间轴渲染、失败/未完成工具、会话列表与空态

## 9. 聊天窗接入（P2）

- [x] 9.1 聊天窗时间线改走链路投影：兼容投影补 `outputPreview`（真实输出预览），实时 `tool_call` 事件与重开回填同源，展开可见真实输出
- [x] 9.2 新增用量展示：`complete` 事件的 `usage` 显示本轮用量，`traces:session-summary` 显示会话累计，估算值明确标注（`src/chat/ChatApp.tsx` 的 `.usage-chip`）
- [x] 9.3 `toolTraceHydration.ts` 透传 `outputPreview`；`toolTraceHydration.test.ts` 断言回填含真实输出预览
- [ ] 9.4 ChatApp 用量徽章与时间线输出的**渲染**尚未纳入自动化测试（格式化与回填已有单测覆盖；ChatApp 无组件测试脚手架，改由 11.3 手动冒烟验证）

## 10. 保留、清理与导出（P3）

- [x] 10.1 `electron/trace/traceRetention.ts`：`collectTraceGarbage` 按 `retentionDays`/`maxSessions`/`maxFileMB` 清理（超限整份删除，因 seq 稠密无法从头截断），并回收 `blobs/` 中无引用的外置原文
- [x] 10.2 会话删除时一并删除链路日志（`traceLog.deleteSession`）；`traces:gc` 手动入口 + 追踪台「清理超期日志」按钮
- [x] 10.3 导出：结构化 JSON 与可读 Markdown 报告（轮次时间轴 + 模型/工具/检索/节点明细 + token 汇总），导出副本再次遮罩
- [x] 10.4 单测：`traceRetention.test.ts`（超期/超额/超限/原文回收/不越界）与 `traceExport.test.ts`（Markdown 与 JSON 内容、密钥遮罩、真实日志导出）

## 11. 评测、文档与归档（P3）

- [x] 11.1 `evals/scenarios.json` + `evals/run.eval.test.ts`：新增 5 个 `trace-*` 场景（用量必有记录或估算标记、参数与结果忠实、取消终态且保留前序事件、落盘失败不影响对话、密钥不入日志/原文/导出）；离线评测 42 → **47 场景全过**
- [x] 11.2 `npm run typecheck` 双配置通过；`npm test` 63 文件 382 通过（唯一失败项为 `evals/run.judge.eval.test.ts` 缺 `evals/judge/scenarios.json`，该 fixture 从未提交、2026-08-25 工作日志已记为既有问题，与本变更无关）
- [ ] 11.3 人工冒烟（**未完成**）：追踪台窗口渲染、实时 tail、导出对话框需人工点击（启动 Electron 会在桌面弹窗）；后端等价路径已由自动化覆盖（写入→投影→读取→导出→清理→崩溃修复→实时回调）
- [x] 11.4 崩溃语义已验证（自动化）：`traceWriter.test.ts` 覆盖"含无换行残行的强杀日志"→ 残行被忽略、追加合成收尾、`summarizeSession().lastStatus === 'interrupted'`；该用例暴露并修复了「修复前未截断残行导致收尾事件被并入残行」的缺陷
- [x] 11.5 文档：`docs/worklog/2026-09-14.md`；`highlight_resume_pet.md` 维护记录追加 2026-09-14 条目
- [ ] 11.6 `openspec archive add-agent-trace-module`：**已归档**（`openspec/changes/archive/2026-09-14-add-agent-trace-module/`），主规格同步 8 个能力（新增 `agent-trace-log` 10 条 requirement，另修改 7 个能力）；归档时 65/68 勾选，剩余项为 9.4 与 11.3 人工冒烟，见上
