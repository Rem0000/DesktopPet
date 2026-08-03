## Purpose

小说工坊独立窗口与 IPC 边界，与聊天模块隔离。

## Requirements

### Requirement: 独立小说工坊窗口
系统 SHALL 提供独立于聊天窗口与模型管理窗口的小说工坊 BrowserWindow，加载专用前端入口（如 `novel.html`），并 SHALL 通过主进程 IPC 访问小说业务能力。该窗口 MUST NOT 复用聊天会话列表协议作为写作主界面。

#### Scenario: 打开工坊
- **WHEN** 用户从桌宠托盘或右键菜单选择打开小说工坊
- **THEN** 系统显示小说工坊窗口（若已存在则前置聚焦），且不打开或依赖聊天窗口

#### Scenario: 关闭工坊不影响聊天
- **WHEN** 用户关闭小说工坊窗口
- **THEN** 聊天窗口、桌宠主窗口与用户长期记忆保持原状，未完成的小说草稿仍保留在小说数据目录

### Requirement: 书架与书籍入口
系统 SHALL 在工坊内提供书架视图，列出本地已创建书籍的标题、更新时间与写作进度摘要，并允许新建、打开与删除书籍。删除书籍 MUST 要求确认，并仅删除该 `bookId` 下小说数据。

#### Scenario: 新建书籍出现在书架
- **WHEN** 用户完成建书向导并保存
- **THEN** 书架立即显示该书目，且可进入书详情/大纲/写章界面

#### Scenario: 删除书籍不碰聊天记忆
- **WHEN** 用户确认删除某书
- **THEN** 系统移除 `data/novels/<bookId>/` 下数据，且 `data/memory/` 与聊天会话不受影响

### Requirement: 与聊天隔离的 IPC 边界
系统 SHALL 使用小说专用 IPC 通道（命名空间与聊天 IPC 区分）处理书架、大纲、写章、状态面板等操作。小说模块 MUST NOT 调用聊天记忆写入接口，MUST NOT 将小说状态注入聊天 Agent 默认召回。

#### Scenario: 小说操作不写用户记忆
- **WHEN** 用户在工坊 Accept 一章并更新角色状态
- **THEN** 用户长期记忆库（profile/fact 等）条目数量与内容不因该操作而改变

#### Scenario: 聊天工具集不变
- **WHEN** 小说模块已启用
- **THEN** 聊天 Agent 默认注册工具集不因此新增写作专用工具
