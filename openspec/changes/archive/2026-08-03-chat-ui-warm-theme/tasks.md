## 1. 主题变量与配色

- [x] 1.1 `chat.css` `:root` 定义 `--ink/--panel/--accent/--soft/--line/--panel-solid/--warm-bg/--sidebar-bg`（对齐桌宠 `src/styles.css`），替换硬编码色
- [x] 1.2 会话区暖米白底（`--warm-bg`）、侧栏暖深实底（`--sidebar-bg`）、头部/输入区磨砂面板（`--panel` + backdrop-filter）
- [x] 1.3 `npm test` / `typecheck` 全绿

## 2. 助手头像

- [x] 2.1 `ChatApp.tsx`：挂载时 `listLive2DLibrary()` 取活跃包（id/displayName/modelUrl），存 `petProfile` state
- [x] 2.2 助手消息行渲染 `PetAvatar`（modelUrl → `<img>` + onError 回退，否则首字符圆形底）
- [x] 2.3 会话区头部显示当前宠物头像 + 名字（`conversation-identity`）
- [x] 2.4 `chat.css` 头像样式（`.pet-avatar.message/header`、fallback 渐变底）

## 3. 流式反馈与时间线

- [x] 3.1 流式消息末尾闪烁光标 `.streaming-caret`（@keyframes caret-blink）
- [x] 3.2 气泡入场动画 `bubble-in`（fade + translate + scale，180ms）
- [x] 3.3 `.tool-timeline` 改胶囊样式 + 状态点 `.tool-dot`（running/ok/fail）；引用块改卡片样式（圆角/描边/背景）

## 4. 布局微调

- [x] 4.1 `.message-list-inner` 消息区窄栏居中（max-width 760px）
- [x] 4.2 会话列表按今天/昨天/最近7天/更早日期分组（`dateGroupLabel`）
- [x] 4.3 输入区磨砂底（`--panel` + backdrop-filter）

## 5. 验证与文档

- [x] 5.1 `npm test`（201）/ `typecheck` / `npm run build` 全绿
- [ ] 5.2 手动冒烟：聊天主路径、Markdown 渲染、工具时间线、引用块、流式光标、头像显示与回退
- [x] 5.3 `highlight_resume_pet.md` 维护记录追加；worklog 记录
