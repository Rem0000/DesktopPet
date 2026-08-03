## MODIFIED Requirements

### Requirement: Per-package persona file
系统 SHALL 在每个 Live2D 导入包目录维护可选的人设文件 `persona.md`，其正文作为该模型聊天的**固有角色种子**；每轮有效角色提示 SHALL 由该种子与关系层（关系块 + 已生效演化覆盖，见 pet-relationship-injection / pet-relationship-evolution）合成。

#### Scenario: 保存人设
- **WHEN** 用户在管理窗口为某模型保存非空人设文本
- **THEN** 系统将该文本写入对应包目录下的 `persona.md`

#### Scenario: 空人设回退默认提示
- **WHEN** 某包不存在 `persona.md` 或文件内容为空
- **THEN** Agent 使用默认桌宠系统提示词作为该模型的固有角色种子，关系层仍照常并入

#### Scenario: 人设热更新
- **WHEN** 用户更新某包的人设并保存，且该包为当前活跃模型
- **THEN** 随后一次聊天请求组装的角色提示 MUST 使用更新后的人设正文作为种子，无需重启应用

## ADDED Requirements

### Requirement: 人设不可被系统自动改写
系统 MUST NOT 直接改写 persona.md 文件内容；对固有设定的任何调整 MUST 通过演化机制产出候选、经用户审阅接受后以 overlay 覆盖方式注入（见 pet-relationship-evolution）。用户手动编辑 persona.md 的内容 MUST 始终保留并作为后续合成的种子。

#### Scenario: 演化不写文件
- **WHEN** 某演化候选被接受生效
- **THEN** persona.md 文件内容不变，变化仅以覆盖块形式参与后续合成

#### Scenario: 用户手动编辑保留
- **WHEN** 用户在管理窗口手动修改 persona.md
- **THEN** 新内容立即作为种子参与合成，且未被任何系统自动改写覆盖

#### Scenario: 关系状态重置不影响人设
- **WHEN** 用户重置或清空关系状态
- **THEN** persona.md 原文保持原样，不受影响
