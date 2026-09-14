## Context

桌宠的 Agent 主链路是主进程里的 LangGraph 图（`electron/chat/agentRuntime.ts`：`normalize → recall → plan → toolBoundary → maybeReplan → model → commit`），由 `ChatService` 驱动、经 `chat:stream` 事件把增量推给聊天窗。当前观测能力只有一层：

- `ToolBoundaryEvent`（只有 start/end 两态）→ `ChatService.handleToolEvent` → ①转 `chat:stream` 事件给 UI；②写 `data/traces/YYYY-MM-DD.jsonl`（只含 requestId/sessionId/messageId/toolName/起止/成败/errorCode/latencyMs/160 字入参摘要/citations）。
- 工具真实输出在 `ChatService` 被丢弃（`event.output` 未落盘）；`startedAt` 是用 `Date.now() - latencyMs` 倒推。
- 上下文占用只有内存态 `ContextUsageTracker`（只保留最近一次），另有临时调试用的 `contextDebug` 文本日志。
- Provider（`DeepSeekProvider`）只从流式 chunk 取 `content`，LangChain 已带回的 `usage_metadata` 被丢弃——全仓没有任何 token 计量。

约束与已有惯例：运行时数据统一落 `data/`（`project-data-store` 规范）；配置走 `data/config/*.json`（`context-config.json`/`tool-config.json` 先例）；观测日志必须对疑似密钥遮罩（`agent-eval-safety` 规范）；现有评测 37/37 与 `obs-trace-stats` 场景必须保持通过；`data/` 已 gitignore。

对标对象是 DeepSeek Harness 的 `session.jsonl`：会话级 append-only 事件流 + 首行不可变 header + 会话内稠密 `seq` + epoch ms `time`，写侧对增量做打包行、读侧对布局无感，崩溃可修复，token/上下文/统计全部是从日志折叠出的**投影**，而不是另写一份聚合。

## Goals / Non-Goals

**Goals:**

- 一次对话的完整链路可复盘：用户消息 → 各节点耗时 → 模型请求与响应（含 token）→ 规划决策 → 工具真实入参与真实输出 → 检索命中 → 助手回复与轮次终态。
- 每次模型调用的 token 用量可量化、可按轮与会话聚合，缺失时明确标注估算。
- 链路写入不侵入聊天：不阻塞、不抛错、不改变回复行为；崩溃/取消有明确终态。
- 提供可演示的「链路追踪台」窗口，并保留导出能力（结构化 + 可读报告）。
- 与既有 `ToolTraceRecord` 查询、聊天窗时间线回填、历史日报文件兼容。

**Non-Goals:**

- 小说工坊链路（`novel-*`）的追踪。
- 后台 LLM 调用（episode 抽取、关系演化评估、会话摘要）的追踪——事件信封为其预留扩展位，但本次不接入。
- 逐 token（流式增量）级采集：本次完全不采集，不保留开关（见 D5）。链路只记录消息级、模型调用级与工具级信息。
- 外部 APM / 远端上传 / OTel 导出（延续「本地可演示、默认不上传」的既有决策）。
- 跨会话全局检索、链路对比、可视化火焰图等进阶分析（本次不做）。

## Decisions

### D1 事件流形态：会话级 append-only JSONL（对齐 DSH），不做 SQLite

**选择**：每会话一个 `data/traces/sessions/<sessionId>.jsonl`，首行 header + 其后每行一个事件。

**理由**：DSH 的 `session.jsonl` 已验证该形态——可用文本工具直接查、单会话单文件便于删除与导出、崩溃时只需处理尾部残行。现有 `ToolTraceStore` 已经是 JSONL 写入，团队与测试模式一致。

**备选**：SQLite（DSH 也有 `session-persistence-sqlite`）→ 否决：查询能力我们用不上，却引入建表/迁移/句柄生命周期成本，且失去"文本可直接看"的演示价值。按天文件（现状）→ 否决：按会话查询要全量扫描，且一次会话跨天被切开。

### D2 布局与首行 header

**选择**：`traces/sessions/<sessionId>.jsonl`（事件流）、`traces/blobs/<摘要>`（超大字段外置原文）、`traces/legacy/`（旧日报只读保留）。首行为不可变 header：sessionId、packageId、createdAt、provider 非敏感配置、上下文预算、工具启用快照、脱敏等级。

**理由**：列会话只需读首行（对齐 DSH `parseHeaderMeta`），会话数增长时列表渲染仍是一个文件一次 read，而不是解析全部日志。`packageId` 放 header 而不做目录分组，避免包名做路径段带来的转义问题。

**备选**：`traces/<packageId>/<sessionId>/session.jsonl`（按包分组，对齐 DSH 的 project 分组）→ 否决：包名是模型目录名，需路径段转义，收益仅是目录浏览美观。

### D3 信封、seq 与版本兼容

**选择**：事件 = `{type, seq, time, turn?, data}`；`seq` 由写入器统一分配、会话内稠密递增；`time` 为 epoch ms；header 记 `version`。读取遇未知版本 → 明确提示升级；遇未知事件类型 → 带前向兼容标记则跳过，否则该行视为不可解析。

**理由**：DSH 用稠密 seq 做完整性校验（`seq !== events.length` 即判损坏），这是低成本但很有效的自检；`ignorable` 标记让后续变更能加事件类型而不破老读取方。

**备选**：使用随机 eventId 或时间戳排序 → 否决：无法检测丢行/乱序，也让"折叠到最后状态"变复杂。

### D4 采集接缝：显式 `TraceRecorder` 注入 + Provider 返回计量（**BREAKING**）

**选择**：`AgentRuntime.run({ …, trace })` 注入记录器；图节点用 `withSpan(node, fn)` 包裹；`ChatProvider.stream/planToolCalls/summarize/completeText` 返回值从 `string` 改为携带 `{ text, usage?, ttftMs?, finishReason?, latencyMs }`。

**理由**：显式依赖可测、可断言、无隐式跨用例串味；Provider 契约变更同时解决"用量从哪来"这一根因——用量只能在 provider 调用点拿到，硬塞进回调或全局状态都更糟。

**代价**：需同步改 5 处调用点（`agentRuntime.ts` 规划与流式、`chatController.ts` 摘要/记忆摘要/状态抽取）与 2 个测试 mock（`providerFactory.test.ts`、`agentRuntime.test.ts`）。作为独立提交，便于回滚。

**备选**：① `AsyncLocalStorage` 作用域 + `currentTrace()` → 否决：签名零改动很诱人，但隐式耦合、测试需防串味，且治不了"用量必须由 provider 返回"这一点；② LangChain callbacks（`callbacks` 挂在 `ChatOpenAI` 上）→ 否决：能拿到模型级 usage，但拿不到图节点、工具边界与检索语义，仍要另建通道，等于两套机制；③ 在 `ChatService` 层包一层计时 → 否决：只能得到整轮耗时，无法分解。

### D5 事件粒度：只落消息级，不做逐 token 采集

**选择**：链路只记录消息级与调用级信息——`assistant/message`（整条回复）、`model/call`/`model/result`（用量、首字延迟、结束原因）、工具与检索事件。**不采集流式 token 增量，不提供 `captureChunks` 开关**，也不实现打包行编码。

**理由**：DSH 之所以要打包行（`text-chunks`/`reasoning-chunks`，把 N 个增量压成一行 `seq0/time0/dt[]/texts[]`），是为了保留逐 token 回放能力。桌宠要复盘的三个问题——"慢在哪、贵在哪、为什么答错"——都不需要逐 token 时序：说了什么由 `assistant/message` 覆盖，首字延迟由 `model/result.ttftMs` 覆盖，用量由同一条事件的 usage 覆盖。而逐 token 采集的代价是文件与写入量涨十倍以上（即使打包后，一行仍带数百个 `dt`/`texts` 元素）、追踪台需额外降采样、并多出一条平时不触发的代码路径与测试负担。故整项删除，而非"默认关闭"。

**备选**：① 保留为默认关闭的配置项 → 否决：无明确使用场景的开关会长期处于未验证状态，测不到也删不掉；② 默认全量落增量 → 否决：收益低、磁盘与写入压力高；③ 只落"块边界"（reasoning/text/工具参数的开始与结束）→ 本次也不做，`model/result` 的耗时已足够定位流式异常。

**将来如何加**：若确需流式节奏分析（每个字何时到达、是否中途断流），按 D3 的前向兼容规则新增事件类型即可——读取方对未知类型带标记则跳过，已有日志格式不受影响，属于纯增量变更。

### D6 脱敏与超大载荷：写入侧遮罩（本项目要求）+ 外置 blob

**选择**：写入前对全部字段套用既有 `redactSensitive` 遮罩（疑似密钥、密码、令牌），API Key 永不进入链路；单字段超过 `maxFieldChars` 时不内联原文，而是落 `preview + byteLength + sha256 + blobRef`，原文写 `traces/blobs/`；导出副本再遮罩一次。

**理由与差异说明**：DSH 的立场是"规范日志永不重写、脱敏只作用于导出副本"，并用 spill 处理体积、用附件存储隔离图片字节。但本项目 `agent-eval-safety` 明确要求观测日志对疑似密钥**遮罩落盘**，因此这里保留写入侧遮罩（更严），同时吸收 DSH 的"体积用外置而非截断"这一做法——截断会让"工具到底返回了什么"永久丢失，而外置保留了可查性，这正是本次要解决的问题。

**备选**：纯截断（现状 `summarizeToolInput` 160 字）→ 否决：这正是我们要修的缺陷；写入明文原文不做任何处理 → 否决：违反既有安全规范。

### D7 写入强度：同步 emit + write-behind 批处理 + 语义检查点 fsync

**选择**：`emit()` 同步、零 await、不抛（只入内存队列并分配 seq）；磁盘写入由批处理队列异步完成；fsync 档位 `never | checkpoint | turn`，默认 `checkpoint` = 模型请求发出前 / 工具派发前 / 节点结束 / 轮次结束。

**理由**：DSH 热路径 `Session.append` 从不 await I/O，靠 write-behind + 定时 flush 落盘，并在语义点打 fsync 检查点。桌宠的聊天是交互式的，不能让链路写入拖慢首字延迟；同时"模型已发出请求"这类点崩溃后必须可查。

**备选**：每事件 fsync → 否决：直接拖慢首字；完全不 fsync → 否决：崩溃即丢整轮链路，追踪价值大打折扣。

### D8 token 计量：取 LangChain `usage_metadata`，四桶互斥

**选择**：流式调用取最后一帧（空 content）的 `usage_metadata`，非流式取返回消息的 `usage_metadata`/`response_metadata`；映射为未缓存输入（= prompt − 缓存读）、输出、缓存读、缓存写四类互斥计数，推理 token 单列且**不重复计入**输出。缺失时按字符密度估算并标记 `estimated: true`。

**理由**：`@langchain/openai` 默认 `stream_usage` 开启，会自动带 `include_usage` 并把用量挂到末帧（已在 `node_modules` 中确认），无需自写 SSE 解析。四桶口径与 DSH `TokenUsageProjection` 一致，避免"缓存命中的输入被重复计费"这类经典错误。

**仅呈现 token、不做金额换算（已决策）**：不引入单价配置、不产出成本字段。token 本身就是可核对的一手数据；内置单价会随官方调价而过期，展示一个错误的成本比不展示更糟。该决策已落进 `agent-trace-log` 的用量投影要求与任务 7.6。

**备选**：自建 SSE/HTTP 解析取原始 usage → 否决：重复造轮子且要维护兼容；只记输入/输出两项 → 否决：无法回答"上下文复用得好不好"。

### D9 投影而非写回

**选择**：token 用量、上下文占用、工具统计全部是**读侧折叠**（纯函数：事件数组 → 投影），`ToolTraceRecord` 与既有统计接口改为从事件流折叠出的兼容投影；不额外维护可写聚合状态。

**理由**：DSH 的 `token-meter`/`session-stats` 全是投影，日志是唯一真值；双写聚合必然出现不一致，且崩溃后无法自愈。

**备选**：写入时增量维护聚合并落单独文件 → 否决：一致性与修复成本；纯内存缓存投影结果 → 采纳为读缓存（见下）。

**读缓存（已决策）**：保留 `ContextUsageTracker` 一类的内存快路径作为 IPC 读缓存，但写入侧真值只有链路日志一份；缓存丢失、过期或重启后，必须能由链路日志重算得到相同结果（任务 7.4/7.5 据此验收）。

### D10 崩溃修复：追加合成收尾，不截断已完成轮次

**选择**：启动时扫描发现日志停在轮次中间，则**追加**合成事件（未完成工具的未知结果、节点结束、轮次中断终态）；已完成轮次一律不动。

**理由**：直接对齐 DSH `interruptedTurnClosers` 的语义——"打断的轮次补收尾"比"截断到安全点"更保真，也让追踪台显示的"已中断"与真实发生的操作一致（尤其工具可能已经产生了副作用）。用户的取消走 `cancelled`，进程被杀走 `interrupted`。

### D11 保留与 GC：明确是超出 DSH 的增量

**选择**：`retentionDays`(默认 30) / `maxSessions`(200) / `maxFileMB`(32) + 手动清理入口；清理范围严格限制在 `traces/` 内。

**理由**：DSH 对日志不删不转不压缩（只有崩溃修复与 rollback 会改字节），因为它是开发者工具；桌宠是给普通用户长期运行的桌面应用，磁盘占用是本地真实诉求。因此本项按"本项目增量需求"独立成 requirement，默认保守且可关。（金额/成本不做，见 D8。）

### D12 追踪台：独立窗口 + 只读 IPC + 实时推送

**选择**：新增第五个 BrowserWindow（`trace.html` + `src/trace/TraceApp.tsx`），只读 IPC（列出/读取/导出）+ `traces:live` 增量推送事件；提供"打开原始日志"入口。界面范围限定为**会话列表 + 单会话轮次时间轴**，不做按工具聚合的跨会话统计视图（已决策）；既有 `tools:traces:stats` 接口保留用于调试与评测，但不为其新增界面。

**理由**：链路是"整轮"的，聊天窗里按消息内联的时间线放不下节点甘特与跨轮对比；独立窗口还能在演示时与聊天窗并排。

**备选**：聊天窗抽屉（改动最小，但看不到整条链路，也难做"边聊边看"的演示）→ 若工期紧张可作为 P2 降级路径；仅静态 HTML 报告 → 保留为导出功能而非主要界面。

### D13 兼容与迁移

**选择**：`tools:traces:by-session` / `tools:traces:stats` 保持可用（实现改为投影）；旧 `data/traces/YYYY-MM-DD.jsonl` 迁入 `traces/legacy/` 并在一个版本内双读；`obs-trace-stats` 评测场景与聊天窗时间线回填行为不变。

**理由**：`agent-tool-observability` 与 `pet-chat-window` 的既有 requirement 不能被推翻，只能被满足；双读期给出迁移缓冲，之后再单独变更移除 legacy 支持。

## Risks / Trade-offs

- **[Provider 契约变更破测试]** → 单独提交、先改契约与 2 个测试 mock，再改 5 处调用点；`npm run typecheck` 与 `npm test` 作为门禁。
- **[落盘原文带来隐私面扩大]**（默认 `full` 由用户选定）→ 密钥仍强制遮罩；`data/` 已 gitignore；提供一键清理与 `level: off` 完全停写；导出副本再遮罩。
- **[链路写入拖慢聊天]** → emit 零 await 不抛 + write-behind 批处理 + 默认只在检查点 fsync + 字段上限（不做逐 token 采集，见 D5）；失败只记诊断。
- **[日志无限增长占磁盘]** → retention 三项限制 + 手动 GC；清理严格限制在 `traces/` 内。
- **[追踪台渲染大会话卡顿]** → 分页 + 按轮折叠 + 按事件类型过滤；必要时对投影加缓存（缓存必须可从日志重建）。
- **[并发工具/轮次导致 seq 错乱]** → seq 由写入器集中分配（不依赖调用方），写入按会话串行化。
- **[新增窗口增加打包/维护成本]** → 复用既有窗口与 IPC 模式（`preload` 单入口、`vite` input 增加一项），打包配置已覆盖 `dist/**`。
- **[未知事件类型导致老版本读不出日志]** → 前向兼容标记 + 版本拒读提示；导出与读取都对不可解析行做隔离而非整体失败。

## Migration Plan

1. **P0 无行为变更**：新增 `electron/trace/*`（写入器/读取器/配置/投影）与契约类型 + 单测；接入事件提交但仅落 header/turn/step/message 事件；`level` 默认 `full`。
2. **P0.5 兼容层**：`toolTraceStore` 保留 API，改为从事件流折叠 `ToolTraceRecord`；旧日报迁入 `legacy/` 双读；跑 `evals/run.eval.test.ts` 确认 37/37 与 `obs-trace-stats` 不变。
3. **P1 契约切换**：Provider 返回用量（独立提交，附 mock 更新）→ 接入 `request/*`、`plan/result`、`tool/call|result`（含真实入参与输出）、`retrieval/hits`；打开用量与上下文投影。
4. **P2 界面**：IPC（列出/读取/live/export/gc）→ 追踪台窗口 → 聊天窗用量徽章与时间线改走投影。
5. **P3 收尾**：retention/GC/导出、`trace-*` 评测场景、OpenSpec 归档同步、`docs/worklog/` 与 `highlight_resume_pet.md`。
6. **回滚策略**：`data/config/trace-config.json` 设 `{"enabled": false}` 即完全停写且不影响聊天；Provider 契约提交可单独 revert；旧格式文件在双读期内始终可读。

## Resolved / Open Questions

**已决策：**

- **金额展示：不做。** 只呈现 token 用量，不引入单价表与成本字段（见 D8；已落进 `agent-trace-log` 用量投影要求与任务 7.6）。
- **读缓存：保留。** `ContextUsageTracker` 可作为 IPC 快路径，但写入真值只有链路日志一份，缓存必须可由日志重建（见 D9）。
- **跨会话统计视图：不做。** 追踪台只做会话列表 + 单会话轮次时间轴；既有 `tools:traces:stats` 接口保留用于调试与评测，不新增界面（见 D12）。
- **逐 token 采集：删除。** 不采集流式增量、不保留 `captureChunks` 开关、不实现打包行编码（见 D5）；将来需要时按前向兼容规则新增事件类型即可。

**待定**：无。本变更的实现边界已收敛到 tasks.md。
