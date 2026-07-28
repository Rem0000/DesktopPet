## Why

当前桌宠 Agent 仅依赖会话内近期消息与字符预算裁剪，无法跨会话记住用户画像、偏好与约定，导致每次新对话都像「第一次见面」。在已有 LangGraph 对话骨架之上补齐可控、可审计、可编辑的记忆能力，是完善 Agent 体验的关键一步，也便于后续扩展工具调用与个性化互动。

## What Changes

- 新增跨会话共享的用户画像与长期记忆存储（所有会话公用一套用户画像）。
- 新增会话摘要机制：历史超预算时压缩早期轮次，保留近期原文进入模型上下文。
- 为 Agent 增加记忆相关工具（`remember` / `update_profile` / `forget`）；一期在每次回复前由 `planToolCalls` 自动规划写入（对话自动写记忆），而非仅手动注入。
- 提供记忆查看、编辑、清空的用户可控界面，保证记忆可审计、可纠正。
- 调整 Agent 上下文组装：每次调用注入角色提示 + 长期记忆 + 会话摘要 + 近期对话。
- 修复聊天窗口长对话布局：消息/会话列表内部滚动，标题与输入区固定可见。
- 明确记忆安全边界：禁止写入密钥等敏感信息；过期约定不进入上下文。
- TTS / 角色音色朗读继续搁置，不在本变更实现。

## Capabilities

### New Capabilities
- `agent-memory`: 跨会话用户画像、长期记忆条目、会话摘要、召回注入与记忆工具/编辑能力。

### Modified Capabilities
- `pet-agent-runtime`: Agent 图增加 recall 与记忆工具边界；上下文组装纳入长期记忆与会话摘要。
- `pet-chat-window`: 聊天窗口增加记忆查看/编辑入口，并在对话中反映记忆相关工具结果的可见性（如需要）。

## Impact

- Electron 主进程新增 MemoryStore 与 MemoryService（召回、写入校验、摘要触发）。
- LangGraph 图增加 recall 节点，并注册记忆类白名单工具。
- ChatStore / IPC / preload 扩展记忆相关读写接口；聊天 UI 增加记忆面板。
- 依赖仍以现有 LangChain/LangGraph + DeepSeek 为主；首期不做向量库，召回采用类型过滤 + 关键词/重要性排序。
- 不改变 Live2D 导入与动作声音逻辑；不实现 TTS。
