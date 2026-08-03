## Context

聊天窗 `src/chat/chat.css` 现状：`:root` 只有 `color/background/font-family`；`.session-sidebar` 深海军蓝渐变（`#233552→#1b2a42`）；`.conversation`/`.message-list` 白底；气泡 `#fff`/`#dceaff` 平铺色；无头像、无入场动画、无流式光标。桌宠本体 `src/styles.css` 已定义 `--ink:#1e2a32 / --panel:rgba(255,252,248,.94) / --accent:#2f6fed / --soft:#7ec8e3 / --line:rgba(30,42,50,.12)` + `backdrop-filter: blur(8px)` + 大圆角 + 柔和阴影。

聊天窗尺寸 920×680，`ChatApp.tsx` 单文件。助手头像来源：`window.petAPI.live2d.listLive2DLibrary()` 返回带 `modelUrl`（`pet-asset://` 的 model.json）的包信息；`modelUrl` 已可跨协议加载（`petAssetProtocol` 注册）。

## Goals / Non-Goals

**Goals:**
- 聊天窗视觉对齐桌宠：暖米白底 + 磨砂面板 + accent 渐变用户气泡 + 暖白助手气泡 + 柔和阴影大圆角
- 助手消息显示当前包头像；流式回复带闪烁光标；工具时间线/引用块样式升级
- 消息区窄栏居中、会话列表日期分组；纯 CSS 实现，JSX 改动最小化
- 保持现有功能与测试全绿

**Non-Goals:**
- 改主进程/契约/IPC（零改动）
- 引入 UI 框架/Tailwind/CSS-in-JS/新依赖
- 深色/暗色主题（本期仅暖色一档；变量化后后续易扩展）
- 大改布局结构（不重排窗口/组件层级）

## Decisions

### D1. 用 CSS 变量对齐桌宠，不引入设计系统
- **选择**：`chat.css` 顶部定义 `:root` 变量（沿用桌宠 `--ink/--panel/--accent/--soft/--line` 同值），全文替换硬编码色。侧栏改为暖深色（`#1f2a36` 系）或半透明磨砂；会话区暖米白 `#f7f3ec`。
- **理由**：桌宠已有一致 token，直接复用即"一家人"；零依赖。
- **备选**：引入 Tailwind → 否决（项目纯 CSS、包体/迁移成本）。

### D2. 助手头像用 `modelUrl`（pet-asset://），缺失回退 emoji 首字母
- **选择**：`ChatApp` 挂载时 `live2d.listLive2DLibrary()` 取活跃包 → 存 `{ id, displayName, modelUrl }`。助手气泡左侧渲染头像：`modelUrl` 存在则 `<img src={modelUrl}>`（Live2D model.json 常带贴图，作占位预览），失败/缺失回退 displayName 首字符的圆形底。会话区顶部也显示当前宠物头像 + 名字。
- **理由**：Live2D 包无预览图字段，modelUrl 是可得的最近似头像；回退保证任何包都能显示。
- **注意**：`pet-asset://` 图片需 `crossOrigin` 处理（参照 `Live2DView.tsx:179`）；头像加载失败静默回退。

### D3. 流式光标 + 入场动画 + 时间线胶囊
- **选择**：`.streaming-caret`（竖条闪烁 `@keyframes caret-blink`）在流式消息末尾；气泡复用桌宠 `bubble-in`（180ms fade+translate+scale）；`.tool-timeline` 改胶囊（`border-radius:999px`、accent 淡底、`::before` 状态点）；引用块改卡片（圆角 + 描边 + 折叠）。
- **理由**：对齐桌宠动画手感；时间线胶囊呼应 `.chip`。

### D4. 消息区窄栏 + 日期分组
- **选择**：`.message-list` 内加 `max-width: 760px; margin: 0 auto` 居中；会话列表按「今天/昨天/更早」`<small>` 日期标签分组（JSX 内按 `updatedAt` 判断）。
- **理由**：阅读宽度 + 时间秩序感，成本低。

### D5. 主题可观测：不改契约
- 所有改动收敛在 `src/chat/*`；无 IPC/契约变化；`npm test`/`typecheck`/`build` 全绿。

## Risks / Trade-offs

- **[Risk] `pet-asset://` 头像加载失败/跨域** → Mitigation：`onError` 回退 emoji 首字母；参照 Live2DView 的 crossOrigin 处理。
- **[Risk] CSS 重构影响既有选择器** → Mitigation：以变量替换为主、选择器命名保留；跑全量测试 + build 验证；手动冒烟聊天主路径。
- **[Trade-off] 玻璃拟态信息密度低** → 不做整窗磨砂，只对面板/头部/输入区轻磨砂，消息区实底保证可读。
- **[Trade-off] 头像用 modelUrl 可能不是最佳预览** → 接受：无更好来源；回退保证兜底。

## Migration Plan

纯增量：CSS 变量替换 + JSX 增删元素；无数据/配置迁移。回滚：恢复 `chat.css`/`ChatApp.tsx` 原内容即可，不影响任何持久化数据与主进程。

## Open Questions

- 头像是否要在助手每条消息都显示（占宽度）还是只显示一次成组——实现按「每条助手消息显示、空行间隔成组」即可。
- 侧栏磨砂 vs 暖深实底——实现按暖深实底（可读性稳），头部/输入区磨砂。
