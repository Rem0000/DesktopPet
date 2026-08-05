## Why

桌宠 Agent 目前只能检索本地知识库/记忆，无法回答实时或外部信息问题。用户已有 Tavily API Key，可直接为 Agent 增加**联网搜索**与**网页抓取**两个白名单工具，把 Agent 能力从「本地检索」扩展到「实时联网」，补齐面试叙事里「Agent 工具边界」的关键一环（此前明确不开放浏览器/Shell 副作用工具；联网读取是受控、只读、可观测的白名单扩展）。

## What Changes

- **`web_search` 工具（safe）**：调用 Tavily `/search`，支持 `query`、`max_results`（1–8，默认 5）、`search_depth`（basic/advanced）；返回结构化结果（title/url/content/score/published_date）+ 可选 `answer`（AI 摘要）。走 `formatToolResultsForModel` 硬约束：有命中 MUST 逐字引用结果、空结果 MUST 如实说明并禁止编造。
- **`web_fetch` 工具（confirm）**：调用 Tavily `/extract`，抓取单个 URL 正文为 Markdown；`riskLevel=confirm`（外网读取有 SSRF 面），URL 校验 http/https、可选域名白名单；正文按字符预算截断后返回。
- **Tavily Key 配置**：复用 `ChatStore` 的 safeStorage 加密存储（与 DeepSeek key 同级），渲染进程只拿脱敏状态；可通过 `data/config/tool-config.json` 开关两个工具（默认 enabled）。**不做**设置 UI（key 由配置注入），key 来源：环境变量 `TAVILY_API_KEY` 或配置文件 `data/config/tavily-config.json`。
- **规划提示**：`PLAN_TOOL_INSTRUCTION` 增加 web_search/web_fetch 的触发指引（实时/外部信息、可核实的当前事实才搜；禁止编造搜索结果）。
- **工具调用链可观测**：两个工具走既有 `ToolBoundaryEvent` JSONL trace（耗时/成功/脱敏入参），聊天时间线自动展示。

## Capabilities

### New Capabilities

- `web-search-tool`: 联网搜索工具 `web_search`——Tavily `/search` 调用、结构化结果、硬约束、可配置开关
- `web-fetch-tool`: 网页抓取工具 `web_fetch`——Tavily `/extract` 调用、URL 校验与白名单、confirm 风险级、正文截断

### Modified Capabilities

- `pet-agent-runtime`: 工具规划提示新增联网检索指引；工具白名单新增 web_search/web_fetch（仍无文件/Shell 副作用）
- `agent-memory` / `local-rag`: 无（联网结果不写入记忆/知识库，仅作为工具结果注入当轮上下文）

## Impact

- **主进程**：`electron/chat/chatController.ts`（实例化 TavilyService + 注册工具 + 读配置）、新增 `electron/chat/tavilyService.ts`（/search + /extract 封装、URL 校验、硬约束输出）、`electron/chat/chatStore.ts`（Tavily key 存取）、`electron/chat/deepSeekProvider.ts`（规划提示扩展）
- **共享契约**：`src/chat/contracts.ts`（`WebSearchResult`/`WebFetchResult` 类型、Tavily 配置类型）
- **数据**：`data/config/tavily-config.json`（gitignored，存 key 或指向环境变量）；`tool-config.json` 可关工具
- **前端**：聊天窗工具时间线已能展示新工具（无需改）；无设置 UI 改动
- **测试/eval**：`tavilyService.test.ts`（mock fetch：搜索命中/空、抓取成功/失败/URL 校验/白名单）、`run.eval.test.ts` 新增场景（工具注册、硬约束、confirm 级）
- **安全**：`web_fetch` 仅 http/https、默认无白名单（全部 http/https 可抓）但 URL 长度/端口校验；`web_search` 仅只读查询
