## Purpose

基于 LangChain/LangGraph 的桌宠对话 Agent 运行时：会话隔离、角色约束、上下文裁剪、长期记忆召回与可扩展工具边界。

## Requirements

### Requirement: LangGraph 对话运行时
系统 SHALL 使用 LangChain/LangGraph JS 在 Electron 主进程中执行桌宠对话图，并 SHALL 以会话标识隔离每个会话的消息状态。对话图 MUST 在模型调用前包含 recall 组装步骤，将当前模型人设（或默认提示）、跨模型共享的用户画像与事实记忆、以及会话摘要纳入上下文。

#### Scenario: 连续对话
- **WHEN** 用户在已有会话中发送后续问题
- **THEN** Agent 使用该会话历史生成具备上下文的回复，且不读取其他会话历史

#### Scenario: 新建会话
- **WHEN** 用户新建会话并发送首条消息
- **THEN** Agent 从新的独立状态开始执行，但仍可召回共享用户画像与事实记忆，并使用当前模型人设

#### Scenario: 召回后调用模型
- **WHEN** Agent 处理任意聊天请求
- **THEN** 进入模型节点前的上下文包含当前人设或默认角色提示，以及召回得到的长期记忆与（若有）会话摘要

#### Scenario: 对话自动写记忆
- **WHEN** Agent 处理聊天请求且已注册记忆工具
- **THEN** 运行时在 toolBoundary 前规划记忆工具调用；若模型发起白名单工具调用则先执行再生成回复

### Requirement: 桌宠角色约束
Agent SHALL 在每次模型调用中应用当前活跃 Live2D 包的人设系统提示；当人设缺失或为空时 SHALL 回退到默认桌宠系统提示，并 SHALL 默认以简洁、友善的中文回复（除非人设另有规定）。

#### Scenario: 生成普通回复
- **WHEN** 用户提出一般对话问题且当前包无人设
- **THEN** Agent 按默认桌宠角色和语言约束返回内容

#### Scenario: 使用包人设回复
- **WHEN** 当前活跃包存在非空人设
- **THEN** Agent 将该人设作为系统提示主体生成回复

### Requirement: 可扩展工具边界
Agent 运行时 SHALL 提供显式工具注册表和工具调用节点，但首期 MUST 默认不注册文件、Shell、网络浏览或其他具有系统副作用的工具。

#### Scenario: 当前版本运行
- **WHEN** Agent 处理普通聊天请求
- **THEN** 对话图无需系统工具即可完成回复，且不能执行未注册工具

#### Scenario: 后续增加工具
- **WHEN** 开发者注册一个经过输入校验和权限定义的工具
- **THEN** 图运行时可在不修改聊天窗口协议的情况下执行该工具并返回结构化结果

### Requirement: 记忆工具注册
Agent 运行时 SHALL 默认注册记忆白名单工具 update_profile、remember_fact、forget_memory，且 MUST NOT 注册 remember_preference，且 MUST NOT 默认注册文件、Shell、浏览器或其他系统副作用工具。当用户表达的是模型口吻或输出规范类个性化要求时，工具规划结果 SHALL 引导其写入人设而非写入 preference。

#### Scenario: 调用记忆工具
- **WHEN** 模型在对话中发起对已注册记忆工具的调用
- **THEN** 运行时执行该工具并将结构化结果返回图中继续推理或结束

#### Scenario: 拒绝 preference 工具
- **WHEN** 模型尝试调用 remember_preference 或未注册工具名
- **THEN** 运行时拒绝执行并返回可理解的错误结果

#### Scenario: 拒绝未注册工具
- **WHEN** 模型尝试调用未注册工具名
- **THEN** 运行时拒绝执行并返回工具不存在的错误结果

### Requirement: 状态持久化边界
Agent SHALL 从应用会话存储加载已提交消息，并 SHALL 仅在回复成功、用户取消或错误状态明确后提交一致的消息状态。

#### Scenario: 生成过程异常终止
- **WHEN** 流式回复在中途发生错误
- **THEN** 系统保留用户消息和已接收内容的明确状态，且下次运行不会把未标记的临时状态当作完整回复

### Requirement: 上下文容量控制
Agent SHALL 在调用模型前限制发送的历史上下文，并 SHALL 保留当前用户消息和角色指令。

#### Scenario: 历史消息超出预算
- **WHEN** 会话历史超过配置的上下文预算
- **THEN** 系统裁剪较早的消息并继续生成，不因无限增长的请求体导致失败

### Requirement: 提醒调度工具注册
Agent 运行时 SHALL 默认注册提醒白名单工具 schedule_reminder、cancel_reminder，与记忆工具一并可供 planToolCalls 选择。上述工具 MUST 仅操作本地提醒存储，MUST NOT 引入文件、Shell 或浏览器副作用。

#### Scenario: 规划到点提醒
- **WHEN** 用户在对话中明确要求稍后或某时刻提醒某事，且已注册提醒工具
- **THEN** 运行时可以在 toolBoundary 前将 schedule_reminder 纳入规划并执行

#### Scenario: 执行取消提醒工具
- **WHEN** 模型调用已注册的 cancel_reminder 且提供有效 pending 提醒 id
- **THEN** 运行时取消该提醒并返回结构化成功结果

#### Scenario: 拒绝未注册副作用工具
- **WHEN** 模型尝试调用未注册的文件或 Shell 类工具
- **THEN** 运行时拒绝执行并返回工具不存在或不可用的错误结果

### Requirement: 工具元数据注册
系统 SHALL 在 ToolRegistry 中为每个工具保存 name、description、input schema、enabled、riskLevel（如 `safe` / `confirm`）与 handler 引用。未 enabled 的工具 MUST NOT 出现在 planToolCalls 可选集合中，且 MUST NOT 被执行。

#### Scenario: 禁用工具不可调用
- **WHEN** 某已注册工具的 enabled 为 false
- **THEN** Agent 规划与执行阶段均不可调用该工具，并在尝试时返回可理解错误

#### Scenario: 新增工具无需改聊天协议
- **WHEN** 开发者按统一接口注册一个新的安全工具
- **THEN** 现有聊天 IPC 与窗口协议无需修改即可在后续对话中规划并执行该工具

### Requirement: 工具调用观测事件
Agent 运行时 SHALL 在每次工具调用开始与结束时发出结构化观测事件，至少包含 requestId、sessionId、toolName、startedAt、endedAt、ok、errorCode（若失败）与 latencyMs；入参 MUST 以脱敏摘要形式记录，MUST NOT 完整记录疑似密钥内容。

#### Scenario: 成功调用产生观测
- **WHEN** 白名单工具执行成功
- **THEN** 系统记录一条 ok=true 的观测事件，并包含耗时

#### Scenario: 失败调用产生观测
- **WHEN** 工具因校验失败或执行异常而失败
- **THEN** 系统记录 ok=false 与 errorCode，且不中断对观测通道本身的写入

### Requirement: 配置驱动工具开关
系统 SHALL 允许通过本地配置覆盖默认工具的 enabled 状态；配置缺失时 SHALL 使用代码默认值（记忆与提醒工具默认启用）。

#### Scenario: 配置关闭提醒工具
- **WHEN** 用户或开发者将 schedule_reminder 配置为 disabled
- **THEN** 后续对话不再规划或执行该工具，直至重新启用
