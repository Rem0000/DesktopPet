## 1. 数据路径与契约

- [x] 1.1 扩展 `DataSubpath` / `ensureDataDirs` 增加 `novels/`，并更新 project-data-store 相关测试或断言
- [x] 1.2 在 `src/novel/contracts.ts`（或共享 contracts 分区）定义 BookMeta、Outline、Character、Relationship、Knowledge、Timeline、Promise、Canon、Chapter、Draft、StateDiff、Divergence、GuardWarning 等类型
- [x] 1.3 README 数据目录表补充 `data/novels/` 说明（一书一库、与 memory/knowledge 隔离）

## 2. StoryStore 持久化

- [x] 2.1 实现 `electron/novel/novelStoryStore.ts`：书籍 CRUD、目录脚手架、原子读写 JSON/Markdown
- [x] 2.2 实现角色 / 关系 / 知情差 / 时间线 / 伏笔账本 / Canon 的读写与基础查询（含休眠伏笔列表）
- [x] 2.3 实现章节草稿多版本保存、Accept 正文落盘、章摘要存储
- [x] 2.4 为 StoryStore 编写单元测试（隔离、Accept 前后状态、删书清理）

## 3. 书内检索索引

- [x] 3.1 实现书内索引模块：Accept 后切块/摘要入库，复用 Embedding + Hybrid 内核，路径落在 `novels/<bookId>/index/`
- [x] 3.2 实现删书/重建索引；Embedding 不可用时返回明确错误或稀疏降级标记
- [x] 3.3 编写索引更新与隔离测试（不写 knowledge/memory）

## 4. 小说 Runtime 与工作流

- [x] 4.1 实现 `novelRuntime`：大纲生成/修订节点（产出可编辑草案，不自动覆盖锁定大纲）
- [x] 4.2 实现写章图：assemble（固定块+检索块预算）→ draft（流式）→ extractDiff → guard
- [x] 4.3 实现 Accept IPC 路径：应用可编辑 Diff、写 Canon/状态、摘要、索引、可选 Divergence；支持带告警 override
- [x] 4.4 实现 Reject / 按反馈改稿，确保不修改 Canon
- [x] 4.5 复用主进程 Provider/API Key；小说侧不回传明文 Key

## 5. 服务层与 IPC / 窗口壳

- [x] 5.1 实现 `novelService` / `novelController`：书架、建书、大纲、写章、状态面板、Accept/Reject API
- [x] 5.2 `main.ts` 增加独立小说 BrowserWindow、托盘/右键入口；preload 暴露小说专用 IPC（与 chat 命名空间分离）
- [x] 5.3 Vite 增加 `novel.html` 入口与构建配置

## 6. 工坊前端 UI

- [x] 6.1 书架页：列表、新建向导（现实向字段）、打开、删除确认
- [x] 6.2 大纲编辑器：展示卷章、AI 生成/局部修订、人工编辑、锁定/保存、覆盖确认
- [x] 6.3 写章工作台：组装信息可见、流式草稿、Diff 预览编辑、Guard 告警、Accept/Reject/改稿
- [x] 6.4 状态面板：角色/关系/知情/时间线/伏笔/Divergence；支持手工纠错关键字段
- [x] 6.5 Embedding 不可用或降级时的风险提示 UI

## 7. 隔离与回归验证

- [x] 7.1 验证小说 Accept 不写入 `data/memory/`；聊天召回不含 novels 数据
- [x] 7.2 验证聊天默认 ToolRegistry 不出现写作专用工具
- [x] 7.3 补充关键路径集成/单元测试；手动冒烟：建书 → 生成大纲 → 写章 → Accept → 再写下一章可召回
