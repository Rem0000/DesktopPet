import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveDataSubpath } from '../projectPaths'

/**
 * [TEMP-DEBUG] 临时上下文观察日志（验证上下文管理策略后随本文件一起删除）。
 * - 写入 data/logs/context-debug.log（UTF-8），避免 cmd 代码页（GBK）把中文输出成乱码
 * - 终端仅打印 ASCII 提示；写入内容在文件里，任何编辑器/IDE 可直接打开
 * - 通过环境变量 DESKTOP_PET_CONTEXT_DEBUG=1 开启，测试环境默认关闭
 */
const ENABLED = process.env.DESKTOP_PET_CONTEXT_DEBUG === '1'

export type ContextLogSection = { label: string; content: string }

export function isContextDebugEnabled(): boolean {
  return ENABLED
}

export async function logContext(sections: ContextLogSection[]): Promise<void> {
  if (!ENABLED) return
  try {
    const logsDir = resolveDataSubpath('logs')
    const file = path.join(logsDir, 'context-debug.log')
    await mkdir(logsDir, { recursive: true })
    const lines: string[] = [`\n[${new Date().toISOString()}]`]
    for (const section of sections) {
      lines.push(`--- ${section.label} ---`, section.content)
    }
    await appendFile(file, `${lines.join('\n')}\n`, 'utf8')
  } catch {
    // temp debug：日志写入失败不影响主流程
  }
}
