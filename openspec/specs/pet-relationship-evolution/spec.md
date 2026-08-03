## Purpose

关系与固有设定的慢速演化：事件驱动触发、反思候选产出、人审闸门与限频，且永不直接改写 persona.md。

## Requirements

### Requirement: 慢速演化触发闸门
系统 SHALL 仅在好感温度或关系阶段越过阈值 **且** 距上次评估已超过触发间隔（建议 ≥N 轮对话或 N 天）时，才触发一次关系演化评估。评估 MUST 为事件驱动（非每轮执行），未达标或未到期的包 MUST NOT 被评估。

#### Scenario: 达标触发评估
- **WHEN** affinity 越过高阈值且距上次评估已超过间隔
- **THEN** 系统执行一次演化评估并生成候选演化（若有）

#### Scenario: 未到期不评估
- **WHEN** 距上次评估未超过间隔或温度未过阈值
- **THEN** 系统不触发评估，不产生任何候选演化

### Requirement: 反思候选产出
演化评估 SHALL 由反思 LLM 基于 persona.md 原文与近期对话证据产出候选演化，每项包含 `personaQuote`（引用的原文片段）、`change`（建议的"从→到"变化）与 `evidence`（证据摘要）。候选 MUST NOT 自动生效，MUST 进入待审状态。

#### Scenario: 产出候选
- **WHEN** 评估发现 persona 某设定与近期稳定证据不一致（如多次提到已戒烟）
- **THEN** 系统产出一条 `status=proposed` 的候选演化并附带证据

#### Scenario: 无证据不产出
- **WHEN** 评估未发现与 persona 冲突的稳定证据
- **THEN** 系统不产出候选演化，评估结束

### Requirement: 人审闸门
系统 SHALL 将候选演化交由用户审阅：接受后 `status=applied` 并进入注入覆盖；拒绝或忽略的候选 MUST NOT 生效，拒绝项静默过期。系统 MUST 永不直接改写 persona.md，对固有设定的改变 MUST 一律以经审的 overlay 表达。

#### Scenario: 接受生效
- **WHEN** 用户在关系面板接受某候选演化
- **THEN** 该演化标记为 applied 并在后续组装中作为覆盖注入，persona.md 文件内容不变

#### Scenario: 拒绝不影响 persona
- **WHEN** 用户拒绝某候选演化
- **THEN** persona.md 与已生效覆盖均保持不变，该候选不再作为待审项出现

### Requirement: 演化覆盖句式
已生效演化在注入时 MUST 使用"过去→现在"句式（如"你曾有 X，但最近已改为 Y"），使其与 persona 原文构成时间上的转变而非文本矛盾。系统 MUST NOT 要求模型忽略 persona 原文，也不得在渲染时删除原文片段。

#### Scenario: 不产生文本矛盾
- **WHEN** persona 原文含"烟瘾重"且已生效演化含"已戒烟"
- **THEN** 注入文本为"你曾有烟瘾重，但最近已经戒掉"，模型读到的是过去与现在的转变

### Requirement: 演化限频
系统 SHALL 限制每包每单位时间生效的演化条数（建议每 7 天 ≤1 条），防止固有设定快速漂移；达到上限时即使触发条件满足，也 MUST 延后评估直至可用额度恢复。

#### Scenario: 超限延后
- **WHEN** 某包在限频窗口内已生效 1 条演化且窗口未结束
- **THEN** 系统不评估、不产出新候选，直至窗口结束
