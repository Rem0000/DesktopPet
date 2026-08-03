## ADDED Requirements

### Requirement: 对话关键事实自动 episode 沉淀
系统 SHALL 在每轮对话完成回复后，于主进程**非阻塞**地评估该会话「尚未沉淀」的完整消息，当满足触发闸门时调用 LLM 抽取其中值得长期保留的关键事实，并作为 `type=episode` 的长期记忆写入（含 `sourceSessionId` 与 `sourceMessageIds` 溯源）。抽取 MUST 由触发闸门（关键事实意图命中，或累计未沉淀用户消息数达到阈值）与频率间隔共同限制，MUST NOT 在每轮对话都无条件调用 LLM。抽取失败或返回非法形状 MUST 以可观测方式忽略、MUST NOT 阻断或延迟正常回复，也 MUST NOT 写入任何记忆。该功能 MUST 可经本地配置 `data/config/episode-config.json` 开关或调整参数。

#### Scenario: 关键事实触发抽取
- **WHEN** 用户在对话中表达了值得长期保留的关键事实（如决定、约定、身份信息），且距上次抽取已满足间隔
- **THEN** 系统非阻塞地抽取该关键事实并写入一条带会话/消息溯源的 `episode` 记忆，聊天正常完成不受影响

#### Scenario: 平凡闲聊不逐条抽取
- **WHEN** 用户仅进行普通闲聊且未表达关键事实、累计未沉淀消息数未达阈值
- **THEN** 系统不调用抽取 LLM，不写入任何 episode 记忆

#### Scenario: 抽取失败不阻断聊天
- **WHEN** 抽取 LLM 调用失败或返回非法/空结果
- **THEN** 系统不写入任何记忆，正常回复保持可用，并记录可观测失败信号

#### Scenario: 关闭自动沉淀
- **WHEN** 用户在 `episode-config.json` 中把 enabled 设为 false
- **THEN** 系统不再触发 episode 抽取与写入

### Requirement: episode 记忆质量与去重
写入的 `episode` 记忆 MUST 通过既有记忆安全校验（拒绝疑似密钥等敏感内容），内容 SHALL 保持精炼并归一化重要性（1–3，默认 2）。抽取结果 MUST 经结构化解析与容错（非法 JSON / 非预期形状 → 空结果，不写入）。与既有 fact/episode 条目高度相似或引用相同消息的新 episode MUST 被去重，避免重复沉淀。

#### Scenario: 相似内容不重复写入
- **WHEN** 新抽取的 episode 内容与既有记忆条目高度相似或引用相同来源消息
- **THEN** 系统不写入重复 episode

#### Scenario: 敏感内容被拒绝
- **WHEN** 抽取结果疑似包含 API Key 或密码等敏感机密
- **THEN** 系统拒绝写入该 episode 且不污染记忆库

## MODIFIED Requirements

### Requirement: 长期记忆条目管理
系统 SHALL 支持类型为 profile、fact、commitment、episode 的记忆条目，并按规则写入、更新、过期与删除。系统 MUST NOT 再将 preference 作为可写入的长期记忆类型；既有 preference 条目 MUST NOT 再注入召回上下文。

#### Scenario: 画像类按 key 覆盖
- **WHEN** 写入带相同 key 的 profile 条目
- **THEN** 系统覆盖该 key 的旧内容并更新 updatedAt

#### Scenario: 事实类追加
- **WHEN** 写入 fact 或 commitment
- **THEN** 系统追加新条目并保留来源会话与消息引用

#### Scenario: 对话事实沉淀为 episode
- **WHEN** 对话完成后触发自动抽取并命中关键事实
- **THEN** 系统追加一条带来源会话与消息引用的 episode 条目，且该条目可被后续召回

#### Scenario: 过期约定不注入
- **WHEN** commitment 条目已超过 expiresAt
- **THEN** 召回阶段 MUST NOT 将该条目注入模型上下文
