## ADDED Requirements

### Requirement: 暖色陪伴风主题
聊天窗口 SHALL 采用与桌宠本体一致的暖色视觉语言：会话区暖米白底、面板（头部/输入区/侧栏）半透明磨砂、大圆角与柔和阴影。配色 MUST 通过 CSS 变量（`--ink/--panel/--accent/--soft/--line`）表达，与桌宠 `src/styles.css` 对齐。

#### Scenario: 主题变量生效
- **WHEN** 用户打开聊天窗口
- **THEN** 会话区呈现暖米白背景，侧栏/头部/输入区为暖色系面板，气泡与控件使用统一 accent 色

#### Scenario: 变量驱动配色
- **WHEN** 修改 `:root` 中的 CSS 变量
- **THEN** 整个聊天窗配色随之变化，无需改动组件类

### Requirement: 助手消息展示当前模型头像
聊天窗口 SHALL 在助手消息旁展示当前活跃 Live2D 包的头像；当包提供 `modelUrl` 时以图片显示，缺失或加载失败时 SHALL 回退为包名首字符的圆形标识。

#### Scenario: 展示包头像
- **WHEN** 助手回复某条消息且当前活跃 Live2D 包存在
- **THEN** 消息旁显示该包头像（图片或回退圆形标识）

#### Scenario: 头像加载失败回退
- **WHEN** 包 `modelUrl` 缺失或图片加载失败
- **THEN** 头像以包名首字符的圆形底显示，不中断消息呈现

### Requirement: 流式回复光标
助手消息在流式生成期间 SHALL 在末尾显示闪烁光标，提示生成进行中。

#### Scenario: 流式期间显示光标
- **WHEN** 助手消息处于 streaming 状态且正在追加内容
- **THEN** 消息末尾出现闪烁光标

#### Scenario: 完成后光标消失
- **WHEN** 助手消息状态变为 complete
- **THEN** 光标消失，消息呈现最终内容

## MODIFIED Requirements

### Requirement: 即时通信式消息交互
聊天窗口 SHALL 使用可区分用户与桌宠的消息气泡、可滚动消息列表和固定输入区，并在打开会话或收到新内容时保持当前回复可见。

#### Scenario: 发送文本消息
- **WHEN** 用户输入非空文本并发送
- **THEN** 用户消息立即出现在消息列表中，输入框被清空，系统开始生成桌宠回复

#### Scenario: 暖色气泡呈现
- **WHEN** 消息列表渲染用户与桌宠消息
- **THEN** 用户气泡为 accent 渐变、桌宠气泡为暖米白，均使用大圆角与柔和阴影

#### Scenario: 助手 Markdown 回复
- **WHEN** 助手消息完成且内容为 Markdown
- **THEN** 气泡按 Markdown 呈现，用户仍可滚动阅读完整消息列表
