## 1. 文档与路线对齐（立即）

- [x] 1.1 创建 OpenSpec change `agent-platform-resume-track`（proposal/design/specs/tasks）
- [x] 1.2 按秋招智能体路线更新 `highlight_resume_pet.md`（项目包装、亮点、面试 Q&A、周计划）

## 2. P0 工具平台化（约第 1–2 周）

- [x] 2.1 扩展 `ToolRegistry`：支持 enabled、riskLevel、schema 元数据与配置覆盖
- [x] 2.2 将现有记忆/提醒工具迁移为统一注册格式，保持默认白名单行为不变
- [x] 2.3 在 Agent `toolBoundary` 统一记录开始/结束、耗时与脱敏错误语义
- [x] 2.4 补充 ToolRegistry / 工具开关相关单测

## 3. P0 可观测性与聊天时间线（约第 2–3 周）

- [x] 3.1 新增工具调用 JSONL 落盘模块（`userData/agent-traces`）与按 session 查询 IPC
- [x] 3.2 流式过程中向渲染层推送 `tool_call` 事件（requestId/sessionId 关联）
- [x] 3.3 聊天窗实现可折叠工具调用时间线（成功/失败/耗时）
- [x] 3.4 增加按 toolName 的次数/成功率/平均耗时汇总接口（本地调试用）

## 4. P1 长期记忆检索升级（约第 4–6 周）

- [x] 4.1 MemoryStore 扩展字段：pinned、lastAccessedAt；兼容旧 `memory-data.json`
- [x] 4.2 实现 `retrieve(query, k)` 关键词/BM25 风格打分，预留后续向量实现接口
- [x] 4.3 召回节点改为检索 + pin/importance/衰减重排 + top-k 预算注入
- [x] 4.4 记忆面板支持 pin、搜索过滤；冲突 profile 覆盖规则保持并补测
- [x] 4.5 编写记忆检索一致性相关测试与 5–10 条手工演示脚本

## 5. P2 本地知识库 RAG（约第 7–8 周）

- [x] 5.1 知识库目录与 document 导入（md/txt）、删除与列表 IPC
- [x] 5.2 切块与本地关键词索引；知识库与用户记忆分库
- [x] 5.3 注册 `search_knowledge` 工具（或等价召回注入开关），无命中返回空结果
- [x] 5.4 聊天窗展示 RAG 引用来源；无命中不伪造引用
- [x] 5.5 补充 RAG 导入/检索/隔离单测与演示文档片段

## 6. P3 评测与安全兜底（约第 9–10 周，可裁剪）

- [x] 6.1 建立 `evals/` 场景集（≥20 条）：工具正确性、记忆一致性、RAG 命中
- [x] 6.2 实现本地评测 runner，输出通过数/失败场景标识
- [x] 6.3 实现 riskLevel=confirm 的用户确认闸门（拒绝则不执行）
- [x] 6.4 观测日志/时间线/评测输出统一敏感信息遮罩
- [x] 6.5 用评测前后对比数字回写 `highlight_resume_pet.md` 指标段

## 7. 验收与面试材料

- [x] 7.1 准备 3 分钟项目演示脚本（工具链 → 记忆检索 → RAG 引用）
- [x] 7.2 对照 specs 做一次手工验收清单勾选
- [x] 7.3 确认 TTS 仍标记为搁置，未误写入本期交付范围
