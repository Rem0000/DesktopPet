## 1. Tavily 服务与配置

- [x] 1.1 新增 `electron/chat/tavilyService.ts`：`TavilyService(apiKey, baseUrl, fetchImpl)`；`search({query,maxResults,searchDepth,includeAnswer,signal})` → `/search`，`extract({url,signal})` → `/extract`（format:markdown）；容错解析（title/url/content 缺失丢弃该条）；超时/错误归类返回 `ok:false`
- [x] 1.2 新增 `electron/chat/tavilyConfig.ts`：`loadTavilyConfig(configDir)`——env `TAVILY_API_KEY` 优先，否则读 `data/config/tavily-config.json`（`{ version:1, apiKey }`）；无 key 返回 null
- [x] 1.3 新增 URL 校验 `isSafeHttpUrl(url)`（`electron/chat/urlSafety.ts`）：仅 http/https、host 非空、长度 ≤2048、拒绝 localhost/私有 IP 段；导出可单测
- [x] 1.4 `src/chat/contracts.ts` 增 `WebSearchHit`/`WebSearchOutput`/`WebFetchOutput`/`TavilyConfigFile` 类型

## 2. 工具注册

- [x] 2.1 新增 `electron/chat/tavilyTools.ts`：`registerTavilyTools(service, tools)` 注册 `web_search`（safe，参数 query/maxResults/searchDepth）+ `web_fetch`（confirm，参数 url）；validate 走 require 校验
- [x] 2.2 `chatController.ts`：`loadTavilyConfig` → 有 key 则实例化 service + 注册工具；无 key 不注册（`listForPlanning` 自动排除）
- [x] 2.3 `tool-config.json` 可关 web_search/web_fetch（走既有 applyOverrides）

## 3. 硬约束与规划提示

- [x] 3.1 `agentRuntime.ts` `formatToolResultsForModel`：对 web_search 注入「逐字引用 hits、empty 禁编造」；对 web_fetch 注入「基于抓取结果摘要、失败如实说明」
- [x] 3.2 `deepSeekProvider.ts` `PLAN_TOOL_INSTRUCTION`：加 web_search（实时/外部信息时调用）+ web_fetch（需特定网页正文、通常先搜后抓）窄触发指引

## 4. 测试与 eval

- [x] 4.1 单测 `tavilyService.test.ts`：mock fetchImpl——search 命中/空/字段缺失容错/extract 成功/失败/URL 校验（localhost、私有 IP、非 http 拒绝）
- [x] 4.2 `evals/scenarios.json` + `run.eval.test.ts`：`web-search-registered`、`web-search-no-key-disabled`、`web-fetch-confirm-level`、`web-fetch-ssrf-reject`
- [x] 4.3 `npm test` 全量通过（214）；`npm run typecheck` 通过

## 5. 文档与验收

- [ ] 5.1 `highlight_resume_pet.md` 维护记录追加；README 数据目录表补 `data/config/tavily-config.json`（若采用文件配置）
- [ ] 5.2 手动冒烟：配置 TAVILY_API_KEY 后 `npm run dev`，对话触发 web_search/web_fetch，聊天窗时间线展示工具调用；`tool-config.json` 关闭后不规划
