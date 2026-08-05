## ADDED Requirements

### Requirement: 联网搜索工具 web_search
Agent 运行时 SHALL 注册白名单工具 `web_search`（riskLevel=`safe`、默认 enabled、可经 `tool-config.json` 关闭），调用 Tavily `/search` 返回结构化搜索结果。工具输入 SHALL 包含 query、可选 max_results（1–8，默认 5）与 search_depth（basic/advanced）。输出 SHALL 包含命中结果（title/url/content/score/published_date）与可选 AI answer；无命中 MUST 如实返回空并禁止编造。Tavily API Key SHALL 来自环境变量 `TAVILY_API_KEY` 或配置文件，MUST NOT round-trip 到渲染进程。

#### Scenario: 搜索实时信息
- **WHEN** 用户询问实时/外部/最新信息且模型调用 web_search
- **THEN** 工具调用 Tavily /search 并返回结构化命中结果与可选 AI 摘要

#### Scenario: 无命中不编造
- **WHEN** 搜索返回空结果
- **THEN** 工具返回 empty=true，回复 MUST 如实说明未搜到，禁止虚构结果

#### Scenario: 未配置 Key 不启用
- **WHEN** Tavily API Key 缺失
- **THEN** web_search 不进入规划集合，不可被调用

### Requirement: 网页抓取工具 web_fetch
Agent 运行时 SHALL 注册白名单工具 `web_fetch`（riskLevel=`confirm`、默认 enabled），调用 Tavily `/extract` 抓取单个 URL 正文为 Markdown。URL SHALL 仅允许 http/https，MUST 拒绝私有 IP 段、localhost 与超长 URL（SSRF 防护）。正文 SHALL 按字符预算截断后返回；失败 SHALL 返回可理解错误且不编造。

#### Scenario: 抓取指定网页
- **WHEN** 模型调用 web_fetch 且用户确认，URL 为合法 http/https
- **THEN** 工具调用 Tavily /extract 返回该 URL 的正文内容

#### Scenario: 拒绝危险 URL
- **WHEN** web_fetch 收到 localhost 或私有 IP 地址
- **THEN** 工具拒绝执行并返回 SSRF 防护错误

#### Scenario: 抓取需用户确认
- **WHEN** 模型规划调用 web_fetch
- **THEN** 执行前经 confirm 闸门，用户拒绝则工具不执行

### Requirement: 联网结果硬约束
Agent 生成回复引用联网结果时，MUST 逐字引用工具返回的 hits 内容，MUST NOT 补充或虚构；搜索无命中或抓取失败时 MUST 如实说明，MUST NOT 声称已找到不存在的网页内容。

#### Scenario: 引用逐字来自结果
- **WHEN** 模型基于 web_search 命中生成回复
- **THEN** 回复引用 MUST 逐字取自 hits，不补充来源中没有的细节

#### Scenario: 抓取失败如实说明
- **WHEN** web_fetch 抓取失败
- **THEN** 回复如实说明抓取失败，不编造网页内容

## MODIFIED Requirements

### Requirement: 可扩展工具边界
Agent 运行时 SHALL 提供显式工具注册表和工具调用节点，但首期 MUST 默认不注册文件、Shell、网络浏览或其他具有系统副作用的工具。

#### Scenario: 当前版本运行
- **WHEN** Agent 处理普通聊天请求
- **THEN** 对话图无需系统工具即可完成回复，且不能执行未注册工具

#### Scenario: 联网工具纳入白名单
- **WHEN** 开发者注册 web_search / web_fetch 白名单工具
- **THEN** 联网读取作为只读、可观测、经规划与（抓取）确认的白名单能力加入，仍不注册文件/Shell 副作用工具
