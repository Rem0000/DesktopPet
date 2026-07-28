## 1. MemoryStore 基础

- [x] 1.1 定义 MemoryItem / SessionSummary 类型并扩展 IPC 与 preload 契约
- [x] 1.2 实现 `memory-data.json` 的版本化 schema、初始化、串行写队列与原子替换
- [x] 1.3 实现损坏备份恢复，以及删除会话不级联删除 L2 的隔离策略

## 2. 长期记忆写入与安全

- [x] 2.1 实现 profile/preference 按 key 覆盖，fact/commitment/episode 追加与 expiresAt 支持
- [x] 2.2 实现敏感内容拒绝写入（API Key/密码等）与来源字段记录
- [x] 2.3 实现 list/get/update/delete/clear 记忆 API，并加单元测试

## 3. 召回与会话摘要

- [x] 3.1 实现 MemoryService.recall：importance 优先 + 关键词重叠 + 时间衰减 Top-K
- [x] 3.2 实现会话超预算时的 SessionSummary 生成/更新（LLM 摘要，失败则降级要点列表）
- [x] 3.3 实现上下文组装器：角色提示 + L2 + 摘要 + 近期原文，并强制预算裁剪
- [x] 3.4 为召回排序、过期过滤、预算裁剪和摘要降级添加测试

## 4. Agent 图与记忆工具

- [x] 4.1 在 LangGraph 中插入 recall 节点，并在 model 前注入组装后的上下文
- [x] 4.2 注册白名单工具 update_profile、remember_preference、remember_fact、forget_memory
- [x] 4.3 在 toolBoundary 执行记忆工具调用，返回结构化结果；拒绝未注册工具
- [x] 4.4 添加工具写入/遗忘、跨会话召回和会话隔离回归测试
- [x] 4.5 实现对话自动写记忆：planToolCalls 规划 → toolBoundary 执行 → 流式回复；规划失败不阻断

## 5. 聊天窗口记忆面板

- [x] 5.1 在聊天窗口增加记忆入口与条目列表（类型、内容、importance、来源）
- [x] 5.2 支持编辑、删除单条记忆与清空长期记忆（二次确认）
- [x] 5.3 在设置或面板中展示「共享用户画像」说明，避免用户误以为按会话隔离
- [x] 5.4 修复长对话布局：消息列表/会话列表内部滚动，标题与输入区固定可见

## 6. 验收

- [x] 6.1 类型检查与记忆相关单元测试通过
- [ ] 6.2 手动验证：新会话仍能用到旧偏好；编辑/清空记忆立即影响后续召回；对话中说「请记住…」可自动写入
- [ ] 6.3 手动验证：超长会话触发摘要后仍能连贯回答；删除会话不丢 L2 画像；长对话窗口可滚动
