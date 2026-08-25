import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KnowledgeService, citationsFromToolOutput } from './knowledgeService'
import { KnowledgeStore } from './knowledgeStore'
import { MemoryStore } from './memoryStore'
import { ToolRegistry } from './toolRegistry'
import { installMockEmbeddingPipeline } from '../retrieval/testHelpers'

const directories: string[] = []

beforeEach(() => {
  installMockEmbeddingPipeline()
})

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('KnowledgeStore / RAG', () => {
  it('导入 md、检索命中，删除后清理索引', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-'))
    directories.push(directory)
    const store = new KnowledgeStore(directory)
    await store.initialize()

    const source = path.join(directory, 'desktop-pet.md')
    await writeFile(
      source,
      '# DesktopPet\n\n本项目支持 Live2D 导入与 LangGraph Agent 工具编排。\n番茄钟不在本期范围。\n',
      'utf8',
    )
    const doc = await store.importFile(source)
    expect(store.listDocuments()).toHaveLength(1)

    const hits = await store.search('LangGraph 工具编排', 3)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.documentId).toBe(doc.id)

    await store.deleteDocument(doc.id)
    expect(store.listDocuments()).toHaveLength(0)
    expect((await store.search('LangGraph', 3))).toHaveLength(0)
  })

  it('删除文档会同时移除父块、子块与可检索记录', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-parent-child-delete-'))
    directories.push(directory)
    const store = new KnowledgeStore(directory)
    await store.initialize()
    const doc = await store.importText(
      'parent-child',
      '# 检索\n\n第一段是上下文。\n\n第二段包含唯一删除证据：父子分块删除校验。',
    )
    expect(store.listParentChunks().length).toBeGreaterThan(0)
    expect(store.listChildChunks().length).toBeGreaterThan(0)
    expect((await store.search('父子分块删除校验', 3)).length).toBeGreaterThan(0)

    await expect(store.deleteDocument(doc.id)).resolves.toBe(true)
    expect(store.listParentChunks().filter((chunk) => chunk.documentId === doc.id)).toHaveLength(0)
    expect(store.listChildChunks().filter((chunk) => chunk.documentId === doc.id)).toHaveLength(0)
    await expect(store.search('父子分块删除校验', 3)).resolves.toEqual([])
  })

  it('旧单层索引会被拒绝，并可从源文件重建且报告批次进度', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-rebuild-'))
    directories.push(directory)
    const store = new KnowledgeStore(directory)
    await store.initialize()
    for (const [title, content] of [
      ['one', '第一份重建文档'],
      ['two', '第二份重建文档'],
      ['three', '第三份重建文档'],
      ['four', '第四份重建文档'],
      ['five', '第五份重建文档'],
      ['six', '第六份重建文档'],
      ['seven', '第七份重建文档'],
      ['eight', '第八份重建文档'],
      ['nine', '第九份重建文档'],
    ]) {
      await store.importText(title, `# ${title}\n\n${content}`)
    }
    const indexPath = path.join(directory, 'index.json')
    const current = JSON.parse(await (await import('node:fs/promises')).readFile(indexPath, 'utf8')) as { documents: unknown[] }
    await writeFile(indexPath, JSON.stringify({ version: 2, documents: current.documents, chunks: [] }), 'utf8')

    const reopened = new KnowledgeStore(directory)
    await reopened.initialize()
    expect(reopened.isRebuildRequired()).toBe(true)
    await expect(reopened.search('重建', 2)).rejects.toThrow('请先重建索引')
    const progress: Array<{ done: number; total: number }> = []
    await reopened.rebuildIndex((done, total) => progress.push({ done, total }))
    expect(reopened.isRebuildRequired()).toBe(false)
    expect(progress).toEqual([
      { done: 8, total: 9 },
      { done: 9, total: 9 },
    ])
    expect(reopened.listParentChunks()).toHaveLength(9)
    expect(reopened.listChildChunks()).toHaveLength(9)
    expect((await reopened.search('第二份重建文档', 9)).some((hit) => hit.content.includes('第二份重建文档'))).toBe(true)
  })

  it('同一父块的多个子块命中时仅返回一个父块并保留最佳子块证据', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-dedupe-'))
    directories.push(directory)
    const store = new KnowledgeStore(directory)
    await store.initialize()
    await store.importText('dedupe', `# 同一小节\n\n${'检索命中证据 '.repeat(100)}`)
    const hits = await store.search('检索命中证据', 4)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.chunkId).toBe(hits[0]?.parentChunkId)
    expect(hits[0]?.childChunkId).toBeTruthy()
    expect(hits[0]?.content.length).toBeGreaterThan(hits[0]?.childEndOffset! - hits[0]?.childStartOffset!)
  })


  it('知识库与记忆数据隔离，并拒绝不支持的导入格式', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-iso-'))
    directories.push(directory)
    const knowledge = new KnowledgeStore(directory)
    await knowledge.initialize()
    await knowledge.importText('demo', '知识库专属内容：引用溯源演示')

    const memory = new MemoryStore(directory)
    await memory.initialize()
    await memory.writeItem({ type: 'fact', content: '用户喜欢猫', importance: 2 })
    await memory.clearItems()

    expect(knowledge.listDocuments()).toHaveLength(1)
    expect((await knowledge.search('引用溯源', 2)).length).toBeGreaterThan(0)
    await expect(knowledge.importFile(path.join(directory, 'x.pdf'))).rejects.toThrow(/仅支持/)
  })

  it('注册 search_knowledge 工具，无命中返回 empty', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-tool-'))
    directories.push(directory)
    const store = new KnowledgeStore(directory)
    await store.initialize()
    const tools = new ToolRegistry()
    const service = new KnowledgeService(store, tools)
    service.registerDefaultTools()

    const tool = tools.get('search_knowledge')
    expect(tool).toBeTruthy()
    const empty = await tool!.execute(
      tool!.validate({ query: '不存在的主题 xyz' }),
      new AbortController().signal,
    )
    expect(empty).toMatchObject({ ok: true, empty: true, hits: [] })
    expect(citationsFromToolOutput(empty)).toHaveLength(0)

    await store.importText('readme', '桌宠支持本地知识库检索增强回答')
    const hit = await tool!.execute(
      tool!.validate({ query: '知识库检索' }),
      new AbortController().signal,
    )
    const citations = citationsFromToolOutput(hit)
    expect(citations.length).toBeGreaterThan(0)
    expect(citations[0]?.parentChunkId).toBe(citations[0]?.chunkId)
    expect(citations[0]?.childChunkId).toBeTruthy()
    expect(citations[0]?.childStartOffset).toBeTypeOf('number')
    expect(citations[0]?.childEndOffset).toBeTypeOf('number')
  })

  it('中文部分重合也能命中（秋招路线 → 秋招智能体路线）', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-knowledge-cjk-'))
    directories.push(directory)
    const store = new KnowledgeStore(directory)
    await store.initialize()
    await store.importText(
      'rag-demo',
      '# DesktopPet\n\n本仓库的秋招智能体路线包含以下能力：\n- 本地知识库 RAG\n',
    )

    const hits = await store.search('秋招路线 能力', 3)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.content).toContain('秋招智能体路线')
    expect(hits[0]?.headingPath).toContain('DesktopPet')
  })
})
