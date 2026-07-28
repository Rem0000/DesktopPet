## Context

导入会把整包复制到 `layer-packs/live2d-models/import-<stamp>/`，当前无列表/删除/切换 UI。宠物舞台有底部 `.hint` 与顶部 `status-toast`；右键同时有「导入模型」「导入文件夹」和未使用的「切换心情」。

## Goals / Non-Goals

**Goals:**

- 界面去掉底部提示与顶部导入/状态 toast
- 右键去掉心情与「导入 Live2D 模型」，仅保留文件夹导入
- 提供管理窗：列出已导入包、删除、切换当前模型

**Non-Goals:**

- 不自动清理历史导入（仅用户主动删除）
- 不实现云端模型库或重命名编辑器
- 不改动全屏跟随 / session 持久化核心逻辑（切换模型时复用现有 apply/persist）

## Decisions

### 1. 管理 UI 形态

- **选择**：独立小号 `BrowserWindow`（如 420×480），加载 Vite 路由或 `manager.html`，通过 preload 调用同一套 IPC；右键「管理已导入模型」打开。
- **理由**：宠物窗透明无框，塞复杂列表易挡桌宠；独立窗更清晰。
- **备选**：宠物窗内模态面板 — 实现快但遮挡与拖拽冲突。

### 2. 包列表数据

- **选择**：主进程扫描 `live2d-models` 下一级目录，对每个目录调用既有 `findModelSettingsInDir` + `parseLive2DCatalog`，返回 `{ id: 目录名, dir, model3Path, runtime, catalog 摘要, importedAt 从目录名解析 }`。
- **理由**：复用导入逻辑，无额外索引文件。
- **备选**：写 `index.json` — 需迁移与一致性维护。

### 3. 删除与切换

- **删除**：`fs.rm(dir, { recursive: true })`；若删除的是当前 session 的 `outDir`/`model3Path` 所在包，则通知渲染进程 `persistLive2d(null)` 并停光标跟随。
- **切换**：对目标包 `pathToPetAssetUrl` + catalog，走与导入成功相同的 session 应用路径（含保存 localStorage）。
- **导入**：对话框仅 `openDirectory`；导入后仍复制到新 `import-*` 目录，管理窗刷新列表。

### 4. Chrome 清理

- **选择**：`PetStage` 不渲染 `.hint`；`App` 不再渲染 `status-toast`（可保留内部短暂 console 或完全去掉 `status` 状态）。移除 mood 菜单与 `onToggleMood` 接线可保留 API 无用项或一并删。
- **导入菜单**：只留「导入 Live2D 文件夹」；`openLive2DModel` 默认/`folder` only。

## Risks / Trade-offs

- [损坏/不完整 import 目录导致列表报错] → Mitigation：单包解析失败时标记 `invalid` 仍可删除，不阻塞列表。
- [删除当前模型时渲染仍持有旧 URL] → Mitigation：先通知卸载 session，再删目录。
- [管理窗与主窗 session 不同步] → Mitigation：切换/删除后主窗经 IPC `live2d:session` / `pet:exit-live2d` 统一更新。

## Migration Plan

- 已有 `import-*` 目录自动出现在列表，无需迁移。
- 回滚：恢复双导入菜单、hint、toast、心情项；去掉管理窗入口。

## Open Questions

- 管理窗是否需「显示在文件管理器中」快捷操作（默认不做）。
- 列表显示名：优先用 settings 文件名（如 Haru），副标题用目录 stamp。
