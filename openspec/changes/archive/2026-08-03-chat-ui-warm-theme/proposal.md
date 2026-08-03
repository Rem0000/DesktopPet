## Why

聊天窗口当前是「冷色海军蓝侧栏 + 白底会话区」，而桌宠本体是「暖米白面板 + accent 蓝 + 磨砂气泡」（`src/styles.css`），两套视觉语言割裂，陪伴感弱。调研 2025 年桌宠/AI 伴侣 UI 后确认主线：暖色陪伴风（半透明面板 + 大圆角 + 柔和阴影 + 情感化气泡）。本轮把聊天窗对齐桌宠本体视觉语言，纯 CSS + 少量 JSX 增强，不动主进程与共享契约。

## What Changes

- **配色变量化**：`chat.css` 引入 `:root` 变量对齐桌宠（`--ink/--panel/--accent/--soft/--line`），会话区/头部/输入区改为暖米白 + 磨砂，侧栏从冷海军蓝改暖深色/半透明磨砂
- **气泡增强**：助手侧显示**当前 Live2D 包头像**（`live2d.libraryList()` 取 `modelUrl`）；用户气泡用 accent 渐变、助手气泡暖米白；入场动画复用桌宠 `bubble-in` 手感
- **流式反馈**：流式回复加闪烁光标；工具时间线改胶囊样式；引用块收进卡片
- **布局微调**：消息区窄栏居中（阅读宽度）；会话列表按日期分组；头部显示宠物身份
- 纯前端改动：不改主进程、不新增依赖、不改 `contracts.ts`

## Capabilities

### New Capabilities

- `chat-ui-warm-theme`: 聊天窗口暖色陪伴风主题——CSS 变量对齐桌宠、气泡/头像/流式光标/时间线/输入区样式增强

### Modified Capabilities

- `pet-chat-window`: 即时通信式消息交互——暖色主题呈现与助手头像展示

## Impact

- **前端**：`src/chat/chat.css`（主题重构）、`src/chat/ChatApp.tsx`（助手头像、消息日期分组、流式光标元素）、可选 `src/chat/MarkdownView.tsx`（代码块配色对齐）
- **测试**：现有测试不变；若有新增 JSX 结构则补组件测试或断言
- **主进程/契约**：零改动
