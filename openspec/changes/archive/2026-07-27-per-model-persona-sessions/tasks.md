## 1. 默认 Live2D 与去掉非 Live2D

- [x] 1.1 定义 `DEFAULT_LIVE2D_PACKAGE_ID`，启动/无效 session 回退到该包而非 DefaultPet
- [x] 1.2 删除 API 拒绝删除默认包；删当前非默认包后切换到默认包
- [x] 1.3 移除「退出 Live2D」菜单/路径；主窗口运行态始终加载某个 Live2D 包
- [x] 1.4 更新 live2d-session-restore 相关逻辑与管理窗删除文案

## 2. 人设文件与管理窗

- [x] 2.1 实现包目录 `persona.md` 读写 IPC（get/set）与空内容回退约定
- [x] 2.2 管理窗为每个模型增加「设置人设」编辑/保存 UI，保存后提示热更新生效
- [x] 2.3 Agent 组装路径按当前 `packageId` 热读人设，空则 `DEFAULT_SYSTEM_PROMPT`

## 3. 会话绑定模型

- [x] 3.1 ChatStore schema 增加 `packageId`；旧会话迁移到默认包 id
- [x] 3.2 list/create/get 按当前活跃包过滤；发送时校验 session 与活跃包一致
- [x] 3.3 聊天窗订阅模型切换：刷新侧栏、选中最近会话或自动新建
- [x] 3.4 删除非默认包时级联删除该 `packageId` 会话与对应 SessionSummary

## 4. 记忆边界修订

- [x] 4.1 注销 `remember_preference`；召回不再注入 preference 类型
- [x] 4.2 更新工具描述与 plan 指令：画像→profile，事实约定→fact，口吻规范→提示改人设
- [x] 4.3 组装顺序固定为人设 + profile + fact/commitment + 摘要 + 近期消息
- [x] 4.4 更新/补充记忆与 Agent 相关单元测试

## 5. 验收

- [x] 5.1 typecheck 与相关单元测试通过
- [x] 5.2 手动：切模型只见对应会话；改人设后下一轮口吻变化；全局画像/fact 跨模型仍在
- [x] 5.3 手动：默认包不可删；删用户包级联清会话并回退默认包；无非 Live2D 回退
