## Why

当前桌宠 Agent 的能力全部以「启动时静态注册的工具」承载,所有工具(记忆、提醒、检索、联网)常驻在 `ToolRegistry` 中。这带来两个问题:

1. **能力与内存同生共死**:凡是需要较重初始化(如加载模型、解析大规则)的能力都必须随启动全量加载,或提前写好死代码,无法按需加载。
2. **规则与实现没有清晰边界**:复杂的「对话技能」(情绪安抚、文字游戏)需要同时携带提示词规则与可执行逻辑,现状缺乏把它们组织成独立可插拔单元的载体。

本变更引入 **skills(技能)模块**:一个技能是一个独立目录(`skill.md` + `script/` + `references/`),采用**渐进式加载**——启动时只扫描目录生成轻量索引(不读正文),只有用户输入命中某技能时才加载该技能的核心规则与工具数据,使用结束后卸载。同时新增一个受限于技能目录内的本地文件读取工具 `read_skill_file`(当前 Agent 无读本地文件能力)。

## What Changes

- 新增标准技能目录格式:`skills/<id>/skill.md`(frontmatter 索引 + 核心规则正文)、`script/tools.ts`(可执行工具)、`references/`(可选参考资料)。
- 新增 `SkillRegistry`:启动扫描 `skills/` 生成轻量 `SkillIndex[]`(id/名称/触发词/描述,常驻);命中时读 `skill.md` 规则、动态加载 `script/tools.ts` 注册进 `ToolRegistry`;互斥激活、结束卸载。
- 新增 `skillRouter` 钩子接入 `AgentRuntime.recall` 节点:对用户输入做确定性触发词扫描,命中即把技能规则注入 systemPrompt 并加载其工具。
- 新增 `read_skill_file` 工具:读取技能目录内文件(skill.md / script / references),realpath 前缀校验防目录穿越。
- 新增两个初始技能:共情回声(empathy,纯文字情绪安抚)、智慧猜谜(guessnumber,1-100 猜数字游戏)。
- 技能目录随版本控制,并作为 `extraResources` 打进安装包(同 live2d 先例)。

## Capabilities

### New Capabilities
- `agent-skills`: 技能目录格式、SkillRegistry 渐进式加载、skillRouter 触发路由、read_skill_file 工具。

### Modified Capabilities
- `pet-agent-runtime`: AgentRuntime 增加 skillRouter 钩子;ToolRegistry 增加 `unregister`。

## Impact

- Electron 主进程新增 `electron/chat/skills/`(types / skillRegistry / skillFileTool)。
- `toolRegistry.ts` 增加 `unregister(name)`。
- `agentRuntime.ts` 构造器增加 `skillRouter`,recall 节点组装 systemPrompt 时注入命中技能规则。
- `chatController.ts` 初始化 SkillRegistry、扫描技能目录、构造 skillRouter、注册 `read_skill_file`。
- `package.json` extraResources 增加技能目录打包条目。
- 不改变现有记忆/提醒/检索/联网工具;不实现 TTS。
