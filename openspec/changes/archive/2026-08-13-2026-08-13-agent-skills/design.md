## Context

桌宠 Agent 现有能力全部以启动时静态注册的工具承载,缺乏「技能」这种带提示词规则 + 可执行逻辑的可插拔单元,也缺乏按需加载机制。用户已确认:

- 技能 = 磁盘上的标准目录结构(一个技能一个目录,内含 `skill.md` / `script/` / `references/`)。
- 渐进式加载:启动只扫描目录生成轻量索引(frontmatter),命中意图才读 `skill.md` 规则并加载 `script/` 工具,结束后卸载。
- 技能目录放项目根 `skills/`,随版本控制、打包进应用。
- 触发走提示词路由钩子 `skillRouter`(确定性触发词扫描)。
- 新增 `read_skill_file` 工具仅允许读技能目录内文件。

## Goals / Non-Goals

**Goals:**

- 一个技能一个目录,标准格式:`skill.md`(frontmatter 索引 + 核心规则正文)、`script/tools.ts`、`references/`。
- 启动时只扫描 frontmatter 生成轻量索引(常驻,不进 systemPrompt),命中才加载规则与工具。
- 同一时刻只激活一个技能(互斥),切换/结束时卸载旧技能。
- 新工具 `read_skill_file` 读取技能目录内文件,realpath 防穿越。
- 两个初始技能:共情回声、智慧猜谜。

**Non-Goals:**

- 不做技能市场/远程下载/动态安装。
- 不把技能规则常驻进每轮 systemPrompt(违背渐进式意图)。
- 不做技能沙箱执行任意代码(script 以受控工具契约加载)。
- 不改变现有记忆/提醒/检索/联网工具。

## Decisions

### 1. 三层结构 → 代码映射

| 用户层 | 代码 |
|---|---|
| 第一层 索引表(常驻) | `SkillRegistry` 扫描 frontmatter 生成的 `SkillIndex[]`,不进 systemPrompt |
| 第二层 核心规则 | `skill.md` 正文,`skillRouter` 命中时读取并拼进 systemPrompt |
| 第三层 工具与数据池 | `script/tools.ts` 动态加载注册进 ToolRegistry;技能内模块级内存存状态 |
| 路由/优先级 | `skillRouter` 确定性触发词扫描;情绪优先;互斥 |
| 互斥/卸载 | `SkillRegistry.deactivate` 注销工具 + 清缓存 |

### 2. 触发:提示词路由钩子 `skillRouter`

在 `AgentRuntime.recall` 节点组装 systemPrompt 时调用 `skillRouter`:
- 对最新用户输入做触发词扫描(匹配 `skill.md` frontmatter 的 `trigger` 字段)。
- 命中 → 读该技能 `skill.md` 规则文本,注入 systemPrompt 的专属区块;加载 `script/tools.ts` 注册进 ToolRegistry。
- 未命中 → 不加载,维持默认闲聊。
- 优先级:技能A 情绪触发优先(含游戏中);互斥:切换前 deactivate 旧技能。

备选:仅靠模型工具规划触发——不可靠(模型可能不调用),且无法把规则确定性注入提示词。故采用路由钩子。

### 3. 加载与卸载:SkillRegistry

- `scan(dir)`:读 `skills/*/skill.md` 的 frontmatter(不读正文),构建索引。
- `loadRules(id)`:读 `skill.md` 正文文本。
- `loadTools(id)`:动态 import `script/tools.ts`,取 `tools: AgentTool[]`。
- `activate(id, toolRegistry)`:注册技能工具 + 记录激活态;`deactivate(id)` 注销工具 + 清缓存。均幂等。
- 技能内状态(如猜谜的 `game_secret`)存技能模块内存,game 结束由模块回调 `deactivate`。

### 4. read_skill_file 工具

- 参数:`skillId` + `path`(技能目录内相对路径,如 `skill.md`、`script/tools.ts`、`references/xx.md`)。
- 解析到 `skills/<skillId>/<relpath>` 后 `realpath` 校验必须以技能根目录为前缀,防 `../` 穿越。
- 只读文本文件,`riskLevel: 'safe'`(内容来自随版本控制的技能资产)。output 必须 JSON 序列化。
- 加载规则本身由 SkillRegistry 直接读盘,不经过工具;该工具供模型对话中按需读 references 等。

### 5. 打包与路径

- 开发态技能目录:项目根 `skills/`。
- electron-builder `extraResources` 增加技能目录条目(同 live2d 先例),打包为 `resources/skills/`。
- 路径解析复用 projectPaths 模式,开发/打包一致。

## Open Questions

- 技能 script 是 `.ts` 还是 `.js`?——以 `.ts` 编写、`SkillRegistry` 用动态 import 加载(Vite 主进程 CJS 构建支持;开发态由 esbuild 转译)。运行时若遇动态 import 兼容问题,回退为技能目录内 `.js` + 读文件后动态执行。
