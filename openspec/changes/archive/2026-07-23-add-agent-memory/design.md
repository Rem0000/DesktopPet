## Context

桌宠已具备独立聊天窗口、DeepSeek Provider 与 LangGraph 最小对话图，但「记忆」仍等同于会话内近期消息：`trimContext` 按约 24k 字符裁掉早期轮次后即不可恢复地离开模型视野，且跨会话无法共享用户画像。用户已确认：所有会话公用一套用户画像；一期按「记忆工具写入 + 用户可编辑 + 会话摘要」落地；TTS 继续搁置。

本设计在不引入向量库与云同步的前提下，为 Agent 增加可控、可审计的长期记忆，并为后续自动提炼与情景检索留扩展点。

## Goals / Non-Goals

**Goals:**

- 跨会话共享一套用户画像（profile / preference）与长期事实（fact / commitment）。
- 会话内超预算时用摘要压缩早期轮次，保留近期原文。
- Agent 可通过白名单工具写入/更新/遗忘记忆；用户可在聊天窗口查看、编辑、清空。
- 每次对话在回复前由模型规划记忆工具调用（对话自动写记忆），再流式生成回复。
- 每次模型调用组装：角色提示 + 长期记忆 + 会话摘要 + 近期对话。
- 记忆写入带安全校验与来源追溯。

**Non-Goals:**

- 不做向量数据库 / embedding RAG（二期可选）。
- 不做云同步、多用户账号、多设备合并。
- 不按 Live2D 角色拆分用户画像（画像共享；角色人设另论）。
- 一期不做「每回合强制全文自动提炼」二次抽取（写入仍由工具决策；闲聊默认不写）。
- 不实现 TTS / 口型 / 语音输入（本地 CosyVoice 因 4060 8GB 显存紧张已明确搁置；记忆与语音解耦）。

## Decisions

### 1. 三层记忆，而非「把聊天日志当记忆」

```
L0 工作记忆  每次请求组装进模型的上下文（受预算约束）
L1 会话记忆  ChatStore 消息全文 + SessionSummary（早期轮次压缩）
L2 长期记忆  跨会话共享：profile / preference / fact / commitment / episode
```

对话原文仍只存在 ChatStore；MemoryStore 只存结构化记忆与摘要。避免「全文复制一份当记忆」导致重复与不可控膨胀。

备选：仅加长上下文窗口——无法跨会话，也不解决预算与噪声问题。

### 2. 所有会话共享一套用户画像

`profile` / `preference` 全局唯一命名空间，不按 sessionId、不按 Live2D 角色拆分。换模型不丢失「用户是谁」。

角色人格（桌宠人设）继续放在系统提示；若未来多角色，仅允许覆盖「角色对用户的称呼」等少数字段，用户画像仍共享。

备选：每角色独立记忆——易造成同一用户多套矛盾偏好，首期否决。

### 3. 存储：独立 memory-data.json，接口可替换

在 `userData` 下新增 `memory-data.json`（或与 chat-data 分文件同目录），schema 版本化，串行写 + 临时文件原子替换，与 ChatStore 一致。

不把长期记忆塞进 `chat-data.json` 的 messages 里，避免会话删除误伤画像；删除会话默认不删 L2。

首期不做向量库：条目量小，用 type + importance + 关键词重叠 + 时间衰减即可。预留 `MemoryRetriever` 接口，二期可换 embedding。

备选 SQLite：检索与增量更新更强，但当前体量不足以抵消 Electron 依赖与迁移成本；接口层保持可迁移。

### 4. 数据模型

```
MemoryItem:
  id, type(profile|preference|fact|commitment|episode),
  key?, content, importance(1|2|3),
  sourceSessionId?, sourceMessageIds?,
  createdAt, updatedAt, expiresAt?

SessionSummary:
  sessionId, summary, coveredUntilMessageId, updatedAt
```

写入规则：
- profile/preference：按 `key` 覆盖（如 `user.nickname`、`reply.length`）
- fact/commitment/episode：追加；commitment 可带 `expiresAt`
- 禁止写入 API Key、密码、令牌；疑似机密拒绝并返回原因
- 每条带来源，便于审计与「为何记得」

### 5. 写入权威：工具为主，用户可改，摘要为辅

一期：
- **对话自动写记忆**：每次请求在 `plan` 节点调用 Provider.`planToolCalls`（绑定白名单工具），模型按需发起 `remember_*` / `update_profile` / `forget_memory`；`toolBoundary` 执行后进入流式回复。规划失败不阻断聊天。
- **Agent 白名单工具**：`update_profile`、`remember_preference`、`remember_fact`、`forget_memory`
- **用户可编辑**：聊天窗记忆面板查看/改/删/清空
- **会话摘要**：超预算时压缩早期轮次（L1），不是把摘要当全局画像

二期再考虑回合后全量自动提炼（额外独立抽取调用）。

工具经现有 `ToolRegistry` 注册，在 `toolBoundary` 真正执行；写入统一走 `MemoryService` 校验。

### 6. 召回与上下文组装

每次 `model` 前组装：

```
[系统角色提示]
[长期记忆 L2]
  - profile / preference（高 importance 优先，通常全量）
  - 相关 fact / commitment / episode（Top-K）
[会话摘要 L1]（若有）
[近期对话原文]
```

预算分配（相对现有上下文预算）：角色提示固定；L2 约 10–20%；摘要约 10–15%；其余给近期原文。

召回（无向量一期）：
1. 注入高 importance 的 profile/preference  
2. 其余用关键词重叠 + importance + 时间衰减选 Top-K  
3. 过期 commitment 不注入  
4. 删除会话不删除 L2；清空 L2 需用户明确确认  

### 7. Agent 图演进

```
START → normalize → recall → plan → toolBoundary → model → commit → END
                       │       │         │
                       │       │         └─ 执行 remember_* / forget
                       │       └─ planToolCalls（对话自动写记忆）
                       └─ MemoryService.recall()
```

一期工具白名单：`update_profile`、`remember_preference`、`remember_fact`、`forget_memory`。  
仍默认不开放文件/Shell/浏览器工具。

### 8. 存储

- `chat-data.json`：会话与消息（现有）  
- `memory-data.json`：L2 条目 + 会话摘要  
- 删除会话默认不删 L2；「清空记忆」只清 L2  
- 首期不做向量库；预留 `MemoryRetriever` 接口  

备选 SQLite：检索更强，但一期体量不够；接口与 JSON 对齐便于迁移。

## Risks / Trade-offs

- [模型乱记或不记] → 工具白名单 + 用户可编辑面板 + 来源字段；二期再加自动提炼  
- [摘要丢失细节] → 只压缩早期轮次，近期原文保留；摘要可重建  
- [记忆与消息双源不一致] → ChatStore 管原文，MemoryStore 管结构化；召回只读 MemoryStore + Summary  
- [JSON 膨胀] → 条目上限、importance、过期；episode 严格 Top-K  
- [隐私] → 禁止记密钥；提供清空；数据仅本地 userData  

## Migration Plan

1. 新增 `memory-data.json` 与 MemoryService，不改动既有 messages 语义  
2. Agent 图插入 `recall`，注册记忆工具  
3. 聊天窗增加记忆面板  
4. 旧会话无摘要时按需生成；无 L2 时行为与现网一致  
5. 回滚：关闭 recall 注入与记忆工具即可回退到纯 trimContext

## Open Questions

- 记忆面板放在聊天侧栏还是独立设置页？（默认：聊天侧栏入口）  
- 摘要用 DeepSeek 小调用还是本地模板拼接？（默认：超预算时用一次 LLM 摘要，失败则降级为截断要点列表）  
- 用户是否需要「导出记忆」？（默认一期不做，二期可选）
