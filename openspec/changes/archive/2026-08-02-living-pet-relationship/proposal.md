## Why

桌宠当前的人设是每个模型包下一份静态 `persona.md`，作为聊天的系统提示词，用户只能手动改文案来调整语气与态度。模型人物的性格无法随互动成长：没有好感/亲密度概念、态度不会变化、固有设定也不会被长期相处影响。需要一层「活的关系状态」：随聊天气氛实时波动（好感温度），并在长期相处下缓慢演化固有人设（经人审），让模型人物从「刚加微信的陌生人」成长为「无话不谈的挚友」，而非一成不变的提示词。

## What Changes

- 新增按 Live2D 包隔离的**关系状态**（好感温度、关系阶段、当前态度、历史、演化提案），持久化到 `data/relationships/<packageId>.json`
- 新增**注入层**：每轮组装系统提示词时，把「固有 persona.md（不可变种子）+ 关系块（policy 渲染）+ 已生效演化覆盖」合成一条自洽指示，替代现有仅 persona 的角色提示
- 新增**用户可配置优先级策略** `policy`（分层合成 / 人设优先 / 动态优先），三模式共用同一底层状态，仅渲染函数不同
- 新增**慢速演化**：阈值 + 事件驱动反思产出候选演化（如"烟瘾重 → 已戒烟"），**人审接受才生效**，overlay 注入、永不重写 persona.md
- 新增**关系设置面板**：查看/重置好感与历史、手工修正、配置 policy、审演化提案
- **不**把关系状态写入 `data/memory/`；**不**与小说工坊数据互通；删除 Live2D 包时级联清理其关系状态
- **BREAKING**（语义）：人设里的关系级表述不再无条件成为唯一依据——按 policy 决定与动态层的关系（默认分层合成，人设保有对"既定关系"的解释权，动态层决定"当下态度"）

## Capabilities

### New Capabilities
- `pet-relationship-state`: 每包关系状态的存储与生命周期（affinity/stage/temperature/evolutions/history/policy），默认初始化与删包级联清理
- `pet-relationship-injection`: 有效系统提示词 = persona + 关系块 + 演化覆盖的组装与 policy 渲染（三模式各自产出自洽单条提示），含预算约束
- `pet-relationship-evolution`: 慢速演化机制——触发闸门、反思候选、人审接受/拒绝、overlay 注入、限频与过去→现在句式
- `pet-relationship-panel`: 关系设置面板的查看/编辑/重置/策略配置/演化审阅能力与 IPC

### Modified Capabilities
- `pet-agent-runtime`: 系统提示词组装引入关系层（有效人设不再仅来自 persona.md），工具/Agent 图结构不变
- `agent-memory`: 召回注入语义扩展——关系/好感类意图路由到关系模块而非记忆库；关系状态 MUST NOT 写入记忆，记忆 MUST NOT 写入关系
- `model-persona`: persona.md 语义调整——作为不可变固有种子，关系级表述按 policy 解释，系统永不自动改写该文件
- `project-data-store`: 数据子目录约定增加 `relationships/`，确保落在项目 `data/` 根下

## Impact

- **主进程**：新增 `electron/relationship/`（store/service/runtime/controller）；`projectPaths.ts` 的 `DataSubpath` 增加 `relationships`；`MemoryService.assemble`（或 recall 组装）接入关系层渲染
- **前端**：关系面板（接入聊天侧栏或模型管理窗）；`preload.ts` 增加 `relationship:*` IPC；`contracts` 增加关系类型
- **复用**：DeepSeek Provider、Hybrid 检索内核（可选）、`fsAtomic` 原子写、`ToolRegistry`（可选反思/更新工具）、人审面板模式（对齐现有记忆面板与小说 Accept 闸门）
- **隔离**：不修改 MemoryStore 语义；不读写小说数据；删包级联清理关系状态
- **依赖**：无新外部服务；仍使用现有 LLM Provider 与本地 Embedding
