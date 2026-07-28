## ADDED Requirements

### Requirement: Per-package persona file
系统 SHALL 在每个 Live2D 导入包目录维护可选的人设文件 `persona.md`，其正文作为该模型聊天时的系统提示词（角色人设）。

#### Scenario: 保存人设
- **WHEN** 用户在管理窗口为某模型保存非空人设文本
- **THEN** 系统将该文本写入对应包目录下的 `persona.md`

#### Scenario: 空人设回退默认提示
- **WHEN** 某包不存在 `persona.md` 或文件内容为空
- **THEN** Agent 使用默认桌宠系统提示词作为该模型的角色提示

#### Scenario: 人设热更新
- **WHEN** 用户更新某包的人设并保存，且该包为当前活跃模型
- **THEN** 随后一次聊天请求组装的系统提示 MUST 使用更新后的人设正文，无需重启应用

### Requirement: Manager persona editor
模型管理窗口 SHALL 为每个已列出的模型提供编辑人设的入口。

#### Scenario: 打开人设编辑
- **WHEN** 用户选择某模型的人设设置入口
- **THEN** 系统展示可编辑文本区，并预填该包当前人设（若无则为空）
