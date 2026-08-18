import fs from 'node:fs'
import type { AgentTool } from '../../../src/chat/contracts'
import type { SkillIndex } from './types'
import { resolveSkillPath } from './skillRegistry'

export type ReadSkillFileInput = {
  skillId: string
  path: string
}

/** 技能资产文件内容进提示词时的长度上限（版本控制资产，受信任；仅防上下文膨胀） */
const MAX_FILE_RENDER_CHARS = 2_000

/** read_skill_file 成功结果渲染：把技能文件内容透传给模型（技能资产可信，不包不可信区） */
function renderReadSkillFile(output: unknown): string {
  const o = (typeof output === 'object' && output !== null ? output : {}) as {
    ok?: boolean
    content?: string
    path?: string
    skillId?: string
  }
  const pathLabel = typeof o.path === 'string' && o.path ? `/${o.path}` : ''
  const content = typeof o.content === 'string' ? o.content : ''
  if (!content.trim()) {
    return `read_skill_file：已读取${pathLabel}（内容为空）。回复 MUST 据实说明，禁止编造文件内容。`
  }
  const truncated =
    content.length > MAX_FILE_RENDER_CHARS
      ? `${content.slice(0, MAX_FILE_RENDER_CHARS)}…`
      : content
  return `read_skill_file：已读取技能文件${pathLabel}，内容如下（可基于此回复，但不得虚构文件中没有的信息）：\n${truncated.split('\n').join('\n  ')}`
}

/**
 * 读取技能目录内文件(skill.md / script / references)。
 * 仅允许读取技能根目录内,realpath 前缀校验防目录穿越;内容来自随版本控制的技能资产,风险为 safe。
 * 加载规则本身由 SkillRegistry 直接读盘;本工具供模型在对话中按需读取 references 等补充资料。
 */
export function createReadSkillFileTool(
  getIndex: (id: string) => SkillIndex | undefined,
): AgentTool {
  const read = async (input: ReadSkillFileInput): Promise<{
    ok: true
    content: string
    skillId: string
    path: string
  }> => {
    const index = getIndex(input.skillId)
    if (!index) {
      throw new Error(`技能未注册:${input.skillId}`)
    }
    let target: string
    try {
      target = resolveSkillPath(index.rootDir, input.path)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '技能路径越界')
    }
    const stat = await fs.promises.stat(target).catch(() => null)
    if (!stat || !stat.isFile()) {
      throw new Error(`文件不存在:${input.path}`)
    }
    const content = await fs.promises.readFile(target, 'utf8')
    return { ok: true, content, skillId: index.id, path: input.path }
  }
  return {
    name: 'read_skill_file',
    description:
      '读取某个技能目录内的文件内容(如 skill.md 规则、references/ 下的参考资料)。skillId 指定技能,path 为技能目录内相对路径。技能未注册或路径越界时返回错误。',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '技能 id,如 empathy、guessnumber' },
        path: { type: 'string', description: '技能目录内相对路径,如 skill.md、references/xx.md' },
      },
      required: ['skillId', 'path'],
      additionalProperties: false,
    },
    validate: (input: unknown): ReadSkillFileInput => {
      const raw = input as { skillId?: unknown; path?: unknown }
      if (!raw || typeof raw !== 'object') throw new Error('参数无效')
      if (typeof raw.skillId !== 'string' || !raw.skillId.trim()) throw new Error('缺少技能 id')
      if (typeof raw.path !== 'string' || !raw.path.trim()) throw new Error('缺少文件路径')
      return { skillId: raw.skillId.trim(), path: raw.path.trim() }
    },
    execute: (input, _signal) => read(input as ReadSkillFileInput),
    renderForModel: (output) => renderReadSkillFile(output),
  }
}
