## ADDED Requirements

### Requirement: 桌宠响应状态联动
系统 SHALL 将当前 Agent 请求的思考、回复和结束状态同步给桌宠主窗口，并 SHALL 在请求完成、取消或失败后恢复空闲状态。

#### Scenario: Agent 开始生成
- **WHEN** 用户消息进入 Agent 执行
- **THEN** 桌宠主窗口进入思考或回复状态

#### Scenario: Agent 请求终止
- **WHEN** 回复完成、用户取消或请求失败
- **THEN** 桌宠主窗口恢复空闲状态

### Requirement: 窗口解耦
聊天窗口关闭 SHALL 不结束桌宠主窗口，桌宠主窗口暂时不可用 SHALL 不阻止聊天消息和会话被正确保存。

#### Scenario: 关闭聊天窗口
- **WHEN** 用户关闭独立聊天窗口
- **THEN** 桌宠继续运行且已完成的聊天记录保持可恢复

### Requirement: 可选语音输出契约
系统 SHALL 为桌宠回复保留消息级朗读动作和可替换的 TTS Provider 接口，但在未配置 TTS Provider 时 MUST NOT 自动合成或播放语音。

#### Scenario: 当前版本未配置 TTS
- **WHEN** Agent 返回文本回复且不存在可用 TTS Provider
- **THEN** 系统正常展示文本，不自动播放声音，并将朗读能力标记为不可用

#### Scenario: 后续接入角色音色
- **WHEN** 后续版本为当前角色配置可用的 TTS 音色
- **THEN** 系统可通过稳定的回复消息标识请求朗读，而无需改变 Agent 或 DeepSeek Provider 协议

### Requirement: Live2D 与 TTS 职责分离
系统 MUST 将角色音色视为 TTS 配置而非 Live2D 模型包的固有能力，并 MUST 保持现有 Live2D 动作声音播放逻辑不受影响。

#### Scenario: Live2D 包含动作音效
- **WHEN** 用户播放带声音的 Live2D 动作
- **THEN** 系统继续按现有动作声音设置播放音效，且不将其作为聊天回复音色使用
