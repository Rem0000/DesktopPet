import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createProvider } from '../../electron/chat/providerFactory'
import { mulberry32 } from '../../electron/retrieval/testRandom'
import coreDataset from './queries.real.json'

/**
 * LLM 补量：从真实知识库剩余 chunk 生成查询（chunk 即 gold）。
 *
 * 分级启发式：
 *  - 生成查询的源 chunk = grade 3（核心答案）
 *  - 与源 chunk 同文档且共享首个 headingPath 段的兄弟 chunk = grade 1（相关）
 * 这样每条补量查询都有多级 gold，NDCG 能反映章节级排序，而不是退化成单 gold 二进制。
 *
 * 运行（需 DEEPSEEK_API_KEY，缺 key 时静默跳过）：
 *   npm run gen:queries
 */
const KB_INDEX = path.resolve(process.cwd(), 'data/knowledge/index.json')
const OUT_FILE = path.resolve(
  process.cwd(),
  'evals/retrieval/queries.llm.json',
)
const TARGET_QUERIES = 40
const BATCH_SIZE = 8
const SEED = 20260818

const root = path.dirname(fileURLToPath(import.meta.url))
const core = coreDataset as {
  documents: Record<string, string>
  knowledge: Array<{ id: string; query: string; relevantChunkGraded: Record<string, number> }>
}

function shortKeyFromChunkId(chunkId: string): string | null {
  const uuid = chunkId.split(':')[0]
  const index = chunkId.split(':')[1]
  const short = Object.entries(core.documents).find(([, id]) => id === uuid)?.[0]
  if (!short || index === undefined) return null
  return `${short}:${index}`
}

type ParsedQuery = { query?: unknown }

/** 从 LLM 回复中提取查询数组：兼容裸数组、{"queries":[...]}、markdown 代码围栏、前后带散文 */
export function parseQueries(raw: string): ParsedQuery[] {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const candidates: string[] = [cleaned]
  const arrMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrMatch?.[0]) candidates.push(arrMatch[0])
  for (const text of candidates) {
    if (!text) continue
    try {
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed)) return parsed as ParsedQuery[]
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { queries?: unknown }).queries)
      ) {
        return (parsed as { queries: ParsedQuery[] }).queries
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return []
}

describe('parseQueries（LLM 回复解析）', () => {
  it('兼容裸数组 / 对象包裹 / 代码围栏 / 散文前缀，垃圾输入返回空', () => {
    expect(parseQueries('[{"query":"a"}]')).toEqual([{ query: 'a' }])
    expect(parseQueries('{"queries":[{"query":"b"}]}')).toEqual([{ query: 'b' }])
    expect(parseQueries('```json\n{"queries":[{"query":"c"}]}\n```')).toEqual([
      { query: 'c' },
    ])
    expect(parseQueries('好的，生成如下：\n[{"query":"d"},{"query":"e"}]')).toEqual([
      { query: 'd' },
      { query: 'e' },
    ])
    expect(parseQueries('调用出错了')).toEqual([])
  })
})

describe('生成 LLM 补量查询集', () => {
  it('从真实知识库 chunk 生成查询并写入 queries.llm.json', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      console.log('[gen-queries] 缺少 DEEPSEEK_API_KEY，跳过 LLM 补量（queries.llm.json 未生成）')
      return
    }

    const idx = JSON.parse(
      await readFile(KB_INDEX, 'utf8'),
    ) as {
      documents: Array<{ id: string; title: string }>
      chunks: Array<{ chunkId: string; documentId: string; headingPath: string[]; content: string }>
    }
    const titleById = new Map(idx.documents.map((d) => [d.id, d.title]))

    // 排除已被人工核心集覆盖的 gold chunk
    const covered = new Set<string>()
    for (const q of core.knowledge) {
      for (const key of Object.keys(q.relevantChunkGraded)) covered.add(key)
    }
    const candidates: Array<{
      key: string
      heading: string
      content: string
      docId: string
      firstHeading: string
    }> = []
    for (const chunk of idx.chunks) {
      const key = shortKeyFromChunkId(chunk.chunkId)
      if (!key || covered.has(key)) continue
      const heading = [titleById.get(chunk.documentId), ...chunk.headingPath].join(' > ')
      candidates.push({
        key,
        heading,
        content: chunk.content.slice(0, 400),
        docId: chunk.documentId,
        firstHeading: chunk.headingPath[0] ?? '',
      })
    }

    // 固定种子采样，按目标数量均衡取
    const rng = mulberry32(SEED)
    const sampled: typeof candidates = []
    const pool = [...candidates]
    while (sampled.length < TARGET_QUERIES && pool.length > 0) {
      const pick = Math.floor(rng() * pool.length)
      sampled.push(pool[pick]!)
      pool.splice(pick, 1)
    }

    const provider = createProvider('deepseek')
    const cfg = {
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      apiKey,
      providerKind: 'deepseek' as const,
    }

    const generated: Array<{
      id: string
      query: string
      relevantChunkGraded: Record<string, number>
    }> = []

    for (let start = 0; start < sampled.length; start += BATCH_SIZE) {
      const batch = sampled.slice(start, start + BATCH_SIZE)
      const system =
        '你是检索评测数据生成器。模拟一个正在准备后端 / Agent 面试的候选人提问。'
      const user = [
        '针对下面每条内容，各写一条自然的中文检索查询：',
        '要求：像用户真实会问的口语化问题；可用同义表达、可以合并提问意图，但必须能被对应内容回答；不要照抄标题。',
        batch
          .map(
            (c, i) =>
              `${i + 1}. [${c.key}] 章节：${c.heading}\n   内容：${c.content}`,
          )
          .join('\n\n'),
        `只输出一个 JSON 对象，不要任何多余文字：{"queries": [{"query": "第1条查询"}, ...]}，元素与上面 ${batch.length} 条一一对应`,
      ].join('\n\n')

      const raw = await provider.completeText(system, user, cfg, new AbortController().signal)
      const queries = parseQueries(raw)
      if (queries.length < batch.length) {
        console.warn(
          `[gen-queries] 批次解析出 ${queries.length}/${batch.length} 条查询，原始回复前 200 字：${raw.slice(0, 200)}`,
        )
      }

      for (let i = 0; i < batch.length; i += 1) {
        const item = batch[i]!
        const query = typeof queries[i]?.query === 'string' ? queries[i]!.query!.trim() : ''
        if (!query) continue
        const graded: Record<string, number> = { [item.key]: 3 }
        for (const sibling of candidates) {
          if (
            sibling.docId === item.docId &&
            sibling.firstHeading &&
            sibling.firstHeading === item.firstHeading &&
            sibling.key !== item.key
          ) {
            graded[sibling.key] = 1
          }
        }
        generated.push({
          id: `lq${String(generated.length + 1).padStart(3, '0')}`,
          query,
          relevantChunkGraded: graded,
        })
      }
      console.log(`[gen-queries] 批次完成 ${Math.min(start + batch.length, sampled.length)}/${sampled.length}`)
    }

    const out = {
      version: 1,
      description: `LLM 补量查询集：源 chunk=grade3，同章节兄弟 chunk=grade1（启发式）。共 ${generated.length} 条。`,
      documents: core.documents,
      knowledge: generated,
    }
    await writeFile(OUT_FILE, JSON.stringify(out, null, 2), 'utf8')
    console.log(`[gen-queries] 已写入 ${OUT_FILE}，共 ${generated.length} 条查询`)
  }, 600_000)
})
