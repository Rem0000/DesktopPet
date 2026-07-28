## Context

项目是 React 19 + TypeScript + Vite + Electron 37 的 Windows 桌宠。当前 `ChatPanel` 直接嵌入 360×420 的透明桌宠窗口，`claudeClient.ts` 在渲染进程读取 localStorage 中的 Claude Key 并直接请求远端 API；这既限制聊天体验，也扩大凭据暴露面。项目已经有创建第二个管理窗口、preload 白名单 IPC、主窗口 Live2D 情绪/说话状态等可复用模式，但没有 LLM 服务层、Agent 状态层或聊天数据存储。

“让 Live2D 按人物音色回答”实际包含 TTS 音色、音频播放和可选口型同步，不能仅由 Live2D 模型完成。本次先稳定文本聊天和扩展契约，不把 TTS 与 Agent/Live2D 加载器耦合。

## Goals / Non-Goals

**Goals:**

- 使用 DeepSeek 作为默认 LLM，凭据和远程请求留在 Electron 主进程。
- 使用 LangChain/LangGraph JS 建立可扩展的会话 Agent 图。
- 提供独立、可恢复、支持流式回复和停止生成的聊天窗口。
- 使聊天窗口、Agent、Provider、存储和桌宠表现通过小型类型化协议解耦。
- 为未来 TTS、角色音色、朗读和口型同步留下稳定的消息及 Provider 边界。

**Non-Goals:**

- 本期不实现 TTS、声音克隆、角色音色选择、自动朗读或音频驱动口型。
- 本期不开放文件、Shell、浏览器、桌面自动化等 Agent 工具。
- 不实现云端会话同步、多用户账户、图片/文件消息或语音输入。
- 不把 Live2D 动作自带音效重新解释为角色 TTS 音色。

## Decisions

### 1. 独立聊天 BrowserWindow 和独立渲染入口

新增单例 `chatWindow`，使用常规有边框窗口、任务栏入口和 `chat.html` 渲染入口。主窗口菜单和托盘只发送“打开/聚焦聊天”命令，不再通过扩大透明主窗口展示 `ChatPanel`。聊天窗口关闭仅销毁其渲染实例，应用和桌宠继续运行。

选择独立窗口是因为即时通信式消息列表、输入焦点、调整尺寸和任务栏行为与透明置顶桌宠窗口冲突。备选方案是保留侧边面板，但它会继续挤压桌宠画布并继承透明窗口、置顶和鼠标穿透限制。

### 2. 主进程聊天服务与受限 IPC

聊天能力分为 `ChatWindowManager`、`ChatService`、`AgentRuntime`、`DeepSeekProvider` 和 `ChatStore`。preload 只暴露领域命令：读取脱敏配置、保存配置、会话 CRUD、发送、取消，以及按 `requestId` 订阅流片段/完成/错误。IPC 主进程校验所有输入，事件只发送给发起请求的聊天窗口。

该方案避免渲染进程获得 Node 能力或完整 API Key。备选的渲染进程直接请求实现更少，但无法满足凭据隔离，也难以在窗口关闭后正确管理请求。

### 3. DeepSeek 通过 LangChain 的 OpenAI 兼容适配

使用 `@langchain/openai` 的 `ChatOpenAI`，默认 `baseURL` 为 DeepSeek 官方兼容地址、默认模型为 `deepseek-chat`，并启用 streaming。模型名和 base URL 可配置以便测试及未来兼容服务，但仅接受 HTTP(S) URL。

选择现成适配器可直接接入 LangGraph 消息和流式协议。直接维护 fetch 客户端依赖更少，但会重复实现消息转换、取消和流事件适配。配置错误按统一错误类别返回，不再使用看似成功的本地规则回复掩盖故障。

### 4. LangGraph 会话图先建立最小可靠骨架

图状态至少包含消息集合和会话标识，首期图由输入归一化、模型调用和输出提交节点构成。图使用显式工具注册表，但默认注册表为空；未来工具节点必须包含 schema 校验、权限说明和结构化结果。系统提示集中管理，Provider 只负责模型通信，不持有角色逻辑。

LangGraph 在首期看起来比单次模型调用更重，但它为会话状态、后续工具节点和中断/恢复提供稳定位置。首期不虚构“Agent 工具能力”，验收范围是可扩展 Agent 运行时而不是桌面自动化。

### 5. 应用存储作为会话事实来源

在 `app.getPath('userData')` 下维护版本化聊天数据，采用临时文件加原子替换写入，存储会话元数据、消息内容、生成状态和时间戳。LangGraph 每次运行从 `ChatStore` 组装该会话上下文，结束后再提交结果，避免内存 checkpointer 与界面历史形成双重事实来源。

API Key 使用 Electron `safeStorage` 加密后落盘；若当前系统无法加密，系统不得静默明文保存，用户可选择仅在本次进程内使用。聊天配置返回给渲染进程时只包含 `hasApiKey`。

相比首期引入 SQLite，版本化 JSON 更符合当前数据规模和依赖复杂度；存储接口保持可替换，以便后续会话量或检索需求增长时迁移。

### 6. 流式请求采用 requestId 和 AbortController

每次发送分配唯一 `requestId`，主进程维护活动请求表。流事件包含 `requestId`、`sessionId` 和顺序增量，取消只影响对应请求。一个会话同一时间最多有一个活动生成；其他会话可独立运行。聊天窗口销毁时取消由该窗口发起的活动请求。

消息状态区分 `streaming`、`complete`、`cancelled` 和 `error`，部分文本可以保留但不会伪装成完整回复。历史上下文只纳入明确可用的消息，并在调用前按配置预算裁剪早期轮次。

### 7. 桌宠联动走主进程事件，不共享 React 状态

`ChatService` 将请求生命周期映射为 `thinking`、`speaking`、`idle` 事件并发送给桌宠主窗口。桌宠主窗口缺失或重载不影响聊天提交；任意完成、取消和错误路径都必须发送 `idle`。

未来 TTS 以 `TtsProvider.synthesize(messageId, text, voiceId)` 形式接在完整文本回复之后，聊天消息只暴露“可朗读/正在朗读”状态。Live2D 口型同步属于音频播放表现层，不能反向侵入 Agent 图。

## Risks / Trade-offs

- [LangChain/LangGraph Electron 打包可能受 ESM/CJS 互操作影响] → 在主进程构建中增加最小集成测试并确认 Vite 外部化策略。
- [DeepSeek/OpenAI 兼容流事件随依赖升级变化] → Provider 内统一转换为内部事件，不让 IPC 和 UI 依赖第三方事件结构。
- [JSON 会话文件损坏或并发写入] → 串行写队列、临时文件原子替换、schema 版本和损坏备份恢复。
- [safeStorage 在部分 Windows 环境不可用] → 禁止明文持久化并提供仅会话内凭据及明确提示。
- [长会话增加成本和延迟] → 设置上下文预算、裁剪历史，并在后续版本评估摘要节点。
- [空工具注册表让首期 Agent 能力有限] → 明确首期交付的是对话图和工具边界，具体高权限工具单独提案和授权。
- [多个窗口事件乱序或目标窗口已销毁] → 所有事件携带 requestId/sessionId，发送前检查窗口状态，清理监听器和活动请求。

## Migration Plan

1. 增加依赖、聊天领域类型、主进程存储、Provider 和 Agent 运行时，并以单元测试覆盖错误归类与状态提交。
2. 增加聊天 IPC/preload API 和独立 `chat.html` 入口，再创建单例聊天窗口。
3. 将现有菜单“聊天”改为打开/聚焦新窗口，迁移聊天 UI 后删除 `claudeClient.ts` 与主窗口内嵌 `ChatPanel`。
4. 保留现有 Live2D 导入、动作声音和主窗口行为；增加 Agent 生命周期到桌宠状态的事件桥。
5. 首次启动不迁移旧 Claude Key，因为它属于不同 Provider；若检测到旧 localStorage Key，仅清除或忽略，不发送到主进程。

回滚时可恢复原有内嵌面板入口；新增聊天数据位于独立版本化文件，不影响 Live2D 会话和模型库。

## Open Questions

- 角色系统提示首期使用固定内置文案，还是同时提供可编辑“角色设定”？本设计默认固定内置文案，避免把提示注入与配置体验混入首期。
- 聊天会话标题首期使用首条用户消息截断生成，还是额外调用 LLM？本设计默认本地截断，避免额外成本和延迟。
- API Key 设置入口放在聊天窗口内还是单独设置窗口？本设计默认聊天窗口内的设置面板，后续统一设置中心出现时再迁移。
