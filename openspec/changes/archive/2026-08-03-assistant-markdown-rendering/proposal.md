## Why

助手回复目前以纯文本 `<div>{content}</div>` 渲染（`ChatApp.tsx:689`），深色/结构化输出（代码块、列表、标题、表格、行内代码、链接）在气泡内不可读；`pre-wrap` 让长代码块整块挤爆气泡、Markdown 符号原样暴露给用户。项目是端侧 Agent 产品，回复来自 LLM，天然是 Markdown；不渲染则信息呈现质量差。本轮为**助手消息**引入安全、轻量、对流式友好的 Markdown 渲染，用户消息保持纯文本。

## What Changes

- **新增 Markdown 渲染组件**：`src/chat/MarkdownView.tsx`，用 `react-markdown`（零 raw-HTML，默认转义，天然符合聊天窗 CSP `script-src 'self'`）渲染 `## 标题 / 列表 / 有序列表 / 引用 / 行内代码 / 围栏代码块 / 表格 / 链接 / 粗斜体` 等；**不**引入 `rehype-raw`，避免 LLM 输出中的 HTML 进入 DOM（XSS 边界）；代码块用 `rehype-highlight` + highlight.js 高亮（可选，若引入则限制语言子集）。
- **仅助手消息渲染**：`message.role === 'assistant'` 走 Markdown；`user` 消息保持现有纯文本（`white-space: pre-wrap`）。错误/已取消状态消息按现有逻辑展示状态文案。
- **流式期间不渲染 Markdown**：`message.status === 'streaming'` 时保持当前纯文本逐字追加（避免每 token 全量 parse），`complete`/`cancelled`/`error` 后才渲染 Markdown。`message.status` 已提供该信号。
- **CSS 修正**：`.message-bubble` 的 `white-space: pre-wrap` 限定到用户气泡与流式/纯文本回退，Markdown 容器内用自带排版；补齐 `.markdown-body` 的标题/代码块/表格/引用/列表/链接样式与气泡内边距。
- 为渲染层新增 1–2 个组件级单测（`MarkdownView` 快照/输出断言），不新增 IPC、不改主进程。

## Capabilities

### New Capabilities

- `chat-markdown-rendering`: 助手消息 Markdown 渲染——仅 assistant 角色、流式期纯文本回退、无 raw-HTML 的安全渲染、代码高亮与气泡内排版样式

### Modified Capabilities

- `pet-chat-window`: 即时通信式消息交互——助手消息以 Markdown 呈现，用户消息保持纯文本；流式期间保持逐字纯文本

## Impact

- **依赖（新增，渲染进程）**：`react-markdown`（+ 依赖 `unified`/`remark`/`micromark` 等，纯 ESM 在 renderer 侧经 Vite 打包，不进主进程/asarUnpack 故事）；代码高亮可选 `rehype-highlight` + `highlight.js`（或暂缓）
- **前端**：`src/chat/MarkdownView.tsx`（新）、`src/chat/ChatApp.tsx`（消息渲染分支 + 流式回退）、`src/chat/chat.css`（`.markdown-body` 样式 + `pre-wrap` 限定）
- **CSP**：`chat.html` 现有 `script-src 'self'` 不变；不引入 `rehype-raw`/`dangerouslySetInnerHTML`
- **测试**：`MarkdownView` 组件测试；`npm test` 全量通过、`npm run typecheck` 通过
- **主进程/契约**：零改动（`ChatMessage` 无需新字段，`message.status` 已有）
