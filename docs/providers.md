# 多 Provider 扩展指南

> 目标：让本项目从"单一 DeepSeek"演进到"可插拔多 Provider"，同时保持 222+ 测试与主流程零破坏。
> 对应代码：`ChatProvider` 接口（`src/chat/contracts.ts`）→ `DeepSeekProvider implements ChatProvider`（`electron/chat/deepSeekProvider.ts`）→ `createProvider` 工厂（`electron/chat/providerFactory.ts`）。

## 现状

- 主链路由 `createProvider()` 返回 `DeepSeekProvider`（内部用 `@langchain/openai` 的 `ChatOpenAI`）。
- `AgentRuntime` 消费的是 `AgentProvider = Pick<ChatProvider, 'stream' | 'planToolCalls'>`（`electron/chat/agentRuntime.ts`）。
- 另有**两处尚未统一**的裸 ChatOpenAI 构造（后续统一点）：
  - `electron/novel/novelRuntime.ts` 的 `DeepSeekNovelLlm`（小说工坊独立 LLM，接口 `streamText/completeText`，与 chat 侧签名不同）
  - `electron/reminders/reminderRewrite.ts` 的裸 `new ChatOpenAI`（提醒改写）

## 新增一个 Provider 的步骤

### 1. 在 `createProvider` 加分支

```ts
// electron/chat/providerFactory.ts
switch (kind) {
  case 'deepseek':
    return new DeepSeekProvider()
  case 'ollama':
    return new OllamaProvider()        // 新增实现
  default:
    return new DeepSeekProvider()      // 未知 kind 回退，防配置漂移
}
```

### 2. 实现 `ChatProvider` 接口

五个方法：`stream`（流式，`onToken` 回调逐 token）、`planToolCalls?`（工具规划，可选）、`summarize`（会话摘要）、`completeText`（单轮补全）、`kind`（标识）。

```ts
export class OllamaProvider implements ChatProvider {
  readonly kind = 'ollama'
  async stream(messages, config, signal, onToken, systemPrompt?) { /* … */ }
  async planToolCalls?(…) { /* … */ }
  async summarize(…) { /* … */ }
  async completeText(…) { /* … */ }
}
```

### 3. 按协议选适配

| Provider | 适配方式 | 注意点 |
|---|---|---|
| **OpenAI 兼容**（DeepSeek / Ollama / OpenRouter / 国内中转） | `ChatOpenAI` 只改 `configuration.baseURL` 与 `apiKey` | 零代码改动，本质是配置模板 |
| **Anthropic** | 换 `@langchain/anthropic` 的 `ChatAnthropic` | `max_tokens` 为必填需给默认（如 4096）；`bindTools` 的 `tool_choice` 形态略不同（`{ type: 'auto' }`） |
| **本地无 Key**（Ollama） | `apiKey` 可空 | 需放宽"无 Key 即拒绝"的判断（见 §4） |

LangChain 已把 OpenAI 的 SSE 与 Anthropic 的 SSE 统一翻译成 chunk（`textFromContent` 兼容 string/array 两种 content 形态），所以 `onToken` 回调签名保持不变成本最低。

### 4. 放宽"无 Key 即拒绝"

现在 `chatService.ts` 与 `novelService.ts` 在 `apiKey` 为空时直接拒绝。本地 Provider（Ollama）无 Key，需按 `providerKind` 放行：

```ts
// electron/chat/chatService.ts 类似判断处
const kind = config.providerKind ?? 'deepseek'
if (!config.apiKey && kind !== 'ollama') throw new Error('请先配置 API Key')
```

### 5. 错误文案按 kind 参数化

`normalizeProviderError(error, kind)` 已支持第二个参数（默认 `'DeepSeek'`），新 Provider 传入自己的 kind 即可得到「`<kind> API Key 无效`」「无法连接 `<kind>` 服务」等文案。

### 6. 工具规划

`planToolCalls` 是可选方法。若实现不支持工具，返回 `{ toolCalls: [] }` 即可——`AgentRuntime` 已有 `if (!provider.planToolCalls || …) return []` 防御，不会阻塞对话。

### 7. 按场景路由：规划与生成分离

同一 Provider 内可让**不同任务**用不同模型。当前支持**规划（`planToolCalls`）**与**生成（`stream`）**两任务分离：

- `ProviderRuntimeConfig.plannerModel?: string`：规划任务专用模型；**留空则规划复用 `model`**。
- 生成、摘要、结构化补全（`stream` / `summarize` / `completeText`）统一用主 `model`——后台任务不设专用模型，避免配置膨胀。
- 持久化：`StoredProviderConfig.plannerModel` 可选字段，缺失向后兼容；配置面板（聊天窗设置）新增「规划模型（可选）」输入。
- 典型用法：`model = deepseek-chat`（生成）+ `plannerModel = deepseek-reasoner`（工具规划走推理模型，指令遵循更稳）。

> 这是**任务级路由**（同一 Provider 内选模型）。若要**多 Provider 运行时切换**（如换 Ollama/OpenRouter），需把 `providerKind` 持久化并让 `createProvider` 真正按 kind 分发——两者正交，可叠加。

## 面试叙事

「我把 LLM 调用收敛到一个 `ChatProvider` 接口 + 一个 `createProvider` 工厂：`switch(kind)` 就是扩展点，`DeepSeekProvider implements ChatProvider` 但保留 `AgentProvider` 别名为兼容层，所以既有测试零破坏。OpenAI 兼容的加个 baseURL 配置即可，Anthropic 换 `ChatAnthropic` 且注意 `max_tokens` 必填——从接口抽象到可演进的落地，而不是只留一个空接口。」
