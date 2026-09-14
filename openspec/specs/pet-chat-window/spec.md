## Purpose

独立于桌宠主窗口的即时通信式聊天界面，支持会话管理、流式回复、长期记忆面板与可操作错误反馈。
## Requirements
### Requirement: 独立聊天窗口
系统 SHALL 在独立于透明桌宠主窗口的 Electron 窗口中提供聊天界面，并保证重复打开请求只聚焦同一个聊天窗口实例。

#### Scenario: 从桌宠菜单打开聊天
- **WHEN** 用户选择“聊天”
- **THEN** 系统显示或聚焦独立聊天窗口，且桌宠主窗口的尺寸和透明渲染区域不被聊天界面改变

#### Scenario: 关闭后重新打开
- **WHEN** 用户关闭聊天窗口后再次选择“聊天”
- **THEN** 系统重新创建聊天窗口并恢复已持久化的会话

### Requirement: 即时通信式消息交互
聊天窗口 SHALL 使用可区分用户与桌宠的消息气泡、可滚动消息列表和固定输入区，并在打开会话或收到新内容时保持当前回复可见。

#### Scenario: 发送文本消息
- **WHEN** 用户输入非空文本并发送
- **THEN** 用户消息立即出现在消息列表中，输入框被清空，系统开始生成桌宠回复

#### Scenario: 防止空消息
- **WHEN** 用户仅输入空白字符并尝试发送
- **THEN** 系统不创建消息且不发起 Agent 请求

#### Scenario: 暖色气泡呈现
- **WHEN** 消息列表渲染用户与桌宠消息
- **THEN** 用户气泡为 accent 渐变、桌宠气泡为暖米白，均使用大圆角与柔和阴影

#### Scenario: 助手 Markdown 回复
- **WHEN** 助手消息完成且内容为 Markdown
- **THEN** 气泡按 Markdown 呈现，用户仍可滚动阅读完整消息列表

### Requirement: 流式回复与取消
聊天窗口 SHALL 增量展示 Agent 回复，SHALL 允许用户停止当前生成，并 SHALL 防止同一会话内并发提交造成消息顺序错乱。

#### Scenario: 接收流式内容
- **WHEN** Agent 持续返回文本片段
- **THEN** 系统在同一个桌宠消息气泡中按顺序追加片段

#### Scenario: 停止生成
- **WHEN** 用户在回复生成期间选择停止
- **THEN** 系统取消对应请求、保留已经生成的文本并恢复可发送状态

### Requirement: 会话和消息持久化
系统 SHALL 持久化会话标识、所属 `packageId`、标题、创建与更新时间以及用户和桌宠消息，并 SHALL 支持在当前模型作用域内新建、切换和删除会话。删除某个 Live2D 包时，系统 SHALL 删除该 `packageId` 下全部会话。

#### Scenario: 重启后恢复当前模型会话
- **WHEN** 应用重启且存在历史会话，且当前活跃为某 Live2D 包
- **THEN** 聊天窗口仅显示该包下的历史会话列表并可继续其中任一会话

#### Scenario: 删除会话
- **WHEN** 用户确认删除一个会话
- **THEN** 系统删除该会话及其消息，且其他会话不受影响

#### Scenario: 删除模型级联会话
- **WHEN** 用户删除某非默认 Live2D 包
- **THEN** 该包下所有聊天会话被删除

### Requirement: 可操作的错误反馈
聊天窗口 SHALL 将配置、鉴权、限流、网络和服务端错误显示为用户可理解且可重试的状态，MUST NOT 将失败伪装为正常的本地模型回复。

#### Scenario: 请求失败
- **WHEN** Agent 请求因网络或 Provider 错误终止
- **THEN** 系统在对应消息位置显示错误与重试入口，并保留用户原始消息

### Requirement: 记忆面板入口
聊天窗口 SHALL 提供查看与编辑共享长期记忆的入口，使用户无需离开聊天即可审计记忆内容。

#### Scenario: 打开记忆面板
- **WHEN** 用户在聊天窗口选择记忆管理入口
- **THEN** 系统展示当前长期记忆条目列表（含类型与内容）

#### Scenario: 在面板中编辑条目
- **WHEN** 用户修改某条记忆并保存
- **THEN** 系统更新该条目且后续对话召回使用新内容

### Requirement: 聊天布局可滚动
聊天窗口在固定窗口高度下 SHALL 保持标题栏、输入区与侧栏操作可见，消息列表（及会话列表）在内容超出时出现内部滚动条，而不是撑破布局迫使用户拉高窗口。

#### Scenario: 长对话仍可滚动阅读
- **WHEN** 会话消息数量使内容高度超过窗口可视区域
- **THEN** 消息列表出现纵向滚动条，输入框与发送按钮仍保持在窗口底部可见

#### Scenario: 侧栏会话过多
- **WHEN** 会话条目数量超过侧栏可用高度
- **THEN** 会话列表出现纵向滚动条，顶部「对话 / 新对话」与底部设置入口仍可见

### Requirement: 会话绑定 Live2D 包
每个聊天会话 SHALL 绑定一个 `packageId`（Live2D 导入包目录名）。新建会话 MUST 使用当前活跃模型的 `packageId`。系统 MUST NOT 允许在绑定其他包的会话中继续发送消息。

#### Scenario: 新建会话归属当前模型
- **WHEN** 用户在某 Live2D 模型为活跃时新建对话
- **THEN** 新会话的 `packageId` 等于当前活跃包 id

#### Scenario: 拒绝跨模型续聊
- **WHEN** 当前活跃包与会话的 `packageId` 不一致且用户尝试发送消息
- **THEN** 系统拒绝发送或先切换到匹配会话，且 MUST NOT 在同一会话中混入另一角色的新回复

### Requirement: 按模型过滤会话列表
聊天窗口侧栏 SHALL 仅列出当前活跃 Live2D 包对应的会话。

#### Scenario: 切换模型后刷新列表
- **WHEN** 用户将活跃模型从包 A 切换到包 B
- **THEN** 侧栏仅显示 `packageId` 为 B 的会话，并选中 B 的最近会话；若 B 无会话则自动新建空会话

### Requirement: 工具调用时间线

聊天窗口 SHALL 在助手回复关联的工具调用发生时展示可折叠的调用时间线，至少包含工具名、状态（进行中/成功/失败）与耗时。当本轮存在工具调用时，时间线 MUST 默认展开；用户可手动折叠。详情 SHALL 可展开查看，且 MUST 包含脱敏后的真实入参内容与工具真实输出（超限时展示预览并提示原文在链路追踪台可查），MUST NOT 仅展示被截断的入参摘要而隐藏输出。时间线的数据来源 SHALL 为会话链路日志的投影，使实时展示与重开窗口后的回填使用同一来源。

#### Scenario: 显示成功工具调用
- **WHEN** Agent 在一次回复中成功执行一个或多个工具
- **THEN** 聊天窗对该轮回复展示对应工具调用条目与成功状态

#### Scenario: 显示失败工具调用
- **WHEN** 某工具调用失败
- **THEN** 时间线显示失败状态与可理解错误摘要，且用户仍可看到后续助手回复（若有）

#### Scenario: 重开聊天窗恢复历史时间线
- **WHEN** 用户关闭聊天窗口后重新打开，且历史助手消息存在已落盘的工具调用记录
- **THEN** 系统从链路日志投影回填对应消息的工具调用时间线与引用来源

#### Scenario: 本轮工具默认展开
- **WHEN** 本轮助手消息开始出现工具调用
- **THEN** 时间线默认处于展开状态

#### Scenario: 展开查看真实输出
- **WHEN** 用户展开某条已完成的工具调用详情
- **THEN** 可见该工具的真实输出内容（或预览与外置原文提示），而非仅有成功标志

### Requirement: 记忆检索入口
聊天窗口 SHALL 提供记忆搜索入口，使用户可按关键词过滤长期记忆列表，并继续支持编辑/删除已有操作。

#### Scenario: 搜索记忆
- **WHEN** 用户在记忆面板输入关键词
- **THEN** 列表仅显示标题或内容匹配的记忆条目

### Requirement: RAG 引用展示
当助手回复使用了本地知识库检索结果时，聊天窗口 SHALL 展示引用来源（文档名与片段摘要）；若本轮未检索或未命中，MUST NOT 伪造引用。

#### Scenario: 展示引用来源
- **WHEN** Agent 基于知识库命中片段生成回复
- **THEN** 聊天窗展示至少一条可辨识的来源引用

#### Scenario: 无命中不展示假引用
- **WHEN** 知识库检索无结果
- **THEN** 聊天窗不展示引用区块

### Requirement: 知识库管理入口
聊天窗口 SHALL 提供本地知识库文档的导入、列表与删除入口，与用户长期记忆分开展示。

#### Scenario: 导入知识库文档
- **WHEN** 用户在知识库面板选择导入 md/txt 文档
- **THEN** 系统保存文档副本并建立可检索索引

#### Scenario: 删除知识库文档
- **WHEN** 用户删除某篇已导入文档
- **THEN** 该文档及其索引不再参与检索

### Requirement: 工具执行中状态提示
在工具调用尚未全部结束、助手正文尚未开始流式输出时，聊天窗口 SHALL 向用户展示「正在调用工具」或等价状态，MUST NOT 仅显示无区分的「思考中」。

#### Scenario: 工具进行中
- **WHEN** 至少一个工具处于 start 且尚未 end，且助手内容仍为空
- **THEN** UI 显示工具执行中状态文案

### Requirement: Confirm 工具确认 UI
当 Agent 请求执行 riskLevel=confirm 的工具时，聊天窗口 SHALL 展示确认界面（含工具名与脱敏入参摘要），并提供确认与拒绝操作；拒绝或超时 MUST 回传否定结果给主进程。

#### Scenario: 用户确认
- **WHEN** 确认 UI 展示后用户点击确认
- **THEN** 主进程收到肯定答复并继续执行该工具

#### Scenario: 用户拒绝
- **WHEN** 确认 UI 展示后用户点击拒绝
- **THEN** 主进程收到否定答复且不执行该工具

### Requirement: Embedding 模型状态横幅
当 Embedding 模型处于 loading 或 error 时，聊天窗口 SHALL 展示可见状态提示；error 时 MUST 提供重试入口或手动放置指引入口。

#### Scenario: 加载中提示
- **WHEN** Embedding 模型状态为 loading
- **THEN** 聊天窗显示加载中横幅或等价提示

### Requirement: 助手消息 Markdown 渲染
聊天窗口 SHALL 将助手（assistant）消息内容渲染为安全的 Markdown，支持标题、无序/有序列表、引用、行内代码、围栏代码块、表格、链接与粗斜体。用户（user）消息 MUST 保持纯文本渲染。渲染 MUST 不将未识别 HTML 透传进 DOM（LLM 输出视为不可信输入），且 MUST 不引入 `dangerouslySetInnerHTML` 或 raw-HTML 透传插件。

#### Scenario: 渲染结构化 Markdown
- **WHEN** 助手消息内容包含标题、列表、代码块、表格与行内代码
- **THEN** 气泡内按 Markdown 语义渲染这些元素，而非原样显示 Markdown 符号

#### Scenario: 用户消息保持纯文本
- **WHEN** 用户消息内容包含 Markdown 标记字符
- **THEN** 该消息仍按纯文本显示，不做 Markdown 渲染

#### Scenario: 原始 HTML 不进入 DOM
- **WHEN** 助手消息内容包含 HTML 标签或脚本
- **THEN** 渲染结果将其作为纯文本转义显示，不产生可执行节点

### Requirement: 流式期间保持纯文本
助手消息在流式生成期间 MUST 以逐字纯文本追加显示（不做 Markdown 解析），仅在消息完成、取消或错误（内容已定格）后渲染为 Markdown。

#### Scenario: 生成中逐字显示
- **WHEN** 助手消息处于 streaming 状态且正在追加 token
- **THEN** 气泡以纯文本逐字显示已生成内容，不执行 Markdown 解析

#### Scenario: 完成后渲染 Markdown
- **WHEN** 助手消息状态变为 complete
- **THEN** 气泡以 Markdown 渲染完整内容

### Requirement: 渲染失败回退
当 Markdown 渲染抛错或无法解析时，系统 SHALL 回退为纯文本显示助手内容，MUST NOT 显示空白或中断消息列表。

#### Scenario: 畸形内容回退
- **WHEN** 助手消息内容为畸形 Markdown 且渲染抛错
- **THEN** 气泡以纯文本显示该内容，消息列表正常

### Requirement: 暖色陪伴风主题
聊天窗口 SHALL 采用与桌宠本体一致的暖色视觉语言：会话区暖米白底、面板（头部/输入区/侧栏）半透明磨砂、大圆角与柔和阴影。配色 MUST 通过 CSS 变量（`--ink/--panel/--accent/--soft/--line`）表达，与桌宠 `src/styles.css` 对齐。

#### Scenario: 主题变量生效
- **WHEN** 用户打开聊天窗口
- **THEN** 会话区呈现暖米白背景，侧栏/头部/输入区为暖色系面板，气泡与控件使用统一 accent 色

#### Scenario: 变量驱动配色
- **WHEN** 修改 `:root` 中的 CSS 变量
- **THEN** 整个聊天窗配色随之变化，无需改动组件类

### Requirement: 助手消息展示当前模型头像
聊天窗口 SHALL 在助手消息旁展示当前活跃 Live2D 包的头像；当包提供 `modelUrl` 时以图片显示，缺失或加载失败时 SHALL 回退为包名首字符的圆形标识。

#### Scenario: 展示包头像
- **WHEN** 助手回复某条消息且当前活跃 Live2D 包存在
- **THEN** 消息旁显示该包头像（图片或回退圆形标识）

#### Scenario: 头像加载失败回退
- **WHEN** 包 `modelUrl` 缺失或图片加载失败
- **THEN** 头像以包名首字符的圆形底显示，不中断消息呈现

### Requirement: 流式回复光标
助手消息在流式生成期间 SHALL 在末尾显示闪烁光标，提示生成进行中。

#### Scenario: 流式期间显示光标
- **WHEN** 助手消息处于 streaming 状态且正在追加内容
- **THEN** 消息末尾出现闪烁光标

#### Scenario: 完成后光标消失
- **WHEN** 助手消息状态变为 complete
- **THEN** 光标消失，消息呈现最终内容

### Requirement: 本轮用量展示

聊天窗口 SHALL 展示当前会话最近一轮以及会话累计的 token 用量（输入、输出、缓存读与推理 token），并在用量为估算值时明确标注。用量 MUST 来自会话链路日志的投影，MUST NOT 由渲染进程自行估算或用例数据填充。

#### Scenario: 展示本轮用量
- **WHEN** 一轮回复完成
- **THEN** 聊天窗显示该轮 token 用量，含缓存命中的读取量

#### Scenario: 估算值标注
- **WHEN** provider 未返回用量信息
- **THEN** 展示的用量带有估算标注，用户可区分真实计量与估算

