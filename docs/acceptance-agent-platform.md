# agent-platform-resume-track 验收清单

对照 delta specs 的自动化/手工核对（2026-07-27）。

## pet-agent-runtime / agent-tool-observability
- [x] ToolRegistry 支持 enabled / riskLevel / 配置覆盖
- [x] 禁用工具不可规划、不可执行
- [x] toolBoundary 产出 start/end 观测（含耗时、脱敏错误）
- [x] JSONL 落盘 + session 查询 + 按工具汇总
- [x] 聊天流推送 `tool_call` 事件

## agent-memory / pet-chat-window（记忆）
- [x] pinned / lastAccessedAt 字段兼容旧 JSON
- [x] retrieve 关键词 + 子串打分；pin 优先；预算裁剪
- [x] 记忆面板搜索与置顶

## local-rag / pet-chat-window（RAG）
- [x] md/txt 导入、删除、分库隔离
- [x] `search_knowledge` 工具；无命中 empty
- [x] 引用展示；无命中不伪造

## agent-eval-safety
- [x] evals ≥20 条，Vitest runner 全绿
- [x] confirm 无确认则不执行
- [x] redact 遮罩密钥
- [x] TTS 未纳入本期交付

## 指标（离线 eval）
- 场景数：20
- 通过：20（`npm test -- --run evals/run.eval.test.ts`）
