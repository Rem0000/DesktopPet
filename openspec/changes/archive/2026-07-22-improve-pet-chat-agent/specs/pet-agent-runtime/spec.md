## ADDED Requirements

### Requirement: LangGraph 对话运行时
系统 SHALL 使用 LangChain/LangGraph JS 在 Electron 主进程中执行桌宠对话图，并 SHALL 以会话标识隔离每个会话的消息状态。

#### Scenario: 连续对话
- **WHEN** 用户在已有会话中发送后续问题
- **THEN** Agent 使用该会话历史生成具备上下文的回复，且不读取其他会话历史

#### Scenario: 新建会话
- **WHEN** 用户新建会话并发送首条消息
- **THEN** Agent 从新的独立状态开始执行

### Requirement: 桌宠角色约束
Agent SHALL 在每次模型调用中应用集中管理的桌宠角色系统提示，并 SHALL 默认以简洁、友善的中文回复。

#### Scenario: 生成普通回复
- **WHEN** 用户提出一般对话问题
- **THEN** Agent 按桌宠角色和语言约束返回内容

### Requirement: 可扩展工具边界
Agent 运行时 SHALL 提供显式工具注册表和工具调用节点，但首期 MUST 默认不注册文件、Shell、网络浏览或其他具有系统副作用的工具。

#### Scenario: 当前版本运行
- **WHEN** Agent 处理普通聊天请求
- **THEN** 对话图无需系统工具即可完成回复，且不能执行未注册工具

#### Scenario: 后续增加工具
- **WHEN** 开发者注册一个经过输入校验和权限定义的工具
- **THEN** 图运行时可在不修改聊天窗口协议的情况下执行该工具并返回结构化结果

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
