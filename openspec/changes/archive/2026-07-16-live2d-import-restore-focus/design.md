## Context

桌宠已能导入 Cubism 4（`*.model3.json` + `.moc3`）并通过 `pet-asset://` 加载贴图/动作。渲染侧仅挂载 `pixi-live2d-display/cubism4`；视线跟随监听宠物窗口内的 `pointermove`。`App` 启动时主动 `removeItem` 清空 Live2D session，因此无法记住上次模型。

用户模型库中仍有 Cubism 2 包（`model.json` + `.moc`），且语音常在 `voice/*.wav`。需要在不大改架构的前提下扩展导入与交互。

## Goals / Non-Goals

**Goals:**

- 同一导入入口同时支持 Cubism 2 / 4 完整包复制与 catalog
- 识别 model 声明的 Sound 路径，以及包内 `voice/`（及常见别名）下的 `.wav`
- Live2D 会话激活后，用屏幕全局光标驱动模型 `focus`
- 启动恢复上次成功导入的 session；用户「退出 Live2D」后不再自动恢复直至再次导入

**Non-Goals:**

- 不支持把 `.cmo3` / Editor 工程当运行时模型直接播放
- 不实现独立「语音列表」UI 或 TTS；仅随动作/Sound 引用播放
- 不改为真正的全屏透明覆盖窗抢鼠标；跟随只读光标位置，不改变点击穿透策略
- 不迁移旧 Framework（仍用 pixi-live2d-display）

## Decisions

### 1. Cubism 2 加载入口

- **选择**：渲染侧按 settings 扩展名选择 `pixi-live2d-display/cubism2` 或 `/cubism4`；导入侧统一返回 `modelUrl` + `runtime: 'cubism2' | 'cubism4'`。
- **理由**：两套 runtime 不能混用同一 `Live2DModel` 工厂；按包分流最稳。
- **备选**：只支持 Cubism 4 — 不满足用户 moc 需求。

### 2. 模型文件发现规则

- **选择**：目录导入时优先找 `*.model3.json`，否则找 `model.json` / `*.model.json`；文件导入对话框扩展名包含 `json`，并由内容/文件名判定版本。必要文件：Cubism4 要 `.moc3`+贴图；Cubism2 要 `.moc`+贴图。
- **理由**：与现有 `findModel3InDir` 渐进扩展，避免误把普通 json 当模型。

### 3. voice / wav 清单

- **选择**：catalog 增加 `voices: string[]`（相对模型目录的路径）；合并 (a) Motions[].Sound 引用，(b) 递归扫描 `voice/`、`voices/`、`sounds/` 下的 `.wav`（及已声明的 `.mp3` 等）。播放仍走 pixi-live2d-display 的 Sound 字段；未绑定动作的 wav 仅出现在 catalog，供后续菜单扩展（本变更可不加菜单项）。
- **理由**：满足「存在 voice 目录」的导入完整性；与已有 motion Sound 不冲突。
- **备选**：仅信任 model json 中的 Sound — 会漏掉孤立 wav。

### 4. 全屏鼠标跟随

- **选择**：主进程在 Live2D 激活时以约 30–60ms 间隔 `screen.getCursorScreenPoint()`，经 IPC 推送给渲染进程；`Live2DView` 将屏幕坐标换算到模型逻辑坐标后调用 `focus`。窗口内 pointer 跟随可保留作补充或关闭以免打架（优先全局流）。
- **理由**：无边框小窗无法收到窗外鼠标事件；轮询实现简单、不依赖额外权限。
- **备选**：全屏透明窗 — 复杂且影响点击穿透。

### 5. Session 恢复

- **选择**：删除启动时的 `localStorage.removeItem`；启动用 `loadLive2DSession()`。持久化仍写 `desktop-pet-live2d-session`。恢复前主进程校验 `model3Path`/`outDir` 是否仍存在且 `pet-asset` 可达，失败则清 session 并回退默认桌宠。退出 Live2D 时 `saveLive2DSession(null)`。
- **理由**：用户明确要求默认加载上次成功导入；路径失效要有兜底。

## Risks / Trade-offs

- [Cubism2 Core 脚本未预载] → Mitigation：仿 Cubism4，在 `public/live2d` 提供 Cubism2 runtime（若包自带）或文档说明；`ensureCubismCore` 按 runtime 分支加载。
- [全局光标轮询耗电/卡顿] → Mitigation：仅 Live2D 激活时开启；离开 Live2D 停止；间隔 ≥30ms。
- [旧 session 使用过期 `file://` URL] → Mitigation：恢复时用磁盘路径重算 `pet-asset` URL，不盲信缓存的 modelUrl。
- [孤立 wav 无法自动播] → Mitigation：本变更保证导入与 catalog；自动绑定留给后续。

## Migration Plan

- 开发态热更新即可；无数据库迁移。
- 已有 localStorage session：若含旧 `file://` modelUrl，恢复逻辑重算 URL。
- 回滚：恢复启动清空 session；去掉 cubism2 分支与光标 IPC。

## Open Questions

- Cubism2 官方 `live2d.min.js` 是否已放入仓库；若无，实现阶段需补资源或限制仅当环境已有全局 `Live2D` 时启用。
- 「全屏跟随」是否在鼠标穿透开启时仍保持（默认：是，轮询不依赖命中测试）。
