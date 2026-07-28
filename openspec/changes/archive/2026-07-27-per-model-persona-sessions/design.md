## Context

当前 Live2D 库与聊天是两套子系统：模型切换只改渲染与 localStorage；聊天使用全局 `DEFAULT_SYSTEM_PROMPT`，会话无 `packageId`，长期记忆中 `profile`/`preference`/`fact` 均跨会话共享。用户需要一人多模型：换模型换人设与会话列表，同时共享用户画像与事实约定。

约束：不引入向量库；不做系统定时通知；默认包 `import-2026-07-16T09-28-47-370Z` 必须始终可用；人设热更新（读最新文件，不做按会话快照）。

## Goals / Non-Goals

**Goals:**

- 包级人设文件 + 管理窗编辑 + Agent 组装时热读。
- 会话绑定 `packageId`；UI 按当前模型过滤；切模型换轨。
- 删包级联删该包会话与摘要；默认包不可删；空库/首次启动回退默认包。
- 记忆：全局仅 `profile` + `fact`/`commitment`；废弃 preference；口吻类走人设。
- 移除主路径非 Live2D（`DefaultPet` 不再作为运行态）。

**Non-Goals:**

- 本地定时任务 / 托盘到点提醒（另开需求）。
- 自动把对话中的口吻要求写入人设文件（一期仅可提示用户去管理窗修改）。
- 云同步、多用户账号。
- 按会话冻结旧人设快照。

## Decisions

### 1. 人设文件位置与格式

在每个 `import-*` 目录存放 `persona.md`（纯文本/Markdown 正文即系统提示词）。空文件或不存在 → 使用 `DEFAULT_SYSTEM_PROMPT`。

备选 JSON `{ "systemPrompt": "..." }`：多一层解析；一期用 `persona.md` 便于用户手改。

热更新：每次 `assemble`/`stream` 前按当前 `activePackageId` 读盘，不缓存跨请求的旧正文（可做进程内短缓存，文件 mtime 失效）。

### 2. 默认包保护

常量 `DEFAULT_LIVE2D_PACKAGE_ID = 'import-2026-07-16T09-28-47-370Z'`。库列表可展示；删除 API 拒绝删除该 id。用户删光其他包后 `apply` 该默认包。启动无有效 session 时同样加载默认包。

备选「种子复制」：改动更大；默认包已在仓库中，保护不可删即可。

### 3. 会话模型绑定

`ChatSession` 增加必填 `packageId`。`listSessions(packageId)` / `createSession(packageId)`。切模型事件通知聊天窗：选中该包最近会话，若无则自动新建。发送消息时校验 session.packageId === 当前包，否则拒绝。

既有无 `packageId` 会话：迁移挂到默认包 id（一次性 schema bump）。

### 4. 删除级联

`library-delete` 成功后：`ChatStore.deleteSessionsByPackageId(id)` + `MemoryStore` 删除这些 session 的 summaries。不删全局 L2 条目。

### 5. 记忆边界

- 保留工具：`update_profile`、`remember_fact`、`forget_memory`
- 移除或停用：`remember_preference`（注册表不再提供；若模型仍调用则返回明确错误「请将个性化要求写入人设」）
- 召回组装：人设 + profile + fact/commitment + 会话摘要 + 近期消息
- 记忆面板文案：说明偏好口吻请改人设；面板可链到管理窗（可选，非必须）

### 6. 去掉非 Live2D 运行态

- 启动/恢复失败 → 强制默认 Live2D 包，不再渲染 `DefaultPet` 作为主皮
- 管理窗删除当前模型：若删的是非默认包，切到默认包；不可删默认包
- 上下文菜单移除「退出 Live2D」类能力（若仍存在）

### 7. 模型切换与聊天同步

主进程在 `library-apply` / 默认回退 / 导入激活时广播 `live2d:active-package`（或复用现有 `live2d:session` 并携带 `packageId`）。聊天窗订阅后刷新会话列表与当前会话。

## Risks / Trade-offs

- [误删默认包意图] → API 硬拒绝 + UI 禁用删除  
- [人设热更新导致同会话人格跳变] → 接受；可在保存人设后 toast「后续对话将按新人设」  
- [废弃 preference 后旧数据] → 迁移时忽略 preference 条目不再召回，或一次性展示后清理；推荐停止召回 preference，保留文件供手工清理  
- [无 packageId 旧会话归属] → 挂默认包，可能把历史都堆在默认角色下  
- [Agent 仍把「加喵」写成 fact] → 工具描述强调 fact 为用户侧事实/约定；口吻类提示改人设  

## Migration Plan

1. ChatStore schema +1：`packageId`；旧会话 → 默认包 id  
2. Memory：召回过滤掉 `preference`；注销 `remember_preference`  
3. 启动路径改为始终 Live2D（默认包兜底）  
4. 管理窗加人设编辑与默认包删除保护  
5. 回滚：恢复全局 prompt + 忽略 packageId 过滤（数据仍兼容）

## Open Questions

- 记忆面板是否提供「打开当前模型人设」快捷入口？（默认：管理窗已有编辑即可，聊天侧可选增强）  
- 默认包是否允许用户清空人设（回退默认提示）？（默认：允许）
