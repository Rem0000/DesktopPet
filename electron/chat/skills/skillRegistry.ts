import fs from 'node:fs'
import path from 'node:path'
import type { AgentTool, GuardConfig } from '../../../src/chat/contracts'
import type { SkillIndex, SkillModule, SkillScriptModule } from './types'

/** 解析 skill.md 的 frontmatter(--- 之间的 YAML 键值对) */
export function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  const out: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) out[key] = value
  }
  return out
}

/** 技能根目录下合法相对路径(防目录穿越):必须以技能根目录为前缀 */
export function resolveSkillPath(rootDir: string, relPath: string): string {
  const root = path.resolve(rootDir)
  const target = path.resolve(root, relPath)
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('技能路径越界,仅允许读取技能目录内文件')
  }
  return target
}

/**
 * 技能类工具的 execute 结果必须在每轮回填给模型，否则模型失去游戏真值、
 * 只能编造进度（见猜数字 91→75 状态的整场假游戏）。这里按工具约定识别并
 * 格式化其输出字段（对齐 §14 修复），由 normalizeScriptTool 注入为 renderForModel。
 */
export function formatSkillResultLine(tool: string, output: unknown): string {
  const o = (typeof output === 'object' && output !== null ? output : {}) as Record<
    string,
    unknown
  >
  const pick = (key: string): string | undefined => {
    const v = o[key]
    return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined
  }
  // 软失败：execute 未抛错但返回 ok:false（如游戏尚未开始）——如实说明，禁止假装成功
  if (o.ok === false) {
    const err = pick('error')
    return `- ${tool}：操作未完成（${err ?? '未知原因'}）。回复 MUST 据实说明，禁止假装成功。`
  }
  if (tool === 'compare_guess') {
    const status = pick('status')
    const attempts = pick('attempts')
    const suffix = pick('message')
    if (status) {
      const verdict =
        status === 'correct' ? '猜中' : status === 'high' ? '偏大' : status === 'low' ? '偏小' : status
      let line = `compare_guess 结果：${verdict}`
      if (attempts) line += `（第 ${attempts} 次猜测）`
      if (suffix) line += `。${suffix}`
      return line
    }
    if (suffix) return `compare_guess：${suffix}`
  }
  if (tool === 'generate_secret') {
    // 谜底绝不回填给模型：否则模型会自以为知道答案而不再调用 compare_guess，
    // 进而编造大小提示与胜负。模型必须通过 compare_guess 获取每轮真实结果。
    return 'generate_secret：谜底已生成（仅存在于工具状态中，你不可见；每次用户给出数字，必须先调用 compare_guess 获取真实判定，禁止凭记忆或推测判断大小）'
  }
  if (tool === 'end_game') return 'end_game：猜数字游戏已结束，状态已清理'
  return `- ${tool}：成功`
}

export class SkillRegistry {
  private readonly indices = new Map<string, SkillIndex>()
  /** id → 已加载模块(缓存,deactivate 时清除) */
  private readonly loaded = new Map<string, SkillModule>()
  /** 当前激活的技能 id(互斥,同刻至多一个) */
  private activeId: string | null = null

  /** 扫描技能根目录,解析各 skill.md 的 frontmatter 生成索引(不读正文、不加载 script) */
  async scan(skillsRoot: string): Promise<SkillIndex[]> {
    this.indices.clear()
    let entries: fs.Dirent[] = []
    try {
      entries = await fs.promises.readdir(skillsRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const result: SkillIndex[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const rootDir = path.join(skillsRoot, entry.name)
      const skillMdPath = path.join(rootDir, 'skill.md')
      let content: string
      try {
        content = await fs.promises.readFile(skillMdPath, 'utf8')
      } catch {
        continue
      }
      const meta = parseSkillFrontmatter(content)
      const id = meta.id || entry.name
      const index: SkillIndex = {
        id,
        name: meta.name || entry.name,
        description: meta.description || '',
        trigger: meta.trigger || '',
        priority: Number(meta.priority) || 0,
        skillMdPath,
        rootDir,
      }
      this.indices.set(id, index)
      result.push(index)
    }
    return result
  }

  listIndices(): SkillIndex[] {
    return [...this.indices.values()]
  }

  getIndex(id: string): SkillIndex | undefined {
    return this.indices.get(id)
  }

  getActiveId(): string | null {
    return this.activeId
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id)
  }

  /** 读取 skill.md 正文(排除 frontmatter)作为核心规则 */
  async loadRules(id: string): Promise<string> {
    const index = this.indices.get(id)
    if (!index) throw new Error(`技能未注册:${id}`)
    const content = await fs.promises.readFile(index.skillMdPath, 'utf8')
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    return body.trim()
  }

  /** 动态加载 script 工具:先尝试 script/tools.js(CJS require),失败则回退 script/tools.ts */
  async loadScriptTools(id: string): Promise<AgentTool[]> {
    const index = this.indices.get(id)
    if (!index) throw new Error(`技能未注册:${id}`)
    const scriptDir = path.join(index.rootDir, 'script')
    const jsPath = path.join(scriptDir, 'tools.js')
    const tsPath = path.join(scriptDir, 'tools.ts')
    let mod: SkillScriptModule
    if (fs.existsSync(jsPath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(jsPath) as SkillScriptModule
    } else if (fs.existsSync(tsPath)) {
      const imported = (await import(pathToFileUrl(tsPath))) as SkillScriptModule
      mod = imported
    } else {
      return []
    }
    const create = mod.createTools
    if (typeof create !== 'function') return []
    const raw = create()
    return raw.map((tool) => this.normalizeScriptTool(tool))
  }

  /** 加载技能模块(规则 + 工具)并缓存 */
  async ensureLoaded(id: string): Promise<SkillModule> {
    const cached = this.loaded.get(id)
    if (cached) return cached
    const index = this.indices.get(id)
    if (!index) throw new Error(`技能未注册:${id}`)
    const [rules, tools] = await Promise.all([
      this.loadRules(id),
      this.loadScriptTools(id),
    ])
    const module: SkillModule = { id, name: index.name, rules, tools }
    this.loaded.set(id, module)
    return module
  }

  /** 激活技能:确保已加载,并记录激活态 */
  async activate(id: string): Promise<SkillModule> {
    const module = await this.ensureLoaded(id)
    this.activeId = id
    return module
  }

  /** 卸载技能:清除缓存与激活态(工具注销由调用方通过 ToolRegistry.unregister 完成) */
  deactivate(id: string): void {
    this.loaded.delete(id)
    if (this.activeId === id) this.activeId = null
  }

  /** 切换技能:先卸载当前激活技能,再激活目标(互斥) */
  async switchTo(id: string): Promise<SkillModule> {
    if (this.activeId && this.activeId !== id) {
      this.deactivate(this.activeId)
    }
    return this.activate(id)
  }

  private normalizeScriptTool(tool: AgentTool): AgentTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      enabled: tool.enabled,
      riskLevel: tool.riskLevel,
      renderForModel:
        tool.renderForModel ??
        ((output: unknown, _guardConfig?: GuardConfig) =>
          formatSkillResultLine(tool.name, output)),
      validate: tool.validate ?? ((input: unknown) => input),
      execute: async (input, signal, ctx) => {
        const run = tool.execute
        const result = await run(input as never, signal as never, ctx as never)
        return result
      },
    }
  }
}

function pathToFileUrl(absPath: string): string {
  return 'file://' + path.resolve(absPath).replace(/\\/g, '/')
}
