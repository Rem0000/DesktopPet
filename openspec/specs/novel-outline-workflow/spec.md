## Purpose

小说大纲工作流：AI 生成草案、人工编辑锁定与正文偏离记账（Divergence）。

## Requirements

### Requirement: AI 生成书籍大纲
系统 SHALL 能基于建书输入（前提、主题、时代背景、种子角色等）生成结构化大纲，至少包含卷与章节点，且每章含标题、节拍摘要、POV（若适用）与目标情绪/冲突说明。生成结果 MUST 先作为可编辑草案呈现，MUST NOT 在无用户确认时覆盖已锁定大纲。

#### Scenario: 首次生成大纲草案
- **WHEN** 用户在建书后请求 AI 生成大纲
- **THEN** 系统返回可编辑的卷章结构草案，并等待用户保存/锁定

#### Scenario: 不覆盖已锁定大纲
- **WHEN** 书已存在用户锁定的大纲且用户未确认覆盖
- **THEN** 新的 AI 生成结果仅作为草案，不自动替换锁定版

### Requirement: 人工编辑与锁定大纲
系统 SHALL 允许用户编辑大纲节点（增删改章、调整顺序、修改节拍说明）并执行锁定/保存。锁定后的大纲 SHALL 作为写章组装的默认计划来源。

#### Scenario: 编辑后锁定
- **WHEN** 用户修改某章节拍说明并锁定大纲
- **THEN** 后续写该章时组装上下文使用更新后的章卡内容

#### Scenario: 局部修订章卡
- **WHEN** 用户请求 AI 仅修订某一章的大纲卡
- **THEN** 系统更新该章草案内容，其他已锁定章保持不变直至用户确认整体保存策略

### Requirement: 正文偏离大纲的 Divergence 记账
当已接受正文相对对应章大纲发生实质性偏离时，系统 SHALL 记录 Divergence 笔记（至少含 bookId、chapterId、摘要说明与时间戳），并 SHALL 提示用户可选择回写大纲。系统 MUST NOT 在无用户确认时用正文自动覆盖大纲。

#### Scenario: Accept 后检测到偏离
- **WHEN** 用户 Accept 一章且内容与章大纲目标冲突摘要不一致（由抽取或用户标记）
- **THEN** 系统新增一条 Divergence 记录并在 UI 可见

#### Scenario: 用户选择回写大纲
- **WHEN** 用户对某 Divergence 选择回写大纲并确认
- **THEN** 对应章大纲卡更新为与正文一致的计划描述，且 Divergence 标记为已处理

#### Scenario: 用户拒绝回写
- **WHEN** 用户忽略或关闭回写提示
- **THEN** 大纲保持原状，Divergence 仍保留供后续处理
