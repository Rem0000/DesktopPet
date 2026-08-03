## Context

DesktopPet 已有：独立聊天窗口、LangGraph Agent（`recall → plan → toolBoundary → model`）、用户长期记忆（profile/fact/commitment）、Hybrid 检索、项目 `data/` 持久化、按 Live2D 包隔离的人设 `persona.md`。人设即系统提示词，在 `MemoryService.assemble()` 每轮组装为 `[rolePrompt, memoryBlock, summaryBlock]`，用户只能手动改文案。

缺口：模型人物没有"活"的关系状态——无好感/亲密度、态度不随互动变化、固有设定不会随长期相处被影响。目标是从"刚加微信的陌生人"成长为"无话不谈的挚友"，语气、私密度、分享度随聊天演变，且固有人设可在长期相处下缓慢演化（经人审）。

约束：Windows Electron；LLM 走现有 DeepSeek Provider；数据落在项目 `data/` 下；不改 LangGraph 图与 IPC 主体结构；人设文件是用户手写 canon，不得被系统悄悄改写；与记忆、小说数据严格隔离。

## Goals / Non-Goals

**Goals:**
- 每包独立的关系状态：好感温度、关系阶段、当下态度、演化提案、历史，持久化于 `data/relationships/<packageId>.json`
- 注入层：每轮系统提示词 = 固有 persona + 关系块（policy 渲染）+ 已生效演化覆盖，产出单条自洽提示
- 用户可配置 `policy`（分层合成 / 人设优先 / 动态优先），三模式共用同一状态
- 慢速演化：阈值 + 事件驱动反思 → 候选演化 → **人审接受才生效**，overlay 注入，永不重写 persona.md
- 关系面板：查看/重置/手工修正、配置 policy、审演化提案
- 与记忆、小说零业务耦合；删包级联清理关系状态

**Non-Goals:**
- 多模型共享关系（关系严格 per-package）
- 全自动演化 / 无人审直接改写 persona.md
- 关系状态写入聊天记忆或小说库
- 新云端向量库、新 LLM SDK、TTS/音色（已搁置）
- 复杂神经关系图或世界观系统（Shadow-Loom 级）

## Decisions

### D1. 关系状态独立存储，绝不改写 persona.md
- **选择**：`data/relationships/<packageId>.json` 单文件存全部关系状态（`policy/affinity/stage/temperatureNote/evolutions/history`），与 `data/memory`、`data/novels` 同构，原子写沿用 `fsAtomic`
- **理由**：persona.md 是用户手写 canon，运行时状态与源文件分离 → 可审计、可回滚、可重置；re-import 新包目录时 persona 本就不随迁，关系状态同理按包独立
- **备选**：写进 persona.md 或 layer-packs 包目录 → 否决（覆盖用户内容、re-import 丢、无版本）

### D2. 底层状态单一，policy 只是渲染开关
- **选择**：三种 policy 共用同一套 `affinity/stage/temperatureNote/evolutions`，仅 `renderRelationshipBlock(state, persona, policy) → string` 不同
- **理由**：状态机只维护一份真相；policy 是纯函数 → 单测友好、切换零状态迁移；用户切换即时生效（复用 persona 热更新路径，下轮生效）
- **备选**：每模式一套独立状态 → 否决（状态漂移、难维护）

### D3. 注入点唯一：`MemoryService.assemble()`
- **选择**：在现有组装处插入关系层：`有效提示词 = persona + 关系块 + 演化覆盖 + 记忆块 + 摘要块`
- **理由**：全仓系统提示词组装点唯一（`agentRuntime` 的 recall 节点调用 `memoryService.assemble`），在此插一层即可；不改 LangGraph 图、不改 IPC 主体、不动工具注册
- **备选**：在 `agentRuntime` 图加独立节点 → 否决（plan/model 都只消费 systemPrompt，多节点无收益且回归风险高）

### D4. 好感温度 与 关系标签 分轴
- **关系标签**（"谁是你"：青梅竹马/多年挚友/生死之交）：来自 persona，是 canon；仅演化层可缓慢改变
- **好感温度**（"现在怎么对你"：私密度/语气/分享度）：来自动态层，随互动浮动
- 渲染成 "底子是 X，当下态度是 Y" 的单条提示；矛盾时模型按"底子 + 当下"理解
- **理由**：与用户场景吻合（人设写"生死之交"但刚认识时问私密问题会拒绝——底子信任在、当下态度是刚认识）
- **备选**：单一轴（人设或动态二选一）→ 否决（会产生无法调和的指令矛盾）

### D5. policy 三模式（用户可配置）
- `layered`（默认）："你们是 X（既定关系）；但当下他/她对你态度是 Y"
- `persona-first`：人设写了关系即以其为准；动态块只补空白，温度只影响语气、不违背人设声明的等级
- `dynamic-first`：动态块完整描述当前关系（"你们现在是 Y"），人设关系表述只当起点种子
- 面板提供三张通俗卡片而非裸枚举；默认 `layered`
- **理由**：用户拍板"可配置"；三模式共享状态，纯渲染差异，成本低
- **备选**：固定一种 → 否决（用户明确要求可配置）

### D6. 慢速演化 = 人审 overlay，复刻小说 Accept 闸门
- **触发**：affinity/阶段越过阈值 **且** 距上次评估 ≥ N 轮/天（事件驱动，非每轮）
- **反思 LLM**：persona.md + 近期对话证据 → 候选演化 `{ personaQuote, change, evidence, status }`
- **人审**：关系面板 接受/拒绝/忽略；接受才 `status=applied`，进入注入覆盖；拒绝静默过期
- **注入句式**："你曾（原文），但最近（演化）" —— 过去→现在，不产生文本矛盾
- **限频**：每包每 N 天最多 1 条生效演化
- **理由**：映射已验证的"草稿 → StateDiff → 人审 Accept → Canon"：persona 即 canon、演化即 StateDiff、人审即 Accept；错误不污染 persona
- **备选**：自动改写 persona.md / 自动生效 → 否决（违背用户意图、不可回滚）

### D7. 好感怎么算：模型写作（主路径）+ 规则辅助
- **主路径**：注册白名单工具 `update_relationship`，模型在 `planToolCalls` 轮主动写入好感± 与关系笔记（复用 `update_profile` 同构：riskLevel + validate/execute + `data/traces/` 观测 + `formatToolResultsForModel` 硬约束）
- **辅助**：敏感度/启发式规则提供确定性信号（如私密提问降好感），并作 eval 基准
- **可选**：周期反思（与演化共用同一次评估调用）做里程碑与深层变化
- **理由**：复用已打磨的工具编排与 eval 体系，不引入新调度器；模型路径比规则细腻
- **备选**：纯规则 / 纯后台评估 → 前者抓不住"变得愿意分享私事"，后者额外成本且难以观测

### D8. 数据生命周期与隔离
- 老包无 `relationship.json` → 按默认初始化（policy=layered，affinity=初始值，stage=stranger）
- 删除 Live2D 包 → 级联删除其关系状态（复用 `cascadeDeleteSessionsForPackage` 模式）
- 关系状态 MUST NOT 写入 `data/memory/`；小说不读不写关系状态；`projectPaths.DataSubpath` 增加 `relationships`

### D9. 面板与 IPC
- 关系面板：查看 affinity/stage/history、重置、手工修正 temperatureNote、配置 policy、审演化提案
- IPC：`relationship:*` 命名空间，`preload.ts` 暴露，`contracts` 增加关系类型；复用记忆面板的 UI 模式（`memory:list/edit/clear`）
- 建议放置：模型管理窗（与 persona 编辑同处），聊天侧栏只放状态摘要

### D10. eval 与提示词硬约束
- `renderRelationshipBlock` 为纯函数 → 单测覆盖三模板 + 边界（人设提到关系/没提/写了"百无禁忌"）
- eval 场景：关系类意图路由到关系模块而非记忆；好感写入可观测、不伪造；演化人审闸门；三 policy 语义差异
- `formatToolResultsForModel` 扩展硬约束：禁止声称写了好感但未写；关系/口吻类意图不得写入记忆

### D11. persona-first 冻结好感调整
- **选择**：当 policy=persona-first 时，`update_relationship` 不进入规划集合，且执行阶段拦截并返回 `persona_first_policy` 失败；好感温度冻结，仅用户手工修正/重置可改变；切回 layered / dynamic-first 后恢复
- **理由**：persona-first 语义是"关系以人设既定设定为准"；若对话仍能增减好感，会被用户提前写的高亲密人设带偏——本不该加分的不合适对话也会被"人设影响下的亲近感"触发加分，形成反馈污染
- **备选**：仅执行拦截、规划仍暴露 → 否决（浪费一次工具调用，模型易困惑）；仅规划过滤不拦截 → 否决（pendingToolCalls 绕过路径仍可写入）

## Risks / Trade-offs

- **[Risk] 模型误判好感增减** → Mitigation：eval 约束 + 面板可手工修正/重置；好感是温度（可浮动），演化才走人审
- **[Risk] 三 policy 用户困惑** → Mitigation：通俗卡片 + 默认 layered；切换即时生效、零迁移
- **[Risk] 反思/演化 LLM 成本** → Mitigation：事件驱动 + 阈值闸门 + 限频（每包每 N 天 ≤1 条），非每轮
- **[Risk] 演化证据误判** → Mitigation：人审兜底，误判最多浪费一条"建议"，不污染 persona
- **[Risk] 关系块与 persona 文本潜在矛盾** → Mitigation：分轴 + 过去→现在句式 + policy 渲染保证每次只产出一条自洽提示
- **[Trade-off] 模型推断温度 vs 纯规则** → 接受更贵但更细腻的模型路径，规则仅作辅助信号与 eval 基准
- **[Trade-off] 人审演化速度 vs 一致性** → 接受更慢的"设定演化"，换取 persona canon 不被污染

## Migration Plan

1. `ensureDataDirs` 创建空 `data/relationships/`（无历史数据需迁移）
2. 新模块与 IPC 并存，不影响现有聊天/记忆；persona.md 语义变化是增强——默认 `layered` 下"人设为主"的既有行为基本保持
3. 回滚：移除面板入口与注入层，`assemble()` 恢复仅用 persona；`data/relationships/` 可保留或手动删除，不自动清聊天/记忆数据

## Open Questions

- 好感温度量程与阶段表：建议 0–100，阶段 `stranger → acquaintance → friendly → close → intimate` 的阈值与初始值待定
- `update_relationship` 工具是否默认启用（建议默认启用，与记忆工具一致，可被 `data/config/` 覆盖关闭）
- 反思/演化的触发轮数 N 与限频天数默认值（建议 N≈50 轮或 1 天，限频 7 天/条）
- 面板最终落点：模型管理窗（推荐）还是聊天侧栏
- 私密提问等敏感信号的规则词表是否一期纳入，还是纯靠模型推断
