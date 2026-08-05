# DesktopPet 简历技术亮点与面试问答

> 目标岗位：**大模型应用 / 智能体（Agent）** · 目标时间：**今年秋招**  
> 随开发同步维护。OpenSpec 路线：`agent-platform-resume-track`（Agent 主线）、`novel-writing-studio`（小说工坊）。  
> TTS/本地音色已调研后搁置（4060 8GB 显存紧张），**本期不作为交付与简历主叙事**。

## 项目一句话（秋招版）

基于 Electron + React + Live2D 的 Windows 桌面智能体：主进程 DeepSeek + LangGraph 编排，具备**可插拔工具白名单**、**confirm 安全闸门**、**有限多轮工具环**、**跨模型共享长期记忆**、**按模型人设/会话隔离**，以及**工具调用可观测、Hybrid 检索记忆/RAG 与离线评测**的端侧 Agent 平台；并扩展**独立小说工坊**——长篇现实向叙事状态机（Canon 闸门、伏笔账本、知情差）+ 固定块/检索块写章上下文，与聊天记忆零耦合；另新增**活的关系状态（亲密度）**——好感温度随对话实时增减、三种策略化注入、慢速人审演化，永不改写人设；并落地**分层上下文工程**——滚动会话摘要、可配置上下文预算、包级历史会话按需检索，长对话不再遗忘上文。更进一步：对话关键事实**自动 episode 沉淀**到长期记忆（非阻塞抽取 + 触发闸门 + 去重）、**消息级重要性加权裁剪**（超预算时窗口外高重要性消息优先保留）、助手回复 **Markdown 安全渲染**（仅助手消息、流式期纯文本、raw HTML 转义）。

## 简历包装标题（建议）

**基于 Electron + LangGraph 的桌面智能体系统（工具编排 · 长期记忆 · 本地 RAG · 长篇叙事工坊）**

## 简历 Bullets（可直接改写）

1. 独立开发桌面智能体应用：Electron 主进程承载 DeepSeek 流式对话与 LangGraph 图编排（recall → plan → toolBoundary → model → commit），渲染进程多窗口隔离，API Key 仅存主进程 safeStorage。
2. 设计可扩展 Tool Registry 与白名单工具边界（记忆写入/遗忘、本地提醒、知识库检索），将 Agent 工具调用与本地持久化、桌宠气泡/系统通知联动；并建设工具调用链路可观测（JSONL 耗时/成功率、聊天时间线、入参脱敏）。
3. 实现分层长期记忆（跨模型共享画像/事实 vs 按模型人设）与 **Hybrid 可检索召回**（BM25 + BGE 向量 + RRF 融合）；落地本地知识库 RAG（Markdown 结构切块、headingPath 元数据、`search_knowledge`、引用溯源）与 20 条离线评测集（工具/记忆/RAG，离线 eval 全绿）。
4. 设计独立**小说工坊**模块：一书一库 StoryStore（角色/关系/知情差/时间线/伏笔账本），写章流水线 `assemble → draft → StateDiff → Continuity Guard → 人审 Accept`；Accept 才晋升 Canon 并重建书内 Hybrid 索引；复用检索内核但数据路径与聊天记忆/知识库严格隔离；全书预览与 Markdown/HTML/PDF 导出。
5. 实现**活的关系状态（亲密度）**：按模型包隔离持久化好感温度（0–100 五段关系阶段）、`update_relationship` 白名单工具按对话实时增减（±10 clamp、人设优先冻结）、`MemoryService.assemble` 分层注入（persona 不可变种子 + 关系块 + 演化覆盖）、**慢速人审演化**（阈值+事件驱动反思 → 候选 → 人审接受才生效，永不改写 persona.md），与记忆/小说零耦合。
6. 实现**分层上下文工程**：修复长对话"忘上文"——会话摘要改为基于**裁剪前完整历史**的滚动摘要（`coveredUntilMessageId` 增量推进）、上下文预算 24k→40k 且 `data/config/` 可配置、新增 `search_history` 工具按需检索当前包**全部历史会话**原话（BM25-only、带出处、窄触发）、上下文占用水位可观测。
7. 实现**对话关键事实自动 episode 沉淀**：每轮对话完成后主进程**非阻塞**抽取关键事实写入 `episode` 记忆（带会话/消息溯源）；触发闸门（关键事实意图或累计未沉淀消息达阈值）+ 间隔限频 + 与既有记忆去重，`data/config/episode-config.json` 可开关；普通闲聊零调用、抽取失败只日志不阻断聊天。
8. 实现**消息级重要性加权裁剪**：`ChatMessage` 增写入期启发式 `importance`（关键事实/提问/长消息/工具成功加权），超预算裁剪改为「近期窗口逐字保留 + 窗口外按 importance 高→低补齐、输出保序」，`context-config.json` 可配 `importanceTrim`；让重要的早期事实不再被琐碎闲聊顶掉。
9. 实现**助手回复 Markdown 安全渲染**：助手消息以 `react-markdown` 渲染（标题/列表/代码块/表格/引用/链接，`remark-gfm`），用户消息保持纯文本；流式期逐字纯文本、完成态一次渲染；raw HTML 由渲染器默认转义为纯文本（不产生可执行 DOM 节点，符合 CSP）。

> 第 2、3 条中「可观测 / 可检索 / RAG / 评测」已在 `agent-platform-resume-track` 落地；离线 eval **32/32** 通过（见 `evals/`）。第 4 条对应 OpenSpec `novel-writing-studio`（26/26 tasks 已落地）。第 5 条对应 `living-pet-relationship`（36/36 tasks 已落地，详见 §10）。第 6 条对应 `context-management-strategy`，详见 §11。第 7–9 条对应 `episode-memory-importance-trimming` 与 `assistant-markdown-rendering`，详见 §12。

## 离线评测指标（当前）

| 集合 | 场景数 | 通过 | 覆盖 |
|------|--------|------|------|
| `evals/scenarios.json` | 37 | 37 | 工具开关/观测脱敏、记忆检索与安全写入、RAG 命中/隔离/引用、关系路由/分层渲染/记忆隔离/人设优先拦截、历史会话检索/摘要触发/RAG 开关、episode 自动沉淀/去重/开关、重要性加权裁剪 |

运行：`npm test -- --run evals/run.eval.test.ts`

## 8–10 周落地路线（秋招）

| 阶段 | 周次 | 交付 | 简历/面试价值 |
|------|------|------|----------------|
| P0 | 1–3 | 工具平台化 + 调用链可观测 + 聊天时间线 | 「不是调 API，是平台化 Agent」 |
| P1 | 4–6 | 记忆检索、pin/衰减、top-k 预算注入 | 「记忆工程，而非聊天日志」 |
| P2 | 7–8 | 本地 md/txt RAG + 引用展示 | 「检索增强与降幻觉」 |
| P3 | 9–10 | ≥20 条 eval + confirm 闸门 + 敏感遮罩 | 「有指标、有安全边界」 |

当前进度：P0–P3 与验收材料已落地（OpenSpec tasks 全勾选）；`novel-writing-studio` 一期 26/26、`living-pet-relationship` 36/36、`context-management-strategy` 已落地；`episode-memory-importance-trimming`（episode 自动沉淀 + 消息级重要性裁剪）与 `assistant-markdown-rendering`（助手 Markdown 渲染）已落地；TTS 仍搁置。长对话上下文遗忘已修复（见 §11 与文末「已知问题与待办」）。

## 技术亮点（可写简历）

### 1. Electron 多窗口架构与进程隔离
- 透明置顶桌宠窗、模型管理窗、独立聊天窗职责分离；聊天不挤压 Live2D 画布。
- 敏感 LLM 凭据仅存主进程（safeStorage），渲染进程只拿脱敏配置。

**面试可答：**
- 为什么聊天要独立窗口？透明置顶窗适合展示，不适合 IM 式输入与任务栏体验；独立窗可单独聚焦/关闭且不影响桌宠。
- 为什么 API Key 不能放渲染进程？渲染进程可被调试器查看，且易误写入前端存储或日志；主进程 + 白名单 IPC 是桌面应用常见安全边界。

### 2. DeepSeek Provider + 流式协议
- OpenAI 兼容接口接入 DeepSeek；统一错误归类（配置/鉴权/限流/网络/超时/取消）。
- 基于 requestId 的流式事件与取消，会话级并发保护。

**面试可答：**
- 如何设计流式 IPC？send 返回 requestId；主进程用 AbortController；chunk/complete/error 事件带回 requestId/sessionId，窗口销毁时按 sender 取消。
- 为什么去掉本地假回复？失败伪装成成功会破坏可观测性；应显式错误 + 重试。

### 3. LangGraph Agent 运行时（核心叙事）
- 主进程 StateGraph：`normalize → recall → plan → toolBoundary → maybeReplan ⇄ toolBoundary → model → commit`。
- 对话前 `planToolCalls` 规划工具；白名单执行（记忆 / 提醒 / 知识库），默认无 Shell/文件副作用。
- **有限多轮工具环**：首轮可并行多工具；仅 `search_knowledge` 触发二次规划（先检索再写记忆），硬上限轮数/调用次数防失控。
- 上下文组装：**当前人设** + 共享画像/事实 + 会话摘要 + 近期原文（字符预算裁剪）。

**面试可答：**
- 为什么上 LangGraph 而不是直接调 ChatAPI？为会话状态、工具节点、中断、观测与扩展留统一编排层。
- Agent 和普通 ChatBot 差别？图编排 + 状态提交 + 工具边界 + recall 组装；能主动写记忆/建提醒，而不是纯多轮补全。

#### 难题场景：同句「查知识库 + 记住」只触发了检索（P0 加固）

**Q：你遇到过什么样的难题？怎么解决的？**

**难题：**  
用户一句里同时要求「查知识库」和「记住某某」。设计上期望路径是「先 `search_knowledge` → 二次规划 → `remember_fact`」，运行时也支持同轮最多 3 个不同工具。但实测经常**只出检索**：规划提示偏置「优先 search」、再规划注记过软（「若仍需…否则不要」），第二轮常空规划；最终生成模型又**口头声称「已记住」**，工具时间线却没有记忆写入——观测与事实不一致，面试 Demo 会翻车。

更细一层：若用户说的是「记住我喜欢简洁的回答」，产品规则本就把**口吻/输出规范**归人人设、禁止写 `preference`/`remember_fact`；规划器不写记忆其实合理，但生成侧仍假装已记住，属于**缺工具结果约束的幻觉**。

**怎么解决（三层约束，不靠再调一次大模型碰运气）：**

1. **规划提示（plan）**：同条多意图时，记忆不依赖检索结果可**同轮并行** `search_knowledge` + `remember_fact`/`update_profile`；依赖检索结论则先搜；并写明「禁止只用口头声称已记住」。
2. **再规划注记（replan）**：用户明确要求记事实且本轮尚无成功记忆写入 → **MUST** 规划记忆工具；若是口吻/输出规范 → **禁止**调记忆工具，引导改人设。
3. **生成侧硬约束（model 前）**：扩展 `formatToolResultsForModel`——有「记住」意图但无成功的 `remember_fact`/`update_profile` 时，注入「禁止声称已经记住」；输出规范类额外要求提示编辑人设。配合意图启发式（`hasRememberIntent` / `isPersonaStyleRememberRequest`）可单测回归。

**面试一句话收束：**  
「工具环不是只把 LLM tool_calls 接上就完了——多意图下要区分**该写记忆 vs 该改人设**，并用规划/再规划/生成三层约束堵住『口头已完成、工具未执行』的假成功。」

**Demo 对照话术：**

| 话术 | 期望行为 |
|------|----------|
| 「…验收标准是什么？另外把结论记住。」 | 检索后出现 `remember_fact`（或同轮并行） |
| 「…验收标准是什么？另外，记住我喜欢简洁的回答。」 | 只检索；回复提示改人设，**不说已记住** |

### 4. 可插拔工具平台 + 可观测性（P0 · 秋招主加分）
- ToolRegistry 统一注册：schema、enabled、riskLevel、handler；新增工具不改聊天 IPC 主干。
- 工具调用 JSONL 观测：requestId/sessionId/tool/latency/ok；入参脱敏。
- 聊天窗工具调用时间线：成功/失败/耗时可折叠展示。

**面试可答 / Demo：**
- 「我把记忆和提醒抽象成可注册工具；现场发一句同时触发记事实+建提醒，时间线能看到两步调用与耗时。」
- 如何避免任意插件风险？代码内注册 + 白名单 + 配置开关，不做用户脚本热加载。

### 5. 分层长期记忆 → 可检索记忆（已有 + P1）
- 独立 `memory-data.json`：与聊天原文分离；**全局共享** profile / fact / commitment。
- **不按模型存 preference**：口吻写入人设文件；会话按 `packageId` 隔离防串戏。
- 记忆召回与知识库 RAG **共用 Hybrid 检索内核**（`hybridSearch`）：BM25 稀疏 + BGE-Small-ZH-v1.5 向量 + RRF 融合 + 线性 Rerank；支持 pin、衰减、top-k + token 预算注入；运行时数据统一落项目 `data/` 目录。

**面试可答：**
- 记忆和聊天记录有何区别？聊天是事件日志；记忆是可召回、可编辑、可过期的结构化知识。
- 数据与模型权重缓存于项目 `data/`（非 C 盘 userData），便于演示与备份。

### 6. 本地知识库 RAG + Hybrid 检索（P2 · 硬核加分）
- 知识库与用户记忆**分库**：导入 md/txt → **结构感知切块**（按 `#`/`##`/`###` 分段，超 800 字二次切分、80 字 overlap，保留 `headingPath`）→ 双索引写入（`index.json` 元数据 + `vectors.json` 向量）→ Agent 调用 `search_knowledge` 召回。
- Embedding：`Xenova/bge-small-zh-v1.5` 本地 ONNX，512 维，mean pooling + L2 normalize；权重缓存于 `data/models/`。
- 回答展示引用来源（标题、headingPath、片段）；无命中不伪造引用，降低幻觉。

#### Hybrid 检索（稀疏 + 稠密双路召回）

**是什么：** 不只用向量 top-K，而是**稀疏关键词检索**与**稠密语义向量检索**并行召回，再融合排序，取长补短。

| 召回路 | 方法 | 擅长 | 短板 |
|--------|------|------|------|
| **稀疏（Sparse）** | BM25 + CJK n-gram 分词 | 精确词、专有名词、技术栈缩写 | 「秋招路线」搜不到「求职规划」 |
| **稠密（Dense）** | BGE 向量 + 余弦相似度 | 语义相近、换说法也能命中 | 精确短语/编号有时不如关键词 |

**本项目流水线**（`electron/retrieval/hybridSearch.ts`，记忆与 RAG 共用）：

```
query
 ├─ BM25 稀疏检索 ──→ top-20
 └─ BGE 向量检索 ──→ top-20
         ↓
   RRF 融合（k=60）──→ 候选 top-10
         ↓
 线性 Rerank ──→ 最终 top-K
 score = 0.35×BM25 + 0.55×向量 + 0.1×元数据加分
```

1. **双路并行召回**：BM25 对 chunk 文本建倒排索引；query 同时 embedding 后与各 chunk 向量算余弦相似度，各取 top-20。
2. **RRF 融合（Reciprocal Rank Fusion）**：两路分数尺度不同，不能直接相加；RRF 只看**排名**：`score += 1/(k+rank)`（k=60）。两路都靠前的 chunk 融合分更高。
3. **轻量 Rerank**：对 RRF 候选 top-10 做线性加权：`α·norm(BM25) + β·norm(向量) + γ·metadataBoost`（默认 α=0.35、β=0.55、γ=0.1）。RAG 侧 metadata 含 **headingPath 匹配加分**（query 词出现在标题路径则加分）；记忆侧含 pin/importance 等。
4. **召回来源标记**：每条结果带 `recallSource`（`sparse` / `vector` / `both`），便于观测哪一路命中。

**向量化文本格式**（切块入库时）：`{title}\n{headingPath}\n{content}`，标题与章节路径一并 embedding，提升结构化文档检索效果。

**检索示例：**

| 用户 query | BM25 | 向量 | Hybrid 效果 |
|------------|------|------|-------------|
| `LangGraph Agent` | 精确命中 | 语义相关 | 两路均强，排名靠前 |
| `桌宠怎么调用工具` | 字面弱 | 语义强 | 主要靠向量路召回 |
| `P0 工具平台` | 标题精确匹配 | 一般 | BM25 + heading 加分拉高 |

**与纯向量 RAG 的区别：** 纯向量只做 embedding 相似度；Hybrid 在中文场景对专有名词、项目名、章节标题更稳，同时保留语义泛化能力。

**面试可答 / Demo：**
- 「导入一份项目说明，问细节；回答下方能看到引用片段与 headingPath，说明不是裸模型瞎编。」
- 「为什么不用纯向量？BM25 补精确词，向量补语义；RRF 融合不需要标定训练数据，RRF + 线性 rerank 可解释、CPU 友好。」
- 离线 IR 评测：`evals/retrieval/` 输出 P@4、R@4、MRR@10（`npm run eval:retrieval`）。

### 7. 评测与安全（P3 · 体现工程闭环）
- ≥20 条本地场景：工具正确率、记忆一致性、RAG 命中。
- confirm 级工具需用户确认；观测与 UI 敏感信息遮罩。

**面试可答：**
- 如何证明改动有效？跑同一 eval 集对比通过率/命中率，而不是只 demo 一次好运。

### 8. 独立小说工坊：长篇叙事状态机（Agent 平台延伸 · 硬核加分）

- **独立窗口与模块**：`novel.html` + `src/novel/` + `electron/novel/`，不挂聊天 LangGraph；复用 DeepSeek Provider 与 Hybrid 检索内核，API Key 仍只在主进程。
- **一书一库 StoryStore**：`data/novels/<bookId>/` 原子写 JSON + Markdown 正文；结构化实体含 `canon`、`characters`、`relationships`、`knowledge`（知情差）、`timeline`、`promises`（伏笔账本）、章摘要与书内 `index/`。
- **Accept 才入 Canon**：草稿可多轮修订；仅 Accept 后晋升正文、更新叙事状态、写章摘要并重建书内索引——人审闸门是长篇一致性的产品真相来源，拒绝自动抽取污染 Canon。
- **写章流水线**（`novelRuntime`）：`assemble`（固定块 ~6k + Hybrid 检索块 ~8k）→ 流式 `draft` → LLM `extractDiff` → `Continuity Guard`（时间矛盾、知情越权、已死角色出场、伏笔提前回收等结构化告警，**不**自动改文）→ UI 展示 Diff/告警 → 用户 Accept/Reject。
- **固定块 + 检索块上下文**：固定块始终注入本章大纲卡、POV 角色摘要、未回收高优先级伏笔 top-N、上一场结尾钩子、声口样例；检索块走书内 Hybrid 索引召回相关角色/知情/时间线/章摘要/正文片段。
- **大纲工作流**：AI 生成/整份修订/单章修订；大纲可人工锁定；正文 Accept 若偏离大纲记录 Divergence 笔记，不自动覆盖大纲。
- **全书预览与导出**：拼接已 Accept 章节为连续稿；按需导出 Markdown / HTML（Word 可开）/ PDF（`printToPDF`），不另存双份正文。
- **与聊天零耦合**：Accept 章节不写入 `data/memory/` 或 `data/knowledge/`；聊天 Tool Registry 无小说写作工具；15 条单测覆盖隔离、Canon 闸门、StateDiff 规范化、书内索引、稿本导出。

#### 难题场景：LLM 返回 object 形 StateDiff 导致 Accept 崩溃

**Q：写章 Accept 时遇到过什么坑？**

**难题：**  
LLM 抽取 StateDiff 时常把数组字段写成 `{ "0": {...}, "1": {...} }` 而非 JSON 数组；`applyStateDiff` 里 `for...of` 直接迭代会抛 `object is not iterable`，Accept 整条链路中断。

**怎么解决：**

1. **`normalizeStateDiff`**：入库前统一把 object 形集合 coerce 为数组，并过滤空字段（`novelRuntime.ts`）。
2. **`applyStateDiff` 数组防护**：即使规范化漏网，迭代前也做 `Array.isArray` 兜底。
3. **单测回归**：`novelStateDiffNormalize.test.ts` 覆盖畸形 Diff + Accept 全流程。

**面试一句话收束：**  
「长篇 Agent 不能只靠 prompt——结构化抽取要有 schema 规范化 + Accept 闸门，否则一次 LLM 格式抖动就会永久污染叙事状态。」

**面试可答：**
- 为什么小说不挂聊天 Agent？上下文预算、工具集、持久化模型完全不同；挂聊天会导致会话污染与记忆串库。
- 为什么 Accept 才写 Canon？自动抽取必脏；人审是长篇现实向（知情差、声口、时间线）的可维护真相来源。
- 固定块和检索块怎么分工？固定块保「必须提醒的债」（未回收伏笔、POV、钩子）；检索块补「本章相关的历史」；纯 RAG 抓不住债，纯长上下文会爆预算。
- 同章号再次 Accept 会怎样？正文/摘要/索引覆盖；叙事状态在旧状态上叠加 Diff，**不会**自动回滚——产品上要提示作者。

### 9. Live2D 资源管线与按模型人设（产品壳，辅助故事）
- Cubism 2/4 导入、模型库、会话恢复；包级 `persona.md` 热更新。
- 删模型级联该模型会话；全局记忆保留。

**面试可答：**
- 为什么会话必须绑模型？避免「前半段角色 A、后半段角色 B」混聊导致摘要与召回串味。

### 10. 活的关系状态：好感温度 + 慢速人审演化（产品级亮点）

- **按包关系状态**：`data/relationships/<packageId>.json` 单文件原子写（复用 `fsAtomic` + 串行读改写队列），含 `policy`（layered / persona-first / dynamic-first）、好感温度 `affinity`（0–100）、关系阶段 `stage`（stranger→acquaintance→friendly→close→intimate，阈值 0/30/50/70/90）、当下态度 `temperatureNote`、演化提案与 `history`；缺文件旧包按默认初始化，删 Live2D 包级联清理。
- **分轴语义**：关系标签（"谁是你"，来自 persona canon）与好感温度（"现在怎么对你"，动态层）两条轴表达为「底子是 X、当下是 Y」，模型在看似冲突时（人设写"生死之交"但刚认识）仍自洽理解；阶段内按好感进度回退三档默认态度描述（低/中/高）。
- **注入层唯一入口**：`MemoryService.assemble` 合成「persona 不可变种子 + 关系块（policy 渲染）+ 已生效演化覆盖 + 记忆块 + 摘要块」；三 policy 共用同一底层状态，仅 `renderRelationshipBlock` 纯函数不同，切换零状态迁移、下轮生效。
- **`update_relationship` 白名单工具**：模型在规划轮主动写好感 ±（单次 clamp ±10、note ≤120 字），`hasRelationshipIntent` 意图路由 + `formatToolResultsForModel` 硬约束（禁止声称写了好感但未写）；**persona-first 下冻结**——不进规划集合 + 执行拦截返回 `persona_first_policy`。
- **慢速演化 = 人审 overlay（复刻小说 Accept 闸门）**：事件驱动非阻塞评估，闸门 = affinity≥60 + 距上次评估 ≥1 天 + 每 7 天 ≤1 条生效；反思 LLM（persona 原文 + 近 40 条对话证据 → `{personaQuote, change, evidence}`）产出 `proposed` 候选 → 面板人审接受才 `applied`，以「过去→现在」句式 overlay 注入；**永不改写 persona.md**。
- **关系面板**：模型管理窗内查看/手工修正/重置、三 policy 通俗卡片、演化审阅；IPC `relationship:*` 命名空间；与记忆/小说零耦合。
- **测试**：36 条单测（store/evaluator/render/service/agentRuntime 路由）+ 4 条 eval 场景（工具注册、分层渲染、记忆隔离、人设优先拦截），离线 eval 累计 **28/28**。

#### 难题场景：persona-first 下为什么「规划过滤 + 执行拦截」双保险

**Q：关系策略切到"人设优先"时，遇到过什么问题？**

**难题：**  
persona-first 的语义是"关系以人设既定设定为准"。若只做渲染差异、仍让对话自由增减好感，用户提前写好的高亲密人设会**带偏好感信号**——本不该加分的不合适对话也会被"人设影响下的亲近感"触发加分，形成**反馈污染**：状态越暖 → 渲染越亲 → 模型越容易加分，恶性循环，且用户无从干预。

**怎么解决：**
1. **规划过滤**：`AgentRuntime.planToolFilter` 在 policy=persona-first 时把 `update_relationship` 移出模型可选工具集（`chatController.ts` 注入）。
2. **执行拦截**：即使外部构造 pendingToolCalls 绕过规划，工具执行仍返回 `persona_first_policy` 失败，好感与历史不变。
3. **恢复**：切回 layered / dynamic-first 后自动恢复自动调整；冻结期好感仅允许面板手工修正/重置改变。

**面试一句话收束：**  
「关系是『动态信号 + 人设 canon』的合成物；当策略声明『人设优先』时，规划与执行两条写入路径都要堵死，否则近因效应会让状态自我强化。」

### 11. 分层上下文工程：滚动摘要 + 包级历史检索（核心叙事）

- **四层上下文架构**（对齐 Claude Code 的做法）：Level 0 系统提示（人设 + 关系层，恒在）→ Level 1 可检索长期记忆（按需 Hybrid 召回）→ Level 2 滚动会话摘要（压缩早期轮次）→ Level 3 近期原文（逐字窗口）；另加 **Level 2.5** `search_history` 包级历史检索作为压缩摘要的逐字兜底。
- **修通滚动会话摘要**：原实现 `ensureSessionSummary` 的触发判断（`total > budget`）发生在 `normalize` 裁剪**之后**，收到的消息恒 ≤24k，摘要几乎从不生成——超预算早期对话被静默丢弃。修复：`AgentRuntime` 图状态增 `allMessages`（裁剪前完整历史），`recall` 用完整历史调 `assemble` 生成摘要；`coveredUntilMessageId` 增量推进，仅当被挤出窗口的早期边界前进才重摘要；`provider.summarize` 改 head+tail 采样避免只概括最开头；失败回退要点列表、不阻断回复。
- **上下文预算可配置**：默认 24k→40k 字符（仍远小于 DeepSeek 64k token 上限），`data/config/context-config.json` 可覆盖（非法值回退默认）；长期记忆/摘要/近期窗口按比例共享预算。
- **`search_history` 工具（包级全量）**：按需检索**当前活跃包全部历史会话**的已提交消息原话；仅 BM25（复用检索内核的稀疏路，**不依赖向量 Embedding**，Embedding 挂了仍可用）；结果带出处（会话/时间/角色/excerpt/score）；`formatToolResultsForModel` 硬约束——有命中必须逐字引用、无命中禁止编造；规划提示窄触发（仅用户引用更早对话且上下文缺细节时调用）、单发不进二次规划。
- **上下文占用可观测**：`chat:context:usage` IPC 暴露 budget/used/ratio，聊天窗展示 "上下文 X%" 占用水位，>90% 警示。
- **RAG 检索开关**：知识库面板一键开关对话内知识库检索（关闭后 `search_knowledge` 不进入规划、执行被拒），减少无关场景下检索内容占用上下文；持久化于 `tool-config.json`，不影响长期记忆召回与 `search_history`。

#### 难题场景：会话摘要的触发条件为什么"死"了

**Q：你修复长对话遗忘时，遇到的根因是什么？**

**难题：**  
代码里明明有会话摘要机制，但长对话就是不生成摘要。排查发现：摘要的触发判断 `total > budget` 在 `normalize` 节点**先把消息裁到 ≤24k 之后**才执行，收到的消息总量恒 ≤ 预算，判断永远不成立——摘要路径是死的，超预算的早期对话被 `trimContext` 整条丢弃、且无任何压缩兜底。这在单测里测不出来（测试直接调 `assemble` 传完整历史），真实图里永远走不到。

**怎么解决：**
1. 图状态增加 `allMessages`（裁剪前完整历史），`recall` 用完整历史生成摘要、用裁剪结果做可见窗口——职责分离。
2. 摘要按 `coveredUntilMessageId` 增量推进，避免每次全量重概括；`provider.summarize` 输入改 head+tail 采样。
3. 补一条"通过 AgentRuntime 跑长历史"的回归单测 + eval 场景，锁住"图内真实路径能触发摘要"。

**面试一句话收束：**  
「上下文压缩必须基于**裁剪前的完整历史**触发；把『裁剪』放在『摘要判断』之前，会让压缩机制在真实调用路径里静默失效——这种 bug 要靠端到端路径的回归测试才能拦住。」

### 12. 对话事实自动沉淀 + 消息级重要性裁剪 + 助手 Markdown 渲染（上下文工程收尾）

- **对话关键事实自动 episode 沉淀**（`episodeDistiller.ts` + `episodeConfig.ts`）：每轮回复完成后主进程**非阻塞**（串行队列 + AbortController）调 `DeepSeekProvider.completeText` 从"尚未沉淀"的对话片段抽取关键事实，结构化 `{"episodes":[...]}` 容错解析（仿关系演化 `parseCandidates`），写入 `type=episode` 记忆（带 `sourceSessionId`/`sourceMessageIds` 溯源）；**触发闸门** = 关键事实意图命中（`hasKeyFactIntent`）或累计未沉淀消息达阈值 + 间隔限频，普通闲聊零 LLM 调用；与既有 fact/episode 按 `scoreMemoryItem` 相似度去重；`assertSafeMemoryContent` 拒敏感；`data/config/episode-config.json` 可开关。抽取失败只日志、绝不影响聊天。
- **消息级重要性**（`messageImportance.ts`）：`ChatMessage` 增写入期启发式 `importance`（1–3，关键事实/提问/长消息/数字加权，助手带成功工具调用加分，默认 2；旧 `chat-data.json` 加载补齐）；纯函数可单测。
- **重要性加权裁剪**：`trimContext`/`trimToBudget` 统一为 `trimContextWeighted`——**近期窗口逐字保留 + 窗口外按 importance 高→低补齐、输出保序、恒保最新一条**；`context-config.json` 增 `importanceTrim`（默认 true）与 `recentWindowChars`（默认 0.7·budget）。重要早期事实不再被闲聊顶掉。
- **助手回复 Markdown 安全渲染**（`src/chat/MarkdownView.tsx` + `chat.css`）：`react-markdown` + `remark-gfm` 渲染助手消息（标题/列表/代码块/表格/引用/链接，`<a target=_blank rel=noreferrer>`），用户消息保持纯文本；**流式期逐字纯文本、完成态一次渲染**（`message.status` 已给信号）；raw HTML 由渲染器**默认转义**为纯文本，不产生可执行 DOM 节点（符合 CSP `script-src 'self'`）；渲染异常回退纯文本。CSS：`pre-wrap` 限定到纯文本路径，新增 `.markdown-body` 全套排版。
- **测试**：`messageImportance.test.ts`（打分 + 加权裁剪）+ `episodeDistiller.test.ts`（触发/闲聊/禁用/非法 JSON/去重/敏感）+ `MarkdownView.test.tsx`（渲染/转义/表格/链接）+ 4 条 eval 场景；离线 eval 累计 **37/37**，`npm test` 201 通过。

**面试可答：**
- 为什么 episode 不靠模型显式 `remember_fact`？模型一旦漏写事实就永久丢失；后台抽取 + 触发闸门让"关键事实不漏、平凡闲聊不烧 token"。
- 为什么重要性用启发式而非 LLM 打分？每轮 LLM 打分太贵；写入期启发式 + 后台 episode 抽取分工——裁剪用便宜信号，语义沉淀用长周期 LLM。
- 为什么流式期不渲染 Markdown？每 token 全量 parse + 滚动抖动收益低；完成态一次渲染，`message.status` 已提供信号。
- 为什么 raw HTML 转义而非 sanitizer？react-markdown 默认把 HTML 转成纯文本，从根上避免 LLM 输出进 DOM；比维护 DOMPurify allowlist 更省。

## 3 分钟面试陈述稿（可背）

我做的是一个 Windows 桌面智能体，不是单纯聊天框。架构上 Electron 主进程跑 DeepSeek 流式调用和 LangGraph 图：先召回人设与长期记忆，再规划工具，经白名单执行后生成回复。  
工程上我强调三点：第一，工具可注册、可开关，记忆和本地提醒都走同一套边界，并有调用链日志和耗时；第二，用户画像跨角色共享，角色口吻跟人设走、会话按模型隔离，避免串戏；第三，记忆与知识库都走 Hybrid 检索（BM25 + 本地 BGE 向量 + RRF 融合），RAG 带引用溯源，再用离线评测盯工具正确率和检索命中率。  
在此基础上我还做了独立小说工坊：把长篇现实向需要的叙事状态（角色、知情差、伏笔账本）外置到 StoryStore，写章走 assemble → draft → StateDiff → Guard → 人审 Accept，Accept 才晋升 Canon，数据和聊天记忆严格隔离——这是把同一套 Agent/检索能力复用到更复杂、更长周期的创作场景。还给桌宠本体加了**活的关系状态**：好感温度随对话实时增减、三种策略化注入、固有设定的慢速演化经人审才生效——让角色会成长，而人设文件始终是用户手写、系统永不改写的 canon。  
上下文工程上，我在滚动摘要与历史检索之外又收了两环：对话关键事实**自动 episode 沉淀**到长期记忆（非阻塞抽取、触发闸门、去重），以及**消息级重要性加权裁剪**——超预算时窗口外高重要性消息优先保留，不让重要早期事实被闲聊顶掉；聊天界面则让助手回复以安全的 Markdown 呈现（仅助手消息、流式期纯文本、raw HTML 转义），用户消息保持纯文本。

## 面试速答（项目级）

**Q：这个项目你负责什么？**  
A：端到端：桌宠壳、独立聊天窗、主进程 LLM/Agent、分层记忆与工具边界；秋招冲刺聚焦工具平台化、可观测、记忆检索、本地 RAG 与评测安全；并扩展独立小说工坊（长篇叙事状态机 + Accept 闸门 + 书内 Hybrid 检索）。

**Q：最大技术难点？**  
A：多人格下「角色人设 vs 用户记忆」拆分，以及把工具从写死调用升级成可观测、可扩展且默认安全的编排层；再往下是检索预算与引用约束，避免上下文爆炸和假引用。另有两类典型坑：同句多意图时规划只出检索、生成却口头「已记住」（见 §3）；长篇写作里 LLM StateDiff 格式抖动 + 自动抽取污染 Canon——要靠 Accept 闸门、Diff 规范化与 Continuity Guard 把状态机守住（见 §8）。

**Q：和调 LangChain 模板项目有什么不同？**  
A：落在真实桌面进程模型（IPC、凭据、多窗、本地调度与通知），有明确白名单与持久化边界，并按秋招标准补齐观测、检索、RAG 与 eval，形成可讲清的工程闭环。

**Q：下一步还做什么？**  
A：Agent 主线、小说工坊一期、活的关系状态、分层上下文工程、对话关键事实自动 episode 沉淀、消息级重要性加权裁剪与助手 Markdown 渲染均已交付（工具平台、Hybrid 检索、confirm 闸门、Accept 闸门、全书导出、好感/演化人审、滚动会话摘要、`search_history` 包级历史检索、episode 自动沉淀、importance 加权裁剪、Markdown 渲染）。长对话上下文遗忘已修复（见 §11）。后续可选：sqlite-vec 替换 JSON 向量库、小说章摘要分层（章→卷）、消息级重要性让 LLM 语义打分、对话级向量索引；TTS 因显存限制继续搁置。

## 已知问题与待办（持续更新）

### 长对话上下文遗忘（2026-08-02 诊断 → 已修复）

**现象：** 对话较长时模型回复会"忘记上文"，早前轮次的内容无任何痕迹。

**根因（`electron/chat/` 上下文组装管线）：**
1. `normalize` 节点把全量会话裁到 **24k 字符**（`agentRuntime.ts:trimContext`），最老的整条轮次被直接丢弃——模型根本没收到，且无压缩兜底。
2. **会话摘要触发条件实际永不成立（关键 bug）**：`ensureSessionSummary` 的 `total > budget` 判断发生在 `normalize` 裁剪之后（`recall` 传入的是已裁到 ≤24k 的消息，总量恒 ≤ 24k），摘要几乎从不生成——长对话既不保留原文、也不生成摘要，超预算部分"凭空消失"。
3. 对话轮次不会自动进长期记忆；`recall` 只检索模型显式写入的 `remember_fact`/`update_profile` 条目。
4. 记忆块（18%）与摘要块（12%）挤占同一预算（`memoryService.ts`），可见对话窗口进一步被压到 ~1.6 万字符。

**修复（`context-management-strategy`，2026-08-02 落地）：**
- ✅ 图状态增 `allMessages`，会话摘要改为基于**裁剪前完整历史**的滚动摘要（`coveredUntilMessageId` 增量推进），替代静默丢弃
- ✅ 上下文预算 24k→40k，`data/config/context-config.json` 可配置
- ✅ 新增 `search_history` 工具（BM25-only、包级全量、带出处、窄触发、硬约束），作为压缩摘要的逐字兜底
- ✅ 上下文占用水位可观测（IPC + 聊天窗指示）
- ✅ RAG 检索开关：知识库面板一键关闭对话内知识库检索，减少无关上下文占用（不影响记忆与历史检索）
- ✅ 回归单测 + 5 条 eval 场景，离线 eval **33/33**
- ✅（已另行立项落地，见 §12）对话关键事实自动 episode 沉淀到长期记忆、消息级重要性加权裁剪

## 维护记录

- 2026-07-20：完成独立聊天窗 + DeepSeek + LangGraph 基础，归档 `improve-pet-chat-agent`
- 2026-07-22：调研 CosyVoice3 本地 TTS；因 4060 8GB 显存紧张搁置
- 2026-07-23：完成记忆管理（跨会话共享 + 工具写入 + 可编辑 + 会话摘要）；对话自动 `planToolCalls`
- 2026-07-23：完成 `per-model-persona-sessions`：包级人设热更新、会话绑定模型、默认 Live2D 兜底、废弃全局 preference
- 2026-07-24：完成本地提醒 + 桌宠气泡，归档 `local-reminders-speech-bubble`
- 2026-07-27：开启并完成实现 `agent-platform-resume-track`（工具平台/观测/记忆检索/本地 RAG/离线评测）；重写本文对齐简历叙事；TTS 仍搁置
- 2026-07-27：补充 Hybrid 检索（稀疏+稠密双路召回、RRF、Rerank）面试说明至 §6
- 2026-07-28：`harden-agent-retrieval-ux`：confirm 闸门、规划可观测、向量批写、多轮工具、真 IR 开关、打包与聊天 UX
- 2026-07-28：P0 加固「查库+记住」多意图编排：规划并行提示、再规划 MUST 写记忆、生成侧禁止口头已记住；人设/输出规范与 fact 写入边界写清；更新 §3 面试难题场景
- 2026-07-29：完成 `novel-writing-studio` 一期（独立窗口、StoryStore、写章流水线、Accept 闸门、书内 Hybrid 索引、Continuity Guard、隔离单测）
- 2026-07-31：小说工坊增强：AI 整份/单章大纲修订、Accept StateDiff 规范化修复、全书预览与 Markdown/HTML/PDF 导出；更新 §8 与简历第 4 条
- 2026-08-01：完成 `living-pet-relationship`（活的关系状态）：好感温度 0–100 + 五段阶段、`update_relationship` 工具与意图路由、policy 三模式注入、慢速人审演化、关系面板；与记忆/小说零耦合，36 单测 + 4 eval
- 2026-08-02：归档 `harden-agent-retrieval-ux` / `novel-writing-studio` / `living-pet-relationship` 并同步主规格（新增 10 个 capability，specs 28 通过）；诊断出长对话上下文遗忘问题（会话摘要触发失效 + 24k 字符硬裁）
- 2026-08-02：完成 `context-management-strategy`（分层上下文工程）：会话摘要改为基于裁剪前完整历史的滚动摘要、预算 24k→40k 可配置、`search_history` 包级 BM25 历史检索、上下文占用水位可观测、RAG 检索开关；长对话上下文遗忘修复，eval 33/33；更新 §11 与简历第 6 条
- 2026-08-03：完成 `episode-memory-importance-trimming`（上下文工程收尾）：对话关键事实自动 episode 沉淀（非阻塞抽取 + 触发闸门 + 间隔限频 + 去重 + 配置开关）、`ChatMessage` 消息级重要性启发式打分、`trimContextWeighted` 重要性加权裁剪（近期窗口逐字 + 窗口外按 importance 补齐）；eval 33→37，`npm test` 201 通过；新增 §12 与简历第 7、8 条
- 2026-08-03：完成 `assistant-markdown-rendering`：助手消息 react-markdown + remark-gfm 安全渲染（仅助手、流式期纯文本、raw HTML 转义），用户消息保持纯文本；CSS 限定 pre-wrap 并新增 `.markdown-body` 排版；新增 §12 与简历第 9 条
- 2026-08-03：完成 `chat-ui-warm-theme`（聊天窗暖色陪伴风）：CSS 变量对齐桌宠（`--ink/--panel/--accent` 等）、会话区暖米白 + 侧栏暖深 + 头部/输入区磨砂、助手消息显示当前 Live2D 包头像（modelUrl + 首字符回退）、流式闪烁光标、气泡入场动画、工具时间线胶囊 + 状态点、引用块卡片、会话列表按日期分组、消息区窄栏居中
- 2026-08-03：完成 `tavily-web-search-fetch`（联网搜索 + 网页抓取）：`web_search`（safe，Tavily /search，结构化命中 + AI 摘要）+ `web_fetch`（confirm，Tavily /extract 抓正文，URL 校验拒绝 localhost/私有 IP 防 SSRF）；Tavily Key 走 env `TAVILY_API_KEY` 或 `data/config/tavily-config.json`，仅主进程持有；`formatToolResultsForModel` 硬约束（逐字引用、空结果禁编造）；eval 37→40，`npm test` 214 通过
- 2026-08-05：完成 `daily-first-meeting-state`（每日首次见面状态）：按包持久化"当日是否已首见"（`data/memory/daily-meet.json`），首次对话注入"今天第一次见面按人设完成首见行为"、同日后续注入"已见过除非被问否则不重复"；顺带在系统提示注入当前本地日期，修复模型编造日期的问题