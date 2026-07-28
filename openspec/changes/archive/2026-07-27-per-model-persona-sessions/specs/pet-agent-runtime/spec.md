## MODIFIED Requirements

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
