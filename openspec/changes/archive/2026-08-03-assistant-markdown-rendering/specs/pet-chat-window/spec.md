## ADDED Requirements

### Requirement: 助手消息 Markdown 渲染
聊天窗口 SHALL 将助手（assistant）消息内容渲染为安全的 Markdown，支持标题、无序/有序列表、引用、行内代码、围栏代码块、表格、链接与粗斜体。用户（user）消息 MUST 保持纯文本渲染。渲染 MUST 不将未识别 HTML 透传进 DOM（LLM 输出视为不可信输入），且 MUST 不引入 `dangerouslySetInnerHTML` 或 raw-HTML 透传插件。

#### Scenario: 渲染结构化 Markdown
- **WHEN** 助手消息内容包含标题、列表、代码块、表格与行内代码
- **THEN** 气泡内按 Markdown 语义渲染这些元素，而非原样显示 Markdown 符号

#### Scenario: 用户消息保持纯文本
- **WHEN** 用户消息内容包含 Markdown 标记字符
- **THEN** 该消息仍按纯文本显示，不做 Markdown 渲染

#### Scenario: 原始 HTML 不进入 DOM
- **WHEN** 助手消息内容包含 HTML 标签或脚本
- **THEN** 渲染结果将其作为纯文本转义显示，不产生可执行节点

### Requirement: 流式期间保持纯文本
助手消息在流式生成期间 MUST 以逐字纯文本追加显示（不做 Markdown 解析），仅在消息完成、取消或错误（内容已定格）后渲染为 Markdown。

#### Scenario: 生成中逐字显示
- **WHEN** 助手消息处于 streaming 状态且正在追加 token
- **THEN** 气泡以纯文本逐字显示已生成内容，不执行 Markdown 解析

#### Scenario: 完成后渲染 Markdown
- **WHEN** 助手消息状态变为 complete
- **THEN** 气泡以 Markdown 渲染完整内容

### Requirement: 渲染失败回退
当 Markdown 渲染抛错或无法解析时，系统 SHALL 回退为纯文本显示助手内容，MUST NOT 显示空白或中断消息列表。

#### Scenario: 畸形内容回退
- **WHEN** 助手消息内容为畸形 Markdown 且渲染抛错
- **THEN** 气泡以纯文本显示该内容，消息列表正常

## MODIFIED Requirements

### Requirement: 即时通信式消息交互
聊天窗口 SHALL 使用可区分用户与桌宠的消息气泡、可滚动消息列表和固定输入区，并在打开会话或收到新内容时保持当前回复可见。

#### Scenario: 发送文本消息
- **WHEN** 用户输入非空文本并发送
- **THEN** 用户消息立即出现在消息列表中，输入框被清空，系统开始生成桌宠回复

#### Scenario: 助手 Markdown 回复
- **WHEN** 助手消息完成且内容为 Markdown
- **THEN** 气泡按 Markdown 呈现，用户仍可滚动阅读完整消息列表
