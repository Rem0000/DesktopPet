## Why

桌宠界面上的提示文案与未使用的「切换心情」增加干扰；导入入口「模型文件 / 文件夹」功能重叠。更关键的是每次导入都会在 `layer-packs/live2d-models` 留下完整拷贝且无法管理，目录会持续膨胀，也缺少在已导入包之间切换的能力。

## What Changes

- 移除模型下方操作提示文案（如「拖拽移动 · 悬停跟随…」）
- 移除导入成功后顶部状态提示条（status toast）及相关导入/恢复提示展示
- 右键菜单移除「切换心情」
- **BREAKING（菜单）**：去掉「导入 Live2D 模型」（选单个 json）；仅保留「导入 Live2D 文件夹」
- 新增**已导入模型管理窗口**：列出 `layer-packs/live2d-models` 下的导入包，支持删除、切换为当前桌宠模型；从右键菜单打开

## Capabilities

### New Capabilities

- `pet-chrome-cleanup`: 精简宠物窗口与右键菜单上的多余文案与无用项
- `live2d-model-library`: 已导入 Live2D 包的列表、删除与切换管理

### Modified Capabilities

- （无；既有 session-restore / package-formats 需求保持，导入改为仅文件夹入口）

## Impact

- `src/pet/PetStage.tsx`、`src/styles.css`：去掉 `.hint` 展示
- `src/App.tsx`：去掉/停用 status toast；导入仅 folder；接入管理窗
- `electron/main.ts` / `preload.ts`：菜单去心情与「导入模型」；新增 list/delete/apply 导入包 IPC；可选独立 BrowserWindow 或渲染内面板
- `electron/live2dBind.ts` 或新建 `live2dLibrary.ts`：扫描 `live2d-models`、删除目录、解析包元数据
- 删除当前会话对应目录时需清除 session / 回退默认桌宠
