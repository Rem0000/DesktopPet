## 1. 数据路径与契约

- [x] 1.1 扩展 `DataSubpath` / `ensureDataDirs` 增加 `relationships/`，并更新 project-data-store 相关测试或断言
- [x] 1.2 在 `src/chat/contracts.ts` 定义关系类型：`RelationshipPolicy`（layered/persona-first/dynamic-first）、`RelationshipState`（policy/affinity/stage/temperatureNote/evolutions/history）、`EvolutionProposal`（personaQuote/change/evidence/status）、阶段枚举与阈值常量
- [x] 1.3 README 数据目录表补充 `data/relationships/` 说明（每包独立、与 memory/novels 隔离、删包级联清理）

## 2. 关系状态存储

- [x] 2.1 实现 `electron/relationship/relationshipStore.ts`：按包读写 `data/relationships/<packageId>.json`，原子写复用 `fsAtomic`；缺失文件按默认值初始化（policy=layered、affinity=初始、stage=stranger）
- [x] 2.2 实现阶段推进/回退逻辑（阈值表、history 记录含时间与原因）、手工修正与重置 API
- [x] 2.3 接入删包级联清理（复用 `cascadeDeleteSessionsForPackage` 模式，新增删包入口时一并清理关系状态）
- [x] 2.4 编写 relationshipStore 单元测试（初始化、持久化、阶段推进/回退、重置、删包清理、旧包兼容）

## 3. 注入层与 policy 渲染

- [x] 3.1 实现纯函数 `renderRelationshipBlock(state, persona, policy) → string`：三模板（layered=底子+当下、persona-first=人设优先补空白、dynamic-first=动态覆盖）+ 分轴语义
- [x] 3.2 在 `MemoryService.assemble()` 接入：有效角色提示 = persona（或默认）+ 关系块 + 已生效演化覆盖，再拼记忆块/摘要块；符合预算约束（超预算优先保留 persona 与当前用户消息）
- [x] 3.3 编写注入单测：三模板、人设提到/没提关系、人设写"百无禁忌"、无 persona 仍注入关系层、超预算裁剪

## 4. 好感写入与意图路由

- [x] 4.1 注册白名单工具 `update_relationship`（riskLevel=safe，validate/execute，写入好感±/关系笔记），并入默认 ToolRegistry；支持 `data/config/` 覆盖开关
- [x] 4.2 扩展 `agentRuntime` / `deepSeekProvider` 提示约束：关系/好感类意图路由到 `update_relationship` 而非记忆或人设；扩展 `formatToolResultsForModel` 硬约束（禁止声称写了好感但未写）
- [x] 4.3 编写工具与路由单测 + eval 场景（关系意图不写记忆、记忆召回不含关系、口吻类仍走人设）

## 5. 慢速演化与人审闸门

- [x] 5.1 实现 `electron/relationship/relationshipEvaluator.ts`：触发闸门（affinity/阶段过阈值 + 距上次评估≥N 轮/天，事件驱动）+ 限频（每 7 天 ≤1 条生效）
- [x] 5.2 实现反思 LLM 候选产出（persona.md 原文 + 近期对话证据 → `{personaQuote, change, evidence}`，status=proposed）
- [x] 5.3 实现人审状态机（proposed/applied/rejected）与 overlay 注入句式（过去→现在）；永不直接改写 persona.md
- [x] 5.4 编写演化单测（达标触发/未到期不评估、接受生效、拒绝不影响 persona、限频延后、文本不矛盾）

## 6. 面板与 IPC

- [x] 6.1 新增 `relationship:*` IPC 与 `preload.ts` 暴露（list/get/update/reset/set-policy/eval-list/eval-respond）
- [x] 6.2 实现关系面板 UI：查看 affinity/stage/history、手工修正温度、重置、policy 三卡片切换、演化提案审阅；入口置于模型管理窗
- [x] 6.3 编写面板相关集成测试（IPC 校验、重置不影响 persona/会话/记忆）

## 7. 隔离与回归验证

- [x] 7.1 验证关系写入不落在 `data/memory/`；聊天记忆召回不含关系状态
- [x] 7.2 验证删除包级联清理关系状态；小说模块不读写关系状态
- [x] 7.3 补充关键路径集成/单元测试与 eval 场景；手动冒烟：导入模型 → 对话升温/降温 → 温度变化体现在回复语气 → 演化提案出现 → 接受后下一轮体现新设定，且 persona.md 文件内容不变
