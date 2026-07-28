## 1. Import formats (Cubism 2 + voice wav)

- [x] 1.1 扩展 `electron/live2dBind.ts`：发现 `model.json` / `*.model.json` 与 `.moc`，返回 `runtime: 'cubism2' | 'cubism4'`
- [x] 1.2 扩展 `parseLive2DCatalog`：扫描 `voice/`、`voices/`、`sounds/` 下 `.wav`，写入 `catalog.voices`；校验 motion Sound
- [x] 1.3 更新 `assertEssentialFiles`：Cubism2 要求 `.moc`+贴图，Cubism4 要求 `.moc3`+贴图
- [x] 1.4 更新 preload/类型与对话框文案，允许导入 Cubism2 设置文件

## 2. Cubism 2 渲染加载

- [x] 2.1 确认/补齐 Cubism2 运行时资源与 `ensureCubismCore`（或等价）按 runtime 分支加载
- [x] 2.2 `Live2DView` / `PetStage` 按 session.runtime 动态加载 cubism2 或 cubism4 的 `Live2DModel`
- [x] 2.3 验证 motion Sound 经 `pet-asset` 可播放（含 voice 路径）

## 3. Full-screen cursor focus

- [x] 3.1 主进程增加 Live2D 激活时的光标轮询（`screen.getCursorScreenPoint`）+ IPC 推送
- [x] 3.2 preload 暴露订阅/启停 API
- [x] 3.3 `Live2DView`：导入/显示成功后启用全局 focus，将屏幕坐标映射到模型 `focus`；退出 Live2D 时停止轮询

## 4. Session restore on startup

- [x] 4.1 移除 `App` 启动时清空 `localStorage` session 的逻辑
- [x] 4.2 启动时 `loadLive2DSession()`；校验磁盘路径存在并用本地路径重算 `pet-asset` URL
- [x] 4.3 「退出 Live2D」继续 `saveLive2DSession(null)`，下次启动不自动恢复

## 5. Verification

- [x] 5.1 导入含 `voice/*.wav` 的 Cubism4 包与含 `.moc` 的 Cubism2 包各一次
- [x] 5.2 确认窗外移动鼠标时视线跟随；退出 Live2D 后跟随停止
- [x] 5.3 重启应用后自动加载上次成功导入的模型；删除模型目录后启动回退默认桌宠
