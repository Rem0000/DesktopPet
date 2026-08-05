## Context

桌宠 Agent 运行时（`electron/chat/`）：LangGraph 图 `normalize → recall → plan → toolBoundary → maybeReplan → model → commit`。工具经 `ToolRegistry` 白名单注册（`search_knowledge`/`remember_fact`/`schedule_reminder`/`update_relationship`/`search_history` 等），`planToolCalls` 由模型从 `listForPlanning()` 选，`toolBoundary` 执行并触发 `ToolBoundaryEvent` JSONL trace。`formatToolResultsForModel` 把工具结果转成模型 MUST 遵守的中文硬约束（禁编造、逐字引用）。

DeepSeek API Key 存于 `ChatStore`（safeStorage 加密，`StoredProviderConfig`），渲染进程只见脱敏状态。`data/config/tool-config.json` 可开关任意工具。Tavily 提供 `POST api.tavily.com/search` 与 `/extract` 两个 JSON 端点，一次 key 覆盖搜索+抓取，无额外库。

约束：联网能力必须是「受控、只读、可观测」的白名单扩展，延续「默认无文件/Shell/浏览器副作用」原则；Tavily key 不与 DeepSeek key 混存、不 round-trip 到渲染进程。

## Goals / Non-Goals

**Goals:**
- `web_search`（safe）+ `web_fetch`（confirm）两个白名单工具，走现有 ToolRegistry/规划/硬约束/观测链路
- Tavily key 安全存储（safeStorage），环境变量或配置文件注入，无设置 UI
- 工具结果硬约束（禁编造、逐字引用）、URL 校验、正文预算截断
- 单测 + eval 场景，离线 eval 保持全绿

**Non-Goals:**
- 设置面板 UI（key 由 env/配置文件注入）
- 多 URL 批量抓取（本期单 URL，`/extract` 支持数组但工具收 1 个）
- 把搜索结果写入记忆/知识库（仅当轮工具结果注入）
- 浏览器自动化 / JS 渲染页面兜底（Tavily extract 已内置清洗，够用）
- 缓存层（本期直连，频率有限）

## Decisions

### D1. TavilyService 封装两个端点，注入 fetch（可 mock）
- **选择**：新增 `electron/chat/tavilyService.ts`，类 `TavilyService`：构造收 `{ apiKey, baseUrl='https://api.tavily.com', fetchImpl=fetch }`；`search({query,maxResults,searchDepth,includeAnswer,signal})` 调 `/search`，`extract({url,signal})` 调 `/extract`。fetchImpl 可注入便于单测（项目其他网络代码无此先例，但这是测试 Tavily 的最简方式）。
- **理由**：单测不依赖真实网络；`/extract` 的 `format:'markdown'` 直接给正文。
- **备选**：用 `node:fetch` 直接裸调 → 单测要 mock 全局 fetch，不如注入干净。

### D2. key 来源：环境变量 `TAVILY_API_KEY` 优先，其次 `data/config/tavily-config.json`
- **选择**：`loadTavilyConfig(configDir)` 读取：`process.env.TAVILY_API_KEY` 若存在则用；否则读 `data/config/tavily-config.json`（`{ version:1, apiKey }`）。读取后仅主进程持有，不暴露给渲染进程；`tools:list` 元数据不包含 key。
- **理由**：用户选定「环境变量/配置文件」；env 便于 CI/演示，文件便于持久。
- **备选**：safeStorage 存 UI 输入 → 用户否了 UI，不做。

### D3. `web_search` safe / `web_fetch` confirm
- **选择**：搜索只读、无 SSRF，`safe`；抓取任意 URL 有 SSRF 面，`confirm`（走既有 `chat:tool-confirm` 60s 闸门）。两个工具默认 enabled，`tool-config.json` 可关。
- **理由**：延续「confirm 级工具需用户确认」的既有安全分层（`forget_memory` 同层）。
- **备选**：都 safe → 否决（抓取不该无确认读任意 URL）。

### D4. URL 校验
- **选择**：`validateUrl` 只允许 `http:`/`https:`；host 必须非空；长度 ≤ 2048；拒绝私有 IP 段（127.x/10.x/192.168.x/172.16-31.x/169.254.x）与 `localhost`（SSRF 常见目标），保留可配置白名单出口。`web_search` 的 `include_domains` 不开放给模型（避免被诱导只搜特定域）。
- **理由**：SSRF 面最小化；白名单为后续扩展留位。
- **备选**：不做 IP 段拦截 → 否决（桌宠抓 localhost 是无意义且危险）。

### D5. 硬约束与输出形状
- **选择**：`web_search` 输出 `{ ok, hits: [{ title, url, content(≤280), score?, publishedDate? }], answer?, empty }`；`web_fetch` 输出 `{ ok, url, content(≤4000), empty }`。`formatToolResultsForModel` 增加两段中文 MUST 约束：搜索「引用 MUST 逐字来自 hits，不得补充；empty 时如实说明未搜到」；抓取「内容 MUST 基于抓取结果摘要，不得虚构 URL 内没有的信息；失败如实说明」。
- **理由**：与 `search_knowledge`/`search_history` 硬约束同构，防「口头说搜到但没搜」。

### D6. 规划提示窄触发
- **选择**：`PLAN_TOOL_INSTRUCTION` 加两条：① 用户询问实时/外部/最新信息且本地知识库无对应内容时调用 `web_search`；② 需要特定网页正文时才 `web_fetch`（通常先搜索拿到 URL）。普通闲聊不调用。
- **理由**：联网有成本与延迟，窄触发避免每轮误调；与 `search_knowledge` 窄触发策略一致。

### D7. 观测与隔离
- `web_search`/`web_fetch` 走既有 `ToolBoundaryEvent`（入参经 `summarizeToolInput` 脱敏，query/url 摘要记录）；结果只当轮注入，**不写**记忆/知识库/关系/小说；无新 IPC。

## Risks / Trade-offs

- **[Risk] Tavily 限流/失败** → Mitigation：`/search` 非流式单次；超时与错误归类（沿用 `normalizeProviderError` 思路），失败返回 `ok:false` 让模型如实说明；`confirm` 抓取失败可重试。
- **[Risk] 搜索结果质量/幻觉** → Mitigation：硬约束「逐字引用 + 禁编造」；`content` 截断 280 字避免超预算。
- **[Risk] SSRF** → Mitigation：confirm 闸门 + http/https 白名单 + 私有 IP/localhost 拦截。
- **[Trade-off] 无缓存** → 接受：频率有限、直连简单；后续可加 LRU。
- **[Risk] Tavily API 字段漂移** → Mitigation：容错解析（`title/url/content` 缺失则该条丢弃），与 `parseCandidates` 同理。

## Migration Plan

1. 纯新增：新工具 + 服务 + 配置读取，默认 enabled；不迁移既有数据。
2. 回滚：移除 `tavilyService` 注册 + 相关 `formatToolResultsForModel`/规划提示条目即可，不影响聊天/记忆/知识库数据。
3. `data/config/tavily-config.json` 缺省时仅靠 env；无 key 时两个工具 `enabled=false`（`listForPlanning` 自动排除）。

## Open Questions

- 是否要 UI 显示「联网开关」（知识库面板同款）——本期不加，`tool-config.json` 可控；如需再补。
- `web_fetch` 白名单是否默认空（全部 http/https）——本期默认空，仅拦截私有/本地；如遇反爬再收紧。
