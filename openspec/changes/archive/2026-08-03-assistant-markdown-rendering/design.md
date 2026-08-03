## Context

聊天窗渲染：`src/chat/ChatApp.tsx:689` 的 `<div>{message.content || placeholder}</div>` 同时渲染 user/assistant 两种角色，`.message-bubble`（`chat.css:335-343`）统一 `white-space: pre-wrap; overflow-wrap: anywhere`。流式：主进程每个 token 发一条 `chat:stream chunk`，renderer 每 chunk 一次 `setState` 重渲染（`ChatApp.tsx:287-295`），无节流。

项目约束：CSP `script-src 'self'`（`chat.html`），禁用 inline script/eval；LLM 输出是**不可信输入**，当前以纯文本安全渲染。无任何现成 Markdown 依赖（novel/manager 只用「markdown」表导出/编辑，从不渲染显示）。React 19 + Vite 7。

## Goals / Non-Goals

**Goals:**
- 助手消息渲染为安全 Markdown（标题/列表/引用/行内代码/围栏代码块/表格/链接/粗斜体）
- 用户消息保持纯文本；流式期间助手消息保持逐字纯文本，完成后才渲染 Markdown
- 无 raw-HTML 透传（XSS 边界）；代码块可读（可选高亮）；样式与气泡融合
- 不新增 IPC / 不改主进程 / 不破坏既有工具时间线、引用块、错误/已取消状态

**Non-Goals:**
- 渲染用户消息（保持纯文本）
- raw HTML 透传 / `dangerouslySetInnerHTML`（哪怕配 sanitizer 也不做，react-markdown 默认转义已够）
- 全功能代码高亮语言集（若引入，限定常用语言子集，避免包体与样式膨胀）
- 流式中的增量 Markdown 渲染（每 token 全量 parse 代价高，改为完成态渲染）
- 主进程/契约改动（`ChatMessage` 无需新字段）

## Decisions

### D1. 用 `react-markdown`（默认转义、零 raw-HTML），不引入 sanitizer
- **选择**：新增 `react-markdown`，renderer 侧经 Vite 打包。`react-markdown` 默认把未识别 HTML 渲染为纯文本（escape），不调用 `dangerouslySetInnerHTML`，符合现有 CSP `script-src 'self'`。不引入 `rehype-raw`、不做 sanitizer——**从根上避免 LLM 输出 HTML 进 DOM**。
- **理由**：无依赖冲突风险；默认安全行为对齐项目「LLM 输出不可信」的既有假设；避免 sanitizer 方案里「漏配 allowlist / 版本漂移」的风险。
- **备选**：`marked` + `DOMPurify` → 否决（sanitizer 是允许列表的工程负债，react-markdown 默认转义更简单）；`markdown-it` + 白名单 → 否决（等价但更繁琐）；自研迷你渲染器 → 否决（复用成本低，标准实现更稳）。

### D2. 仅 assistant 角色渲染；流式状态回退纯文本
- **选择**：渲染分支 `message.role === 'assistant' && message.status !== 'streaming'` → `<MarkdownView>`；其余（user、assistant 且 streaming/cancelled/error 且 content 空）走现有 `<div>{content || placeholder}</div>`。`assistant` 且 `status==='complete'` 渲染 Markdown；`cancelled`/`error` 但有部分 content 也渲染 Markdown（内容已定格）。
- **理由**：`message.status` 已是契约字段（`contracts.ts:3`），无需新协议；流式期逐字追加纯文本保证低延迟与无抖动，完成态一次 parse 成本可接受。
- **备选**：流式期也渲染（带防抖）→ 否决（每 token 重 parse 整段 + 滚动抖动，收益低）。

### D3. `MarkdownView` 组件化 + 可选代码高亮
- **选择**：新组件 `src/chat/MarkdownView.tsx` 封装 `ReactMarkdown`。代码块：先引入 `rehype-highlight` + `highlight.js`（`languages: { js, ts, json, python, bash, cpp, java, go, rust, sql, html, css }`，`ignoreMissing`）可选；若评估后包体/复杂度不合算则先只做无高亮的 `<pre><code>`（默认实现已带）并在任务里保留「代码高亮」为可勾选子项。
- **理由**：代码块是桌面 Agent 回复高频内容，高亮显著提升可读性；限定语言子集控制 bundle。无高亮时 react-markdown 已默认渲染 `<pre><code>`。
- **备选**：不引入高亮 → 可接受回退（本轮核心是 Markdown 结构渲染）。

### D4. CSS 收敛：`pre-wrap` 限定到非 Markdown 路径
- **选择**：`.message-bubble` 去掉全局 `white-space: pre-wrap`（或改为只在 user 气泡/纯文本回退上保留），Markdown 容器 `.markdown-body` 由自身块级排版接管；补齐标题、列表、引用、行内代码、围栏代码块、表格、链接样式，`pre` 允许横向滚动（`overflow-x:auto`）且不撑破气泡。工具时间线/引用块/错误态样式不动。
- **理由**：`pre-wrap` 与块级 Markdown 冲突（换行/空白语义打架）；限定作用域避免回归。
- **备选**：保留 `pre-wrap` 只改 Markdown 子元素 → 否决（选择器更绕，仍残留冲突）。

### D5. 零主进程改动 + 组件测试
- **选择**：不改 `ChatMessage`/IPC/主进程。测试：给 `MarkdownView` 加组件级单测（Vitest + 现有 jsdom 配置若可用；否则用渲染字符串断言）：标题/列表/代码块/行内代码渲染正确、raw HTML 被转义为文本、空内容回退。
- **理由**：渲染是纯前端关注点，最小化风险面；组件测试锁定「不安全输入不产生 DOM」的关键性质。
- **备选**：e2e/手动截图验证 → 作为冒烟项，不作为 CI 门槛。

## Risks / Trade-offs

- **[Risk] react-markdown 及依赖引入 renderer bundle** → Mitigation：纯 renderer 依赖、Vite 正常打包；不碰主进程 external/asarUnpack；若代码高亮使 bundle 过大则降级为无高亮 `<pre><code>`。
- **[Risk] LLM 输出的 Markdown 畸形（未闭合围栏/嵌套列表）** → Mitigation：react-markdown 容错解析（不抛错）；组件捕获渲染异常回退纯文本。
- **[Risk] 样式回归影响既有气泡/工具时间线** → Mitigation：`pre-wrap` 修改限定作用域；组件测试 + 手动冒烟聊天主路径。
- **[Trade-off] 流式期不渲染 Markdown** → 接受：完成态一次渲染，避免逐 token parse 抖动；用户看到先纯文本后排版，过渡可接受。
- **[Risk] 表格/长链接撑破气泡** → Mitigation：表格容器 `overflow-x:auto`，链接 `overflow-wrap:anywhere`。

## Migration Plan

1. 纯新增：新组件 + 样式追加 + 渲染分支替换，不改主进程与数据；既有历史消息加载后按角色自动获得 Markdown 渲染。
2. 回滚：恢复 `ChatApp.tsx:689` 原 `<div>` 与 `chat.css` 原 `pre-wrap`，移除依赖与组件即可；不影响任何持久化数据。
3. 无配置迁移；无需 `data/config` 改动。

## Open Questions

- 代码高亮是否引入（依赖 `rehype-highlight` + `highlight.js`）——先按「引入 + 限语言子集」计划，实现后看 bundle 与样式收益，若不合适降级为无高亮（任务里保留可勾选子项）。
- 表格样式细节（是否 zebra、边框颜色）——实现时按现有浅色气泡风格定。
