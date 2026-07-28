## Why

当前导入只面向 Cubism 4（`model3.json` / `.moc3`），不少现成模型仍是 Cubism 2（`model.json` / `.moc`），且动作语音常放在 `voice/` 下的 `.wav` 而未被识别。导入成功后视线跟随仅限宠物窗口内，体验偏弱；每次启动还会清空上次会话，需要重新导入。需要一次补齐格式兼容、全屏跟随与会话恢复。

## What Changes

- 导入支持 **Cubism 2** 模型包：识别 `model.json` / `.moc`，与现有 Cubism 4 包同样复制整包并解析清单
- 导入时扫描并登记 **`voice/`（及 model3/model 中 Sound 引用）下的 `.wav`**，动作播放时可发声；目录存在但未声明的 wav 也进入 catalog
- Live2D **导入/恢复成功后**，鼠标跟随改为 **全屏光标跟踪**（不再仅限宠物窗口内 hover）
- **启动后默认恢复**上次成功导入的 Live2D session（去掉启动时强制清空）；退出 Live2D 仍可回到默认桌宠并清除持久化

## Capabilities

### New Capabilities

- `live2d-package-formats`: 导入与 catalog 对 Cubism 2（moc/model.json）及 voice 目录 wav 的支持
- `live2d-fullscreen-focus`: Live2D 激活后用屏幕全局光标驱动视线跟随
- `live2d-session-restore`: 启动时恢复上次成功导入的 Live2D 会话

### Modified Capabilities

- （无既有 main specs；本变更全部以新能力引入）

## Impact

- `electron/live2dBind.ts`：模型发现、`.moc`/`.moc3` 校验、voice/wav 清单
- `electron/main.ts` / `preload.ts`：可选全局光标轮询 IPC
- `src/live2d/Live2DView.tsx`：Cubism2 加载路径、全屏 focus、声音
- `src/live2d/session.ts` / `src/App.tsx`：启动恢复、停止清空 session
- 依赖：现有 `pixi-live2d-display`（cubism4；Cubism2 需确认是否引入 `/cubism2` 入口或统一工厂）
