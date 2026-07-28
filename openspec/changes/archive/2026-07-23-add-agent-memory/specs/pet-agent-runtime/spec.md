## MODIFIED Requirements

### Requirement: LangGraph 对话运行时
系统 SHALL 使用 LangChain/LangGraph JS 在 Electron 主进程中执行桌宠对话图，并 SHALL 以会话标识隔离每个会话的消息状态。对话图 MUST 在模型调用前包含 recall 组装步骤，将跨会话长期记忆与会话摘要纳入上下文。

#### Scenario: 连续对话
- **WHEN** 用户在已有会话中发送后续问题
- **THEN** Agent 使用该会话历史生成具备上下文的回复，且不读取其他会话历史

#### Scenario: 新建会话
- **WHEN** 用户新建会话并发送首条消息
- **THEN** Agent 从新的独立状态开始执行，但仍可召回共享用户画像与长期记忆

#### Scenario: 召回后调用模型
- **WHEN** Agent 处理任意聊天请求
- **THEN** 进入模型节点前的上下文包含角色提示，以及召回得到的长期记忆与（若有）会话摘要

#### Scenario: 对话自动写记忆
- **WHEN** Agent 处理聊天请求且已注册记忆工具
- **THEN** 运行时在 toolBoundary 前规划记忆工具调用；若模型发起白名单工具调用则先执行再生成回复

## ADDED Requirements

### Requirement: 记忆工具注册
Agent 运行时 SHALL 默认注册记忆白名单工具 remember_preference、update_profile、remember_fact、forget_memory，且 MUST NOT 默认注册文件、Shell、浏览器或其他系统副作用工具。

#### Scenario: 调用记忆工具
- **WHEN** 模型在对话中发起对已注册记忆工具的调用
- **THEN** 运行时执行该工具并将结构化结果返回图中继续推理或结束

#### Scenario: 拒绝未注册工具
- **WHEN** 模型尝试调用未注册工具名
- **THEN** 运行时拒绝执行并返回工具不存在的错误结果
