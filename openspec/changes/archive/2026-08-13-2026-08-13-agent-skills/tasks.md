## 1. 技能目录资产

- [x] 1.1 创建 `skills/empathy/`(skill.md frontmatter + 核心规则 + script/tools.ts + references/)
- [x] 1.2 创建 `skills/guessnumber/`(skill.md frontmatter + 核心规则 + script/tools.ts)

## 2. SkillRegistry 与类型

- [x] 2.1 定义 `SkillIndex` / `SkillModule` / `SkillRouter` 类型(types.ts)
- [x] 2.2 实现 `SkillRegistry.scan`(frontmatter 解析,不读正文)
- [x] 2.3 实现 `loadRules`(读 skill.md 正文)/ `loadTools`(动态 import script)
- [x] 2.4 实现 `activate` / `deactivate`(注册/注销工具,幂等)

## 3. read_skill_file 工具

- [x] 3.1 实现 `read_skill_file` AgentTool,realpath 前缀校验防穿越
- [x] 3.2 加目录穿越与正常读取单测

## 4. 接线运行时与装配

- [x] 4.1 ToolRegistry 增加 `unregister(name)`(幂等)
- [x] 4.2 AgentRuntime 构造器增加 `skillRouter`,recall 节点注入规则文本
- [x] 4.3 chatController 初始化 SkillRegistry、扫描技能目录、构造 skillRouter、注册 read_skill_file
- [x] 4.4 package.json extraResources 增加技能目录打包条目

## 5. 验收

- [x] 5.1 `npm run typecheck` 通过
- [x] 5.2 技能/registry 单测通过
- [x] 5.3 `npm run build` 确认技能目录打包为 extraResources
- [x] 5.4 手动验证:情绪触发安抚、猜数字游戏、互斥、卸载、/btw 不打断
