## Context

DesktopPet 是 Electron 主进程驱动的桌面智能体：LangGraph 图编排（normalize → recall → plan → toolBoundary → model → commit）、ToolRegistry 白名单工具（记忆 + 提醒）、JSON 持久化记忆/会话。秋招目标岗位为大模型应用/智能体，需要把现有能力升级为可扩展、可观测、可检索、可评测的平台化叙事，同时保持本地桌面边界（无独立后端、默认无 Shell/文件副作用工具）。

约束：
- TTS/本地音色继续搁置（显存限制），不在本 change 范围。
- 一期 RAG 以 md/txt + 本地全文/关键词检索为主，不强制上向量库。
- 安全边界延续现状：API Key 主进程、工具白名单、敏感记忆拒绝写入。

## Goals / Non-Goals

**Goals:**
- 工具平台化：统一注册、开关、校验、错误语义；新增工具不改聊天 IPC 主干。
- 可观测性：每次工具调用可落盘/可查询，聊天窗可看时间线。
- 记忆检索升级：可检索 + 生命周期 + top-k 预算注入。
- 本地 RAG：导入文档 → 索引 → 检索增强 → 引用展示。
- 评测与安全：小型离线 eval + 危险工具确认/敏感遮罩。
- 简历文档 `highlight_resume_pet.md` 与路线对齐。

**Non-Goals:**
- 不做多租户云端同步、插件商店、远程 MCP 市场。
- 不做完整向量数据库运维（一期可用内存/文件索引；向量为可选后续）。
- 不做 TTS、语音唤醒、番茄钟（可另开 change；本路线优先智能体工程深度）。
- 不改 Live2D 渲染核心与导入管线（除非聊天观测 UI 需要）。

## Decisions

### D1：工具平台采用「代码模块 + 元数据注册」，而非热加载任意 JS
- **选择**：每个工具仍是主进程 TypeScript 模块，通过统一 `registerTool({ name, schema, enabled, riskLevel, handler })` 注册；可用配置文件覆盖 enabled。
- **替代**：动态 `eval`/加载用户脚本 → 拒绝（安全风险高，桌面端难审计）。
- **理由**：简历可讲「可插拔架构」，同时保持白名单与类型安全。

### D2：可观测性先落本地 JSONL + IPC 事件，不上外部 APM
- **选择**：`userData/agent-traces/*.jsonl` 记录 requestId/sessionId/tool/latency/ok；流式过程中通过 petAPI 推送 `tool_call` 事件给聊天窗。
- **替代**：OpenTelemetry + 远程收集 → 一期过重。
- **理由**：本地可演示、可写「调用链可观测」，实现成本可控。

### D3：记忆检索一期用关键词/BM25 风格打分，预留 `retrieve(query, k)` 接口
- **选择**：在 MemoryStore 增加检索方法；召回节点改为 retrieve + 重要度/衰减/pin 重排。
- **替代**：立刻上 embedding 向量库 → 依赖与数据量不匹配。
- **理由**：与现有「条目量小」现实一致，又能在面试讲清演进路径。

### D4：RAG 独立知识库，不与用户画像记忆混库
- **选择**：`knowledge/` 目录存源文件与 chunk 索引；Agent 通过 `search_knowledge` 工具或 recall 阶段可选注入。
- **替代**：把文档切块写入 memory-data.json → 污染用户记忆语义。
- **理由**：记忆=用户侧结构化知识；RAG=资料侧检索。边界清晰，简历也好讲。

### D5：评测以「场景脚本 + 断言」为主，指标人工/半自动汇总
- **选择**：`evals/` 下 20–50 条 JSON 场景；Vitest 或 Node runner 跑工具正确率、记忆一致性、RAG 命中率。
- **替代**：完整 LLM-as-judge 平台 → 秋招窗口内过重。
- **理由**：有数字可比对前后，面试够用。

### D6：分阶段落地（与秋招周计划对齐）
1. P0 工具平台 + 观测（1–3 周）
2. P1 记忆检索（4–6 周）
3. P2 本地 RAG（7–8 周）
4. P3 评测与安全（9–10 周，可裁剪）

## Risks / Trade-offs

- [工具平台抽象过度] → 先只抽注册/开关/日志，不做插件 DSL。
- [观测日志含隐私] → 入参摘要脱敏（截断、遮罩邮箱/密钥模式）；默认不上传。
- [检索质量不稳定] → 保留 importance/pin 兜底；评测集回归。
- [RAG 幻觉仍存在] → UI 强制展示引用；无命中时明确「未找到资料」。
- [范围膨胀影响秋招] → P3 可砍；P0–P2 为简历硬指标。

## Migration Plan

1. 先落地 ToolRegistry 元数据与观测事件，兼容现有记忆/提醒工具行为。
2. MemoryStore 扩展字段（pinned、lastAccessedAt、decayScore）时保留旧 JSON 可读；缺省字段填默认值。
3. RAG 为空库时行为与现网一致（不注入知识块）。
4. 回滚：关闭配置开关即可禁用新工具/RAG/时间线；存储文件可备份后删除索引重建。

## Open Questions

- RAG 默认走「自动 recall 注入」还是「仅工具按需检索」？（倾向：工具按需 + 可选自动注入开关）
- 评测是否接入 CI？（倾向：本地脚本优先，CI 可选）
- 聊天窗时间线默认展开还是折叠？（倾向：默认折叠，调试/演示模式展开）
