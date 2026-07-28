## 1. Chrome cleanup

- [x] 1.1 移除 `PetStage` 底部 `.hint` 文案渲染及相关样式依赖
- [x] 1.2 移除 `App` 顶部 `status-toast` 展示（导入/恢复不再弹顶栏提示）
- [x] 1.3 右键菜单去掉「切换心情」及无用 mood 菜单状态字段
- [x] 1.4 右键去掉「导入 Live2D 模型」；仅保留「导入 Live2D 文件夹」，IPC/对话框固定 folder 模式

## 2. Library backend

- [x] 2.1 新增扫描 `layer-packs/live2d-models` 的 list API（目录元数据 + catalog 摘要 / invalid 标记）
- [x] 2.2 新增 delete 包目录 API；若删当前会话包则通知渲染进程退出 Live2D
- [x] 2.3 新增 apply/switch 包 API：重算 `pet-asset` URL 并下发 session（与导入成功路径一致）
- [x] 2.4 preload 暴露 list / delete / apply / open-manager 相关 API

## 3. Manager window UI

- [x] 3.1 创建管理窗（独立 BrowserWindow + 简单列表页）：打开/聚焦、列出包、空状态
- [x] 3.2 列表项支持「切换为当前」与「删除」（删除当前包需确认）
- [x] 3.3 右键菜单增加「管理已导入模型」入口；导入成功后管理窗若打开则刷新

## 4. Verification

- [x] 4.1 确认无底部提示、无顶栏 toast、无心情菜单、仅文件夹导入
- [x] 4.2 管理窗可列出/切换/删除；删除当前模型回退默认桌宠；切换后重启仍按 session 恢复
