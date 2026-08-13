# agent-skills Specification

## Purpose
TBD - created by archiving change 2026-08-13-agent-skills. Update Purpose after archive.
## Requirements
### Requirement: 技能目录格式
系统 SHALL 支持标准技能目录格式:每个技能一个独立目录,内含 `skill.md`(frontmatter 索引 + 核心规则正文)、`script/tools.ts`(可执行工具)、`references/`(可选参考资料)。

#### Scenario: frontmatter 索引
- **WHEN** 系统扫描技能目录
- **THEN** 仅解析 `skill.md` 的 frontmatter(名称/触发词/描述),不读取正文,不加载 script

#### Scenario: 规则正文
- **WHEN** 技能被命中
- **THEN** 系统读取 `skill.md` 正文作为核心规则注入提示词

### Requirement: 渐进式加载
系统 SHALL 在启动时只加载技能索引,仅当用户输入命中某技能时才加载该技能的核心规则与工具数据,使用结束后可卸载。

#### Scenario: 命中才加载
- **WHEN** 用户输入命中某技能的触发词
- **THEN** 系统加载该技能的 `skill.md` 规则并注册其 script 工具

#### Scenario: 未命中不加载
- **WHEN** 用户输入未命中任何技能触发词
- **THEN** 系统不加载任何技能规则与工具,维持默认闲聊

#### Scenario: 互斥激活
- **WHEN** 已激活技能A时触发技能B
- **THEN** 系统先卸载技能A再激活技能B,同一时刻只一个技能处于激活态

#### Scenario: 结束卸载
- **WHEN** 技能使用结束(如游戏结束)
- **THEN** 系统注销该技能工具并清除加载态,回到纯索引态

### Requirement: 触发路由
系统 SHALL 通过确定性触发词扫描决定是否激活技能,情绪类技能优先级最高。

#### Scenario: 情绪优先
- **WHEN** 用户在游戏中表达情绪关键词
- **THEN** 系统立即切换至情绪安抚技能

#### Scenario: 顺便模式
- **WHEN** 游戏进行中用户问无关问题
- **THEN** 系统不打断游戏状态,简短回答

### Requirement: read_skill_file 工具
系统 SHALL 提供 `read_skill_file` 工具读取技能目录内文件,并校验路径不得穿越技能根目录。

#### Scenario: 正常读取
- **WHEN** 模型以 `skillId` + 技能内相对路径调用
- **THEN** 工具返回文件文本内容

#### Scenario: 目录穿越拒绝
- **WHEN** 相对路径含 `../` 解析后落在技能根目录之外
- **THEN** 工具拒绝读取并返回错误

