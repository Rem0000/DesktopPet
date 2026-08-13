import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SkillIndex } from './types'
import { createReadSkillFileTool } from './skillFileTool'

function makeSkillDir(): { root: string; index: SkillIndex } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-skill-tool-'))
  fs.mkdirSync(path.join(root, 'references'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skill.md'), '# 规则\n')
  fs.writeFileSync(path.join(root, 'references', 'tips.md'), '参考文案')
  fs.writeFileSync(path.join(root, 'secret.txt'), '不可读取')
  const index: SkillIndex = {
    id: 'test',
    name: '测试技能',
    description: '',
    trigger: '',
    priority: 0,
    skillMdPath: path.join(root, 'skill.md'),
    rootDir: root,
  }
  return { root, index }
}

describe('read_skill_file', () => {
  it('读取技能内相对路径文件', async () => {
    const { index } = makeSkillDir()
    const tool = createReadSkillFileTool(() => index)
    const output = await tool.execute({ skillId: 'test', path: 'references/tips.md' }, new AbortController().signal)
    expect(output).toMatchObject({ ok: true, content: '参考文案', skillId: 'test' })
  })

  it('目录穿越被拒绝', async () => {
    const { index } = makeSkillDir()
    const tool = createReadSkillFileTool(() => index)
    await expect(
      tool.execute({ skillId: 'test', path: '../secret.txt' }, new AbortController().signal),
    ).rejects.toThrow(/越界/)
  })

  it('技能未注册返回错误', async () => {
    const tool = createReadSkillFileTool(() => undefined)
    await expect(
      tool.execute({ skillId: 'nope', path: 'skill.md' }, new AbortController().signal),
    ).rejects.toThrow(/技能未注册/)
  })

  it('validate 校验必填参数', () => {
    const { index } = makeSkillDir()
    const tool = createReadSkillFileTool(() => index)
    expect(() => tool.validate({})).toThrow()
    expect(tool.validate({ skillId: 'test', path: 'skill.md' })).toEqual({
      skillId: 'test',
      path: 'skill.md',
    })
  })
})
