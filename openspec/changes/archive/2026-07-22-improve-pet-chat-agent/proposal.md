## Why

当前聊天仅是嵌入桌宠主窗口的 Claude 浏览器直连骨架，API Key 暴露在渲染进程且缺少流式响应、会话持久化和可扩展 Agent 运行时。需要先建立安全、可扩展的独立聊天体验，以 DeepSeek 完成稳定对话，并为后续工具调用、角色语音与 Live2D 联动保留清晰边界。

## What Changes

- 新增独立聊天窗口，采用类似即时通信应用的左右消息气泡、滚动消息列表、输入区、发送/停止、加载与错误状态。
- 将聊天请求迁移到 Electron 主进程，由主进程管理 DeepSeek 配置并通过受限 IPC 向渲染进程提供流式聊天能力。
- 以 DeepSeek 的 OpenAI 兼容接口作为首个默认 LLM，支持配置 API Key、模型和服务地址，并提供明确的配置缺失及请求失败提示。
- 引入 LangChain/LangGraph JS 构建桌宠 Agent 运行时；首期实现有上下文的对话图、角色系统提示、会话状态和可扩展工具注册边界，不开放具有系统副作用的工具。
- 持久化聊天会话和消息，支持新建会话、切换会话、继续历史对话以及清空/删除会话。
- 将 Agent 输出状态同步给桌宠主窗口，用于思考、回复和空闲状态反馈，同时保持聊天窗口与桌宠窗口生命周期解耦。
- 定义可选语音输出扩展接口和消息级朗读入口的产品边界，但本期不接入 TTS、不克隆或生成角色音色，也不实现音频驱动口型。
- 移除聊天流程对 Claude 浏览器直连和静默本地兜底回复的依赖；网络或鉴权失败必须作为可重试错误呈现。

## Capabilities

### New Capabilities
- `pet-chat-window`: 独立聊天窗口、即时通信式交互、会话与消息管理。
- `deepseek-chat-provider`: 主进程中的 DeepSeek 配置、安全调用、流式输出和错误处理。
- `pet-agent-runtime`: 基于 LangChain/LangGraph 的桌宠对话 Agent、状态管理及可扩展工具边界。
- `pet-response-presentation`: Agent 回复与桌宠状态联动，以及面向未来 TTS/角色音色的可选朗读扩展契约。

### Modified Capabilities

无。

## Impact

- Electron 主进程将新增聊天窗口管理、聊天 IPC、Agent 运行时、DeepSeek Provider 和本地会话存储。
- preload API 将新增严格类型化的聊天命令、流式事件、取消请求、配置和会话管理接口。
- React 渲染层将从主窗口内嵌 `ChatPanel` 调整为独立聊天入口与聊天窗口页面。
- 新增 LangChain/LangGraph 及 DeepSeek/OpenAI 兼容客户端相关依赖；敏感配置不得通过渲染进程日志、消息或持久化会话暴露。
- 现有 Live2D 模型加载与动作声音不改变；角色音色属于未来 TTS Provider 能力，不应与 Live2D 模型资源格式耦合。
