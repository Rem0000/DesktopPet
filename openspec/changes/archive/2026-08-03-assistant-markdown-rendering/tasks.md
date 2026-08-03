## 1. 依赖

- [x] 1.1 安装 `react-markdown`（renderer 依赖；Vite 打包，不进主进程 external/asarUnpack 故事）
- [x] 1.2 评估并安装 `remark-gfm`（表格支持；代码高亮 rehype-highlight 暂缓，本轮以无高亮的 `<pre><code>` 交付）
- [x] 1.3 `package.json` 依赖落盘后跑 `npm install` 与 `npm run typecheck` 确认无类型/构建回归

## 2. MarkdownView 组件

- [x] 2.1 新增 `src/chat/MarkdownView.tsx`：封装 `ReactMarkdown`，`components` 映射 `<a>` 添加 `target="_blank" rel="noreferrer"`、`<pre>/<code>` 支持横向滚动；raw HTML 由 react-markdown 默认转义为纯文本（XSS 边界）
- [x] 2.2 remark-gfm 插件接入（表格等 GFM 语法）
- [x] 2.3 组件捕获渲染异常回退纯文本（`try/catch` + 错误边界）

## 3. ChatApp 渲染分支

- [x] 3.1 `ChatApp.tsx`：`message.role === 'assistant' && message.status !== 'streaming' && message.content` → `<MarkdownView content={message.content} />`；其余路径走纯文本 `<div className="message-plain-text">`
- [x] 3.2 保持既有工具时间线、引用块、错误/已取消状态文案不变
- [x] 3.3 流式期（streaming）逐字追加仍走纯文本 `<div>`，完成态才渲染 Markdown

## 4. 样式与回退

- [x] 4.1 `chat.css`：`.message-bubble` 的 `white-space: pre-wrap` 限定到用户气泡/纯文本回退路径（`.message-plain-text` / `.markdown-plain-fallback` / user 气泡）
- [x] 4.2 新增 `.markdown-body` 样式：标题、列表、引用、行内代码、围栏代码块（`overflow-x:auto`）、表格（容器横向滚动）、链接、粗斜体；适配气泡内边距
- [x] 4.3 无高亮回退：react-markdown 默认 `<pre><code>` 渲染可用且可读
- [x] 4.4 空内容回退：content 为空时仍走纯文本 placeholder/思考中逻辑

## 5. 测试与验收

- [x] 5.1 新增 `src/chat/MarkdownView.test.tsx`：标题/列表/代码块/行内代码渲染断言、raw HTML 被转义（skipHtml）、表格、链接 target、空内容回退
- [x] 5.2 `npm test` 全量通过；`npm run typecheck` 通过
- [ ] 5.3 手动冒烟：聊天窗助手回复呈现结构化 Markdown（标题/列表/代码块/表格/链接）；用户消息仍纯文本；流式期间为纯文本后完成态排版；工具时间线/引用块正常
