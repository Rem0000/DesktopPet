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

#### Scenario: 首见状态注入
- **WHEN** 当前包存在每日首见类人设需求
- **THEN** 系统提示在角色约束之上叠加每日首见状态引导，人设与状态共同约束回复行为

### Requirement: 每日首次见面状态
系统 SHALL 按 Live2D 包记录"当日是否已首次对话"，并在每次对话组装系统提示时注入对应状态：当日首次对话注入"今天第一次见面，按人设完成首见行为"；同日后续对话注入"今天已见过面，除非主人主动询问否则不要重复首见行为"。状态 SHALL 跨会话、跨应用重启持久化，且按包隔离（不同包各自计数）。

#### Scenario: 当日首次对话
- **WHEN** 某包在当天第一次收到用户消息
- **THEN** 系统提示注入首见引导，提示模型按人设完成首见行为

#### Scenario: 同日后续对话
- **WHEN** 同一包在同一天再次收到用户消息
- **THEN** 系统提示注入"已见过面，除非被问否则不重复"，模型不再重复首见行为

#### Scenario: 跨日重置
- **WHEN** 跨过零点后该包再次对话
- **THEN** 系统按新的首次见面处理（首见状态翻转）

### Requirement: 当前日期注入
系统 SHALL 在组装系统提示时注入当前本地日期（如"今天是 2026 年 8 月 5 日（星期三）"），使模型能准确回答日期/星期相关询问，MUST NOT 依赖模型训练数据中的默认日期。

#### Scenario: 询问今天日期
- **WHEN** 用户询问今天是几号/星期几
- **THEN** 系统提示包含准确当前日期，模型据此回答而非编造

### Requirement: 可扩展工具边界
Agent 运行时 SHALL 提供显式工具注册表和工具调用节点，但首期 MUST 默认不注册文件、Shell、网络浏览或其他具有系统副作用的工具。

#### Scenario: 当前版本运行
- **WHEN** Agent 处理普通聊天请求
- **THEN** 对话图无需系统工具即可完成回复，且不能执行未注册工具

#### Scenario: 后续增加工具
- **WHEN** 开发者注册一个经过输入校验和权限定义的工具
- **THEN** 图运行时可在不修改聊天窗口协议的情况下执行该工具并返回结构化结果

#### Scenario: 联网工具纳入白名单
- **WHEN** 开发者注册 web_search / web_fetch 白名单工具
- **THEN** 联网读取作为只读、可观测、经规划与（抓取）确认的白名单能力加入，仍不注册文件/Shell 副作用工具

### Requirement: 联网搜索工具 web_search
Agent 运行时 SHALL 注册白名单工具 `web_search`（riskLevel=`safe`、默认 enabled、可经 `tool-config.json` 关闭），调用 Tavily `/search` 返回结构化搜索结果。工具输入 SHALL 包含 query、可选 max_results（1–8，默认 5）与 search_depth（basic/advanced）。输出 SHALL 包含命中结果（title/url/content/score/published_date）与可选 AI answer；无命中 MUST 如实返回空并禁止编造。Tavily API Key SHALL 来自环境变量 `TAVILY_API_KEY` 或配置文件，MUST NOT round-trip 到渲染进程。

#### Scenario: 搜索实时信息
- **WHEN** 用户询问实时/外部/最新信息且模型调用 web_search
- **THEN** 工具调用 Tavily /search 并返回结构化命中结果与可选 AI 摘要

#### Scenario: 无命中不编造
- **WHEN** 搜索返回空结果
- **THEN** 工具返回 empty=true，回复 MUST 如实说明未搜到，禁止虚构结果

#### Scenario: 未配置 Key 不启用
- **WHEN** Tavily API Key 缺失
- **THEN** web_search 不进入规划集合，不可被调用

### Requirement: 网页抓取工具 web_fetch
Agent 运行时 SHALL 注册白名单工具 `web_fetch`（riskLevel=`confirm`、默认 enabled），调用 Tavily `/extract` 抓取单个 URL 正文为 Markdown。URL SHALL 仅允许 http/https，MUST 拒绝私有 IP 段、localhost 与超长 URL（SSRF 防护）。正文 SHALL 按字符预算截断后返回；失败 SHALL 返回可理解错误且不编造。

#### Scenario: 抓取指定网页
- **WHEN** 模型调用 web_fetch 且用户确认，URL 为合法 http/https
- **THEN** 工具调用 Tavily /extract 返回该 URL 的正文内容

#### Scenario: 拒绝危险 URL
- **WHEN** web_fetch 收到 localhost 或私有 IP 地址
- **THEN** 工具拒绝执行并返回 SSRF 防护错误

#### Scenario: 抓取需用户确认
- **WHEN** 模型规划调用 web_fetch
- **THEN** 执行前经 confirm 闸门，用户拒绝则工具不执行

### Requirement: 联网结果硬约束
Agent 生成回复引用联网结果时，MUST 逐字引用工具返回的 hits 内容，MUST NOT 补充或虚构；搜索无命中或抓取失败时 MUST 如实说明，MUST NOT 声称已找到不存在的网页内容。

#### Scenario: 引用逐字来自结果
- **WHEN** 模型基于 web_search 命中生成回复
- **THEN** 回复引用 MUST 逐字取自 hits，不补充来源中没有的细节

#### Scenario: 抓取失败如实说明
- **WHEN** web_fetch 抓取失败
- **THEN** 回复如实说明抓取失败，不编造网页内容

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
Agent SHALL 在调用模型前限制发送的历史上下文，并 SHALL 保留当前用户消息和角色指令。当会话历史超过配置预算时，裁剪 SHALL 在保留最近消息窗口的前提下，按消息级重要性优先保留窗口外高重要性消息，并保持输出消息的原始时序。每个消息 SHALL 携带可选的写入期重要性（1–3，默认 2），重要性的来源为写入时的启发式打分。

#### Scenario: 历史消息超出预算
- **WHEN** 会话历史超过配置的上下文预算
- **THEN** 系统裁剪较早的消息并继续生成，不因无限增长的请求体导致失败

#### Scenario: 高重要性早期消息优先保留
- **WHEN** 会话超预算且近期窗口外存在高重要性消息
- **THEN** 系统在预算内优先保留这些高重要性消息，再考虑低重要性消息，且输出保持原始时序

#### Scenario: 最近消息逐字保留
- **WHEN** 会话超预算
- **THEN** 系统优先逐字保留最近的近期窗口消息，避免破坏上下文连续性

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

### Requirement: 工具规划失败可观测
当 `planToolCalls` 抛错或返回无效结果时，系统 MUST NOT 静默吞掉失败：MUST 记录观测或向聊天窗发出可理解提示，且 MUST 继续生成不依赖工具的正常回复。

#### Scenario: 规划失败仍可回复
- **WHEN** planToolCalls 抛出异常
- **THEN** 系统不调用任何工具，仍流式返回助手回复，并产生规划失败的可观测信号

### Requirement: 规划提示覆盖知识库检索
工具规划指令 SHALL 引导模型在用户询问本地文档、项目说明或已导入资料细节时优先考虑 `search_knowledge`（若该工具已启用），同时保留记忆与提醒类工具的既有规划规则。

#### Scenario: 文档问题规划检索
- **WHEN** 用户询问知识库中文档细节且 search_knowledge 已启用
- **THEN** planToolCalls 的可选工具集合与规划提示包含该工具，且规划结果可选择调用它

### Requirement: 有限多轮工具环
Agent 运行时 SHALL 支持在单次用户请求内执行有限多轮「规划/工具 → 再规划/再工具 → 最终回复」，并 MUST 设置最大轮数与总工具调用次数上限；超出上限后 MUST 停止继续调用工具并生成基于已有结果的回复。

#### Scenario: 先检索再写记忆
- **WHEN** 用户请求需要先查知识库再写入长期记忆，且未超过多轮上限
- **THEN** 运行时可在首轮 search_knowledge 之后再次规划并执行记忆写入工具，再生成最终回复

#### Scenario: 超出轮数上限
- **WHEN** 工具环已达配置的最大轮数
- **THEN** 系统不再发起新的工具调用，并基于已有工具结果生成回复

### Requirement: 关系感知的系统提示词组装
Agent 每次模型调用 SHALL 在现有 persona（或默认系统提示）基础上并入关系层——关系块（按 policy 渲染）与已生效演化覆盖——作为角色约束的组成部分。关系层 MUST 由 `MemoryService.assemble` 在 recall 阶段统一注入，MUST NOT 引入新图节点、新工具或改变现有工具白名单边界。

#### Scenario: 带关系层回复
- **WHEN** 某包存在关系状态且用户发送消息
- **THEN** Agent 组装出的角色提示包含 persona 与关系层，回复反映该关系层的语气与私密度约束

#### Scenario: 人设缺失仍并入关系层
- **WHEN** 某包无 persona 但存在关系状态
- **THEN** 默认系统提示仍与关系层一并注入，Agent 行为由默认角色 + 关系约束共同决定

### Requirement: 规划提示覆盖历史会话检索
工具规划指令 SHALL 引导模型在用户引用更早对话（如"我之前说过…""上次你说…"）且当前上下文缺少该细节、`search_history` 已启用时，调用 `search_history` 检索当前模型包的历史会话；普通对话 MUST NOT 因默认流程调用该工具。`search_history` MUST 保持单发检索，MUST NOT 进入二次规划触发集。

#### Scenario: 引用早前对话时规划检索
- **WHEN** 用户引用更早对话中的内容且 search_history 已启用
- **THEN** 规划提示包含该工具，模型可选择调用它以找回逐字上下文

#### Scenario: 普通对话不触发
- **WHEN** 用户普通闲聊且未引用更早对话
- **THEN** 规划提示不诱导调用 search_history
