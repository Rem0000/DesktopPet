import fs from 'node:fs'
import path from 'node:path'
import type { AgentTool } from '../../../src/chat/contracts'
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
