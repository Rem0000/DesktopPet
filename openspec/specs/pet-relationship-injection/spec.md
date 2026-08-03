## Purpose

关系层注入：在既有系统提示词组装处并入关系块与演化覆盖，提供三种 policy 渲染模式与分轴语义。

## Requirements

### Requirement: 关系层系统提示词组装
系统 SHALL 在每次模型调用前，于现有系统提示词组装处（`MemoryService.assemble`）并入关系层：有效角色提示 = 固有 persona（或默认提示） + 关系块（按 policy 渲染）+ 已生效演化覆盖，再与记忆块、摘要块一并组装进上下文。关系层 MUST NOT 改变 LangGraph 图结构、工具边界或 IPC 主体协议。

#### Scenario: 含关系块组装
- **WHEN** 任意聊天请求触发 recall 组装且该包存在关系状态
- **THEN** 生成的角色提示包含 persona 原文、按 policy 渲染的关系块与已生效演化覆盖

#### Scenario: 无 persona 仍注入关系层
- **WHEN** 某包无 persona.md 或内容为空
- **THEN** 角色提示仍由默认系统提示 + 关系块 + 演化覆盖构成，而非退回纯默认提示

### Requirement: policy 三模式渲染
系统 SHALL 提供 `layered`、`persona-first`、`dynamic-first` 三种优先级策略，默认 `layered`，共用同一底层关系状态，仅渲染函数不同；每种模式 MUST 产出一条语义自洽的提示，MUST NOT 同时输出互相矛盾的指令。

#### Scenario: 分层合成
- **WHEN** policy=layered 且 persona 声明了既定关系
- **THEN** 关系块以"你们是 X（既定关系）；但当下态度是 Y（温度）"表述，二者共存

#### Scenario: 人设优先
- **WHEN** policy=persona-first 且 persona 声明了关系等级
- **THEN** 动态块只补充 persona 未声明的空白，温度仅影响语气而不违背 persona 声明的等级

#### Scenario: 动态优先
- **WHEN** policy=dynamic-first
- **THEN** 关系块完整描述当前关系（"你们现在是 Y"），persona 中的关系表述仅作起点，不约束当前渲染

### Requirement: 分轴语义
系统 SHALL 将"关系标签（谁是你）"与"好感温度（现在怎么对你）"作为两个轴分别表达为"底子 + 当下"，使模型在二者看似冲突时（如人设写最高等级但温度较低）仍能按"底子是 X、当下是 Y"理解，而不产生互相打架的指令。

#### Scenario: 最高等级但刚认识
- **WHEN** persona 声明"生死之交"但好感温度处于低段且 stage 为 stranger
- **THEN** 渲染出的提示为"你们是生死之交（既定关系）；但今天刚认识，语气还带客套与距离感"，模型据此以"底子信任、当下疏离"回应

### Requirement: 关系块预算约束
关系层注入 MUST 受统一字符/token 预算约束；超预算裁剪时 MUST 保留 persona 种子与当前用户消息，关系块与演化覆盖按优先级裁剪。

#### Scenario: 超预算裁剪
- **WHEN** 组装后上下文超过配置预算
- **THEN** 系统优先保留 persona 与当前用户消息，再保留高优先级关系信息，裁剪其余

### Requirement: 人设优先策略冻结好感调整
当某包 policy 为 persona-first 时，系统 SHALL 不向模型规划开放 `update_relationship` 工具（不进入规划集合），且 SHALL 在执行阶段拦截其调用并返回明确失败；MUST NOT 因对话增减好感温度。好感温度在该策略下保持冻结，MUST 仅允许用户手工修正或重置改变。切换回 layered 或 dynamic-first 后 MUST 恢复自动调整能力。

#### Scenario: 人设优先不进规划集合
- **WHEN** 当前包 policy=persona-first 且 Agent 规划工具调用
- **THEN** `update_relationship` 不在模型可选工具集中，模型不会触发好感调整

#### Scenario: 人设优先执行拦截
- **WHEN** 模型仍尝试调用 `update_relationship`（或外部构造 pendingToolCalls）
- **THEN** 工具返回 `persona_first_policy` 失败，好感温度与历史记录不变

#### Scenario: 恢复自动调整
- **WHEN** 用户将策略从 persona-first 切回 layered 或 dynamic-first
- **THEN** `update_relationship` 重新进入规划集合，对话好感调整恢复
