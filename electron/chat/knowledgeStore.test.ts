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

  it('拒绝不支持格式，且与记忆库隔离（清空记忆不影响知识库）', async () => {
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
    expect(citationsFromToolOutput(hit).length).toBeGreaterThan(0)
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
