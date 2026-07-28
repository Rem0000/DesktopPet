import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { citationsFromToolOutput, KnowledgeService } from '../electron/chat/knowledgeService'
import { KnowledgeStore } from '../electron/chat/knowledgeStore'
import { MemoryService, scoreMemoryItem } from '../electron/chat/memoryService'
import { MemoryStore } from '../electron/chat/memoryStore'
import { redactSensitive } from '../electron/chat/redact'
import { ToolRegistry } from '../electron/chat/toolRegistry'
import { ToolTraceStore } from '../electron/chat/toolTraceStore'
import { installMockEmbeddingPipeline } from '../electron/retrieval/testHelpers'

type Scenario = {
  id: string
  category: string
  description: string
  assert: string
}

const root = path.dirname(fileURLToPath(import.meta.url))
const scenariosPath = path.join(root, 'scenarios.json')

beforeEach(() => {
  installMockEmbeddingPipeline()
})

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pet-eval-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function runAssert(assert: string): Promise<void> {
  switch (assert) {
    case 'tool_disabled':
      await withTempDir(async () => {
        const registry = new ToolRegistry()
        registry.register({
          name: 'remember_fact',
          description: 'x',
          enabled: true,
          parameters: { type: 'object', properties: {} },
          validate: (input) => input,
          execute: async (input) => input,
        })
        registry.applyOverrides({ remember_fact: { enabled: false } })
        expect(registry.listForPlanning()).toHaveLength(0)
      })
      return
    case 'tool_meta_safe':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        const registry = new ToolRegistry()
        new MemoryService(store, registry).registerDefaultTools()
        const meta = registry.listMeta().find((item) => item.name === 'remember_fact')
        expect(meta).toMatchObject({ enabled: true, riskLevel: 'safe' })
      })
      return
    case 'tool_reminder_registered':
      await withTempDir(async () => {
        const registry = new ToolRegistry()
        registry.register({
          name: 'schedule_reminder',
          description: 'r',
          enabled: true,
          riskLevel: 'safe',
          parameters: { type: 'object', properties: {} },
          validate: (input) => input,
          execute: async (input) => input,
        })
        expect(registry.get('schedule_reminder')).toBeTruthy()
      })
      return
    case 'tool_search_knowledge':
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        const registry = new ToolRegistry()
        new KnowledgeService(store, registry).registerDefaultTools()
        expect(registry.get('search_knowledge')).toBeTruthy()
      })
      return
    case 'tool_confirm_level':
      await withTempDir(async () => {
        const registry = new ToolRegistry()
        registry.register({
          name: 'danger',
          description: 'd',
          riskLevel: 'confirm',
          parameters: { type: 'object', properties: {} },
          validate: (input) => input,
          execute: async (input) => input,
        })
        expect(registry.getRiskLevel('danger')).toBe('confirm')
      })
      return
    case 'tool_forget_confirm_meta':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        const registry = new ToolRegistry()
        new MemoryService(store, registry).registerDefaultTools()
        expect(registry.getRiskLevel('forget_memory')).toBe('confirm')
      })
      return
    case 'tool_confirm_reject':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        const item = await store.writeItem({ type: 'fact', content: '将被拒绝删除', importance: 2 })
        const registry = new ToolRegistry()
        new MemoryService(store, registry).registerDefaultTools()
        const { AgentRuntime } = await import('../electron/chat/agentRuntime')
        const runtime = new AgentRuntime(
          {
            stream: async (_m, _c, _s, onToken) => {
              onToken('未删除')
              return '未删除'
            },
          },
          registry,
        )
        await runtime.run({
          sessionId: 's',
          packageId: 'pkg',
          messages: [
            {
              id: '1',
              sessionId: 's',
              role: 'user',
              content: '忘掉',
              status: 'complete',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          config: {
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
            apiKey: 'k',
          },
          signal: new AbortController().signal,
          onToken: () => undefined,
          pendingToolCalls: [{ name: 'forget_memory', input: { id: item.id } }],
          confirmTool: async () => false,
        })
        expect(store.getItem(item.id)).toBeTruthy()
      })
      return
    case 'tool_confirm_accept':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        const item = await store.writeItem({ type: 'fact', content: '将被删除', importance: 2 })
        const registry = new ToolRegistry()
        new MemoryService(store, registry).registerDefaultTools()
        const { AgentRuntime } = await import('../electron/chat/agentRuntime')
        const runtime = new AgentRuntime(
          {
            stream: async (_m, _c, _s, onToken) => {
              onToken('已删除')
              return '已删除'
            },
          },
          registry,
        )
        await runtime.run({
          sessionId: 's',
          packageId: 'pkg',
          messages: [
            {
              id: '1',
              sessionId: 's',
              role: 'user',
              content: '忘掉',
              status: 'complete',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          config: {
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
            apiKey: 'k',
          },
          signal: new AbortController().signal,
          onToken: () => undefined,
          pendingToolCalls: [{ name: 'forget_memory', input: { id: item.id } }],
          confirmTool: async () => true,
        })
        expect(store.getItem(item.id)).toBeNull()
      })
      return
    case 'plan_instruction_rag':
      {
        const { PLAN_TOOL_INSTRUCTION } = await import('../electron/chat/deepSeekProvider')
        expect(PLAN_TOOL_INSTRUCTION).toContain('search_knowledge')
      }
      return
    case 'memory_profile_override':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        await store.writeItem({
          type: 'profile',
          key: 'user.job',
          content: '学生',
          importance: 2,
        })
        await store.writeItem({
          type: 'profile',
          key: 'user.job',
          content: '工程师',
          importance: 3,
        })
        expect(store.listItems().filter((item) => item.key === 'user.job')).toHaveLength(1)
        expect(store.listItems()[0]?.content).toBe('工程师')
      })
      return
    case 'memory_retrieve_cat':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        const service = new MemoryService(store, new ToolRegistry())
        await store.writeItem({ type: 'fact', content: '养了橘猫豆豆', importance: 2 })
        await store.writeItem({ type: 'fact', content: '喜欢徒步', importance: 2 })
        expect((await service.retrieve('橘猫', 3)).some((item) => item.content.includes('橘猫'))).toBe(
          true,
        )
      })
      return
    case 'memory_pin_first':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        const service = new MemoryService(store, new ToolRegistry())
        await store.writeItem({ type: 'fact', content: '普通事实', importance: 3 })
        await store.writeItem({
          type: 'fact',
          content: '置顶事实',
          importance: 1,
          pinned: true,
        })
        expect((await service.retrieve('', 1))[0]?.content).toBe('置顶事实')
      })
      return
    case 'memory_expired':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        await store.writeItem({
          type: 'commitment',
          content: '过期约定',
          importance: 2,
          expiresAt: '2020-01-01T00:00:00.000Z',
        })
        expect(store.getActiveItems()).toHaveLength(0)
      })
      return
    case 'memory_reject_secret':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        await expect(
          store.writeItem({
            type: 'fact',
            content: 'api_key sk-abcdefghijklmnop',
            importance: 2,
          }),
        ).rejects.toThrow(/拒绝/)
      })
      return
    case 'memory_no_preference':
      await withTempDir(async (dir) => {
        const store = new MemoryStore(dir)
        await store.initialize()
        await expect(
          store.writeItem({
            type: 'preference',
            key: 'tone',
            content: '短一点',
            importance: 2,
          }),
        ).rejects.toThrow(/preference/)
      })
      return
    case 'memory_score':
      expect(
        scoreMemoryItem(
          {
            id: '1',
            type: 'fact',
            content: '喜欢咖啡',
            importance: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          '咖啡',
        ),
      ).toBeGreaterThan(
        scoreMemoryItem(
          {
            id: '2',
            type: 'fact',
            content: '喜欢跑步',
            importance: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          '咖啡',
        ),
      )
      return
    case 'rag_hit':
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        await store.importText('guide', 'DesktopPet 支持本地知识库 RAG 引用溯源')
        expect((await store.search('RAG 引用', 3)).length).toBeGreaterThan(0)
      })
      return
    case 'rag_miss':
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        await store.importText('guide', '只有桌宠相关说明')
        expect(await store.search('量子纠缠xyz', 3)).toHaveLength(0)
      })
      return
    case 'rag_delete':
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        const doc = await store.importText('guide', '可删除文档')
        await store.deleteDocument(doc.id)
        expect(await store.search('可删除', 3)).toHaveLength(0)
      })
      return
    case 'rag_isolation':
      await withTempDir(async (dir) => {
        const knowledge = new KnowledgeStore(dir)
        await knowledge.initialize()
        await knowledge.importText('k', '知识库保留内容')
        const memory = new MemoryStore(dir)
        await memory.initialize()
        await memory.writeItem({ type: 'fact', content: '记忆内容', importance: 2 })
        await memory.clearItems()
        expect((await knowledge.search('知识库', 2)).length).toBeGreaterThan(0)
      })
      return
    case 'rag_reject_pdf':
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        const pdf = path.join(dir, 'a.pdf')
        await writeFile(pdf, '%PDF', 'utf8')
        await expect(store.importFile(pdf)).rejects.toThrow(/仅支持/)
      })
      return
    case 'rag_citation':
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        const registry = new ToolRegistry()
        const service = new KnowledgeService(store, registry)
        service.registerDefaultTools()
        await store.importText('doc', '引用片段内容 ABC')
        const tool = registry.get('search_knowledge')!
        const output = await tool.execute(tool.validate({ query: '引用片段' }), new AbortController().signal)
        expect(citationsFromToolOutput(output).length).toBeGreaterThan(0)
      })
      return
    case 'obs_redact':
      expect(redactSensitive('token abc secret-value')).toContain('[REDACTED]')
      return
    case 'obs_stats':
      await withTempDir(async (dir) => {
        const traces = new ToolTraceStore(dir)
        await traces.initialize()
        await traces.append({
          requestId: '1',
          sessionId: 's',
          toolName: 'remember_fact',
          startedAt: '2026-07-27T00:00:00.000Z',
          endedAt: '2026-07-27T00:00:00.010Z',
          ok: true,
          latencyMs: 10,
        })
        await traces.append({
          requestId: '2',
          sessionId: 's',
          toolName: 'remember_fact',
          startedAt: '2026-07-27T00:00:01.000Z',
          endedAt: '2026-07-27T00:00:01.030Z',
          ok: false,
          latencyMs: 30,
        })
        const stats = await traces.summarize()
        expect(stats[0]).toMatchObject({ toolName: 'remember_fact', calls: 2, successes: 1 })
      })
      return
    default:
      throw new Error(`未知断言：${assert}`)
  }
}

describe('Agent offline evals', async () => {
  const scenarios = JSON.parse(await readFile(scenariosPath, 'utf8')) as Scenario[]
  expect(scenarios.length).toBeGreaterThanOrEqual(20)

  for (const scenario of scenarios) {
    it(`[${scenario.category}] ${scenario.id}: ${scenario.description}`, async () => {
      await runAssert(scenario.assert)
    })
  }
})
