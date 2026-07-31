## Context

DesktopPet 已有：独立聊天窗口、LangGraph Agent、用户长期记忆（profile/fact）、本地知识库、Hybrid 检索（BM25 + BGE + Rerank）、项目 `data/` 持久化。这些能力支撑「桌宠闲聊」，但不足以支撑长篇现实向小说——后者需要模型外的叙事状态机（角色心理、关系、知情差、时间线、伏笔账本），且必须与聊天记忆严格隔离。

约束：Windows Electron 应用；LLM 走现有 DeepSeek Provider；Embedding 复用本地 BGE；一期以「AI 大纲 + 人审章」为主；文类优先现实向。

## Goals / Non-Goals

**Goals:**
- 提供独立小说工坊窗口与一书一库存储
- AI 生成/修订大纲，人工可编辑锁定
- 写章流水线：上下文组装 → 草稿 → StateDiff → Continuity Guard → 人审 Accept
- 现实向连续性记忆：固定注入小预算 + Hybrid 检索大预算
- 与聊天 Agent / MemoryStore / KnowledgeStore 零业务耦合

**Non-Goals:**
- 聊天窗口内写作模式或记忆互通
- 全自动连写多章 / 无人审完本
- 玄幻世界观法术体系、跨书系列智能
- 神经符号因果图、多世界仿真（Shadow-Loom 级）
- 新增云端向量库或新 LLM SDK

## Decisions

### D1. 独立模块与窗口，不挂聊天图
- **选择**：`src/novel/` + `electron/novel/` + 独立 `BrowserWindow`（对齐 chat/manager）
- **理由**：上下文预算、工具集、持久化模型与聊天完全不同；挂聊天会导致会话污染与记忆串库
- **备选**：聊天「写作模式」会话标签 → 否决（耦合高、难隔离）

### D2. 叙事状态外置，Accept 才入 Canon
- **选择**：结构化 StoryStore；草稿可多轮；仅 Accept 后晋升 Canon、更新角色/关系/知情/时间线/伏笔、写章摘要并重建书内索引
- **理由**：自动抽取必脏；人审闸门是长篇一致性的产品真相来源
- **备选**：每轮生成后自动写记忆 → 否决（错误会永久污染）

### D3. 现实向优先 schema
- **选择**：一期核心实体：`meta`、`outline`、`canon`、`characters`、`relationships`、`knowledge`、`timeline`、`promises`、`chapters`/`drafts`/`summaries`、书内 `index`
- **理由**：现实文痛点是知情差、声口、时间穿帮、情感/秘密伏笔，不是物品法术
- **备选**：通用「万物 KG」→ 过度设计，MVP 不做

### D4. 大纲与正文可分叉（Divergence）
- **选择**：大纲可 AI 生成后人工锁定；正文 Accept 若偏离大纲，记录 Divergence 笔记并提示是否回写大纲；不自动覆盖大纲
- **理由**：长篇现实文常人物驱动拐弯；死守初版大纲会逼坏文或逼坏状态
- **备选**：正文必须服从大纲 → 否决（太僵）

### D5. 写章上下文 = 固定块 + 检索块
- **固定块（始终注入，小预算）**：书级主题/文风约束、本章大纲卡、POV 角色卡摘要、未回收高优先级伏笔 top-N、上一场结尾钩子、声口样例
- **检索块（Hybrid，大预算）**：相关角色/关系、相关知情条目、相关时间线、相关章摘要、命中正文短片段
- **理由**：全书塞进上下文不可行；纯 RAG 又抓不住「必须提醒的债」
- **备选**：仅长上下文 / 仅 RAG → 均不足

### D6. 复用检索内核，独立书内索引
- **选择**：调用现有 `hybridSearch` / Embedding；索引落在 `data/novels/<bookId>/index/`；不写入 `data/knowledge/` 或 `data/memory/`
- **理由**：复用成熟检索质量与评测路径，同时保证书间与聊天隔离
- **备选**：小说正文导入全局知识库 → 否决（串库、权限与清空语义混乱）

### D7. 小说 Runtime 独立 LangGraph
- **选择**：`novelRuntime` 独立图：`outlineGenerate` / `outlineRevise`、`assemble` → `draft` → `extractDiff` → `guard`；Accept 为显式 IPC 命令而非图内自动副作用
- **理由**：与聊天 `agentRuntime` 生命周期、工具上限、记忆写入策略不同；共享 Provider 即可
- **备选**：在现有 Agent 图加条件分支 → 否决（复杂度与回归风险高）

### D8. 数据路径
- **选择**：`DataSubpath` 增加 `novels`；路径 `data/novels/<bookId>/...`；原子写沿用 `fsAtomic`
- **理由**：与现有 project-data-store 约定一致，便于备份与演示

### D9. Provider 与密钥
- **选择**：复用主进程已配置的 DeepSeek/兼容 Provider 与安全存储的 API Key；小说窗口不持有明文 Key
- **理由**：与聊天一致的安全边界

### D10. Continuity Guard 策略
- **选择**：一期 Guard 产出结构化告警（时间矛盾、知情越权、伏笔提前回收、已死角色出场等），**不**自动改写正文；Accept 前 UI 展示告警，允许用户强制 Accept（记录 override）
- **理由**：现实文创作需要作者判断；静默改文不可接受

## Risks / Trade-offs

- **[Risk] StateDiff 抽取漏/错** → Mitigation：JSON schema 约束输出；Accept 前可编辑 Diff；错误可在状态面板手工纠正
- **[Risk] 长篇上下文仍爆预算** → Mitigation：固定块硬上限 + 检索 top-k；章摘要分层（章→卷）
- **[Risk] Embedding 未就绪导致无法检索** → Mitigation：与现有策略一致——明确报错与手动放置指引；写章在无向量时可降级为「仅固定块 + 关键词/稀疏检索」（需在实现中显式标注降级，且不假装 Hybrid 完整）
- **[Risk] 大纲与正文长期分叉失控** → Mitigation：Divergence 列表与「回写大纲」动作；状态面板标红休眠伏笔
- **[Risk] 模块体量膨胀拖垮主应用** → Mitigation：懒加载小说窗口；书内索引按书隔离；一期不做多书并行生成
- **[Trade-off] 人审速度 vs 一致性** → 接受更慢的章节循环，换可维护的长篇状态；不做全自动连写

## Migration Plan

1. 扩展 `ensureDataDirs` 创建空 `data/novels/`（无历史数据需迁移）
2. 新窗口与 IPC 并存，不影响现有聊天/记忆
3. 回滚：移除入口与窗口即可；`data/novels/` 可保留或用户手动删除（不自动清聊天数据）

## Open Questions

- 单章目标字数默认值与硬上限（建议默认 2.5k–4k 汉字可配，硬上限防一次请求爆炸）
- Embedding 失败时写章是否允许「仅固定块」继续（建议：允许但 UI 强提示连续性风险）
- 一期是否需要导出整书 Markdown/zip（建议：MVP 可后置，文件系统已可读）
