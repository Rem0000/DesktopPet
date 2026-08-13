import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ToolRegistry } from '../toolRegistry'
import {
  SkillRegistry,
  parseSkillFrontmatter,
  resolveSkillPath,
} from './skillRegistry'
import { createSkillRouter } from './skillRouter'

function makeTempSkillsDir(skills: Record<string, { md?: string; tools?: string }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-skills-'))
  for (const [id, files] of Object.entries(skills)) {
    const dir = path.join(root, id)
    fs.mkdirSync(path.join(dir, 'script'), { recursive: true })
    if (files.md) fs.writeFileSync(path.join(dir, 'skill.md'), files.md)
    if (files.tools) fs.writeFileSync(path.join(dir, 'script', 'tools.js'), files.tools)
  }
  return root
}

const EMPATHY_MD = `---
name: 共情回声
id: empathy
trigger: 累,烦,开心
priority: 100
---

# 共情规则
情绪承认 + 内心独白 + 开放式提问。`

const GUESS_MD = `---
name: 智慧猜谜
id: guessnumber
trigger: 猜数字,玩个游戏
priority: 50
---

# 猜谜规则
生成 1-100 谜底。`

const GUESS_TOOLS = `module.exports = {
  createTools() {
    return [
      { name: 'generate_secret', description: 'd', parameters: { type: 'object', properties: {}, additionalProperties: false }, async execute() { return { ok: true, secret: 42 } } },
      { name: 'compare_guess', description: 'd', parameters: { type: 'object', properties: { guess: { type: 'number' } }, required: ['guess'], additionalProperties: false }, async execute(input) { return { ok: true, status: input.guess > 42 ? 'high' : 'low' } } },
    ]
  }
}`

describe('parseSkillFrontmatter', () => {
  it('解析键值对并去除引号', () => {
    const meta = parseSkillFrontmatter(`---
name: 共情回声
trigger: "累,烦"
priority: 100
---`)
    expect(meta).toEqual({ name: '共情回声', trigger: '累,烦', priority: '100' })
  })

  it('无 frontmatter 返回空对象', () => {
    expect(parseSkillFrontmatter('纯文本')).toEqual({})
  })
})

describe('resolveSkillPath', () => {
  it('拒绝目录穿越', () => {
    const root = path.join(os.tmpdir(), 'pet-root-' + Date.now())
    expect(() => resolveSkillPath(root, '../secret.txt')).toThrow(/越界/)
    expect(() => resolveSkillPath(root, 'a/../../secret.txt')).toThrow(/越界/)
  })

  it('接受技能内相对路径', () => {
    const root = path.join(os.tmpdir(), 'pet-root-' + Date.now())
    expect(resolveSkillPath(root, 'skill.md')).toBe(path.join(root, 'skill.md'))
    expect(resolveSkillPath(root, 'references/a.md')).toBe(path.join(root, 'references/a.md'))
  })
})

describe('SkillRegistry', () => {
  it('scan 生成索引(不读正文、不加载 script)', async () => {
    const root = makeTempSkillsDir({
      empathy: { md: EMPATHY_MD },
      guessnumber: { md: GUESS_MD, tools: GUESS_TOOLS },
    })
    const registry = new SkillRegistry()
    const indices = await registry.scan(root)
    expect(indices.map((i) => i.id).sort()).toEqual(['empathy', 'guessnumber'])
    const empathy = registry.getIndex('empathy')!
    expect(empathy.priority).toBe(100)
    expect(registry.isLoaded('guessnumber')).toBe(false)
  })

  it('loadRules 返回正文(去除 frontmatter)', async () => {
    const root = makeTempSkillsDir({ empathy: { md: EMPATHY_MD } })
    const registry = new SkillRegistry()
    await registry.scan(root)
    const rules = await registry.loadRules('empathy')
    expect(rules).toContain('情绪承认')
    expect(rules).not.toContain('trigger')
  })

  it('loadScriptTools 动态加载 script/tools.js', async () => {
    const root = makeTempSkillsDir({ guessnumber: { md: GUESS_MD, tools: GUESS_TOOLS } })
    const registry = new SkillRegistry()
    await registry.scan(root)
    const tools = await registry.loadScriptTools('guessnumber')
    expect(tools.map((t) => t.name)).toEqual(['generate_secret', 'compare_guess'])
    const result = await tools[1].execute({ guess: 100 } as never, new AbortController().signal, {
      packageId: 'pkg',
    })
    expect(result).toMatchObject({ ok: true, status: 'high' })
  })

  it('activate/deactivate 维护激活态与缓存', async () => {
    const root = makeTempSkillsDir({ empathy: { md: EMPATHY_MD } })
    const registry = new SkillRegistry()
    await registry.scan(root)
    const module = await registry.activate('empathy')
    expect(registry.getActiveId()).toBe('empathy')
    expect(registry.isLoaded('empathy')).toBe(true)
    expect(module.rules).toContain('情绪承认')
    registry.deactivate('empathy')
    expect(registry.getActiveId()).toBeNull()
    expect(registry.isLoaded('empathy')).toBe(false)
  })
})

describe('createSkillRouter', () => {
  it('命中触发词激活技能并注册工具;未命中不加载', async () => {
    const root = makeTempSkillsDir({
      empathy: { md: EMPATHY_MD },
      guessnumber: { md: GUESS_MD, tools: GUESS_TOOLS },
    })
    const registry = new SkillRegistry()
    await registry.scan(root)
    const toolRegistry = new ToolRegistry()
    const router = createSkillRouter(registry, toolRegistry)

    // 未命中
    const miss = await router.route('今天天气如何')
    expect(miss).toBeNull()
    expect(registry.getActiveId()).toBeNull()
    expect(toolRegistry.listForPlanning()).toHaveLength(0)

    // 命中共情(优先级 100)
    const hit = await router.route('我好累')
    expect(hit).not.toBeNull()
    expect(hit!.skill.id).toBe('empathy')
    expect(hit!.rulesText).toContain('情绪承认')
    expect(registry.getActiveId()).toBe('empathy')

    // 延续:再次命中低优先级技能不切换
    const again = await router.route('猜数字')
    expect(again).not.toBeNull()
    expect(registry.getActiveId()).toBe('empathy')
  })

  it('游戏中表达更高优先级情绪 → 切换(互斥)', async () => {
    const root = makeTempSkillsDir({
      empathy: { md: EMPATHY_MD },
      guessnumber: { md: GUESS_MD, tools: GUESS_TOOLS },
    })
    const registry = new SkillRegistry()
    await registry.scan(root)
    const toolRegistry = new ToolRegistry()
    const router = createSkillRouter(registry, toolRegistry)

    await router.route('猜数字')
    expect(registry.getActiveId()).toBe('guessnumber')
    expect(toolRegistry.get('generate_secret')).toBeDefined()

    await router.route('我好累')
    expect(registry.getActiveId()).toBe('empathy')
    expect(toolRegistry.get('generate_secret')).toBeUndefined()
  })

  it('退出关键词卸载当前技能', async () => {
    const root = makeTempSkillsDir({ guessnumber: { md: GUESS_MD, tools: GUESS_TOOLS } })
    const registry = new SkillRegistry()
    await registry.scan(root)
    const toolRegistry = new ToolRegistry()
    const router = createSkillRouter(registry, toolRegistry)

    await router.route('猜数字')
    expect(registry.getActiveId()).toBe('guessnumber')
    const exit = await router.route('不玩了')
    expect(exit).toBeNull()
    expect(registry.getActiveId()).toBeNull()
    expect(toolRegistry.get('generate_secret')).toBeUndefined()
  })
})
