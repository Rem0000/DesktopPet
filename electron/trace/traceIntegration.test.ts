import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentTool } from '../../src/chat/contracts'
import { DEFAULT_TRACE_CONFIG, type TraceConfig, type TraceEvent } from '../../src/trace/contracts'
import type { TraceDirPaths } from '../projectPaths'
import { AgentRuntime, retrievalHitsFromOutput } from '../chat/agentRuntime'
import { ToolRegistry } from '../chat/toolRegistry'
import { TraceStore } from './traceStore'

async function tempPaths(): Promise<TraceDirPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pet-trace-int-'))
  return {
    root,
    sessions: path.join(root, 'sessions'),
    blobs: path.join(root, 'blobs'),
    legacy: path.join(root, 'legacy'),
  }
}

const config: TraceConfig = { ...DEFAULT_TRACE_CONFIG, fsync: 'never' }

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  const tool: AgentTool = {
    name: 'search_knowledge',
    description: '本地知识库检索（测试桩）',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    riskLevel: 'safe',
    validate: (input) => input,
    execute: async (input) => {
      const { query } = input as { query: string }
      return {
        query,
        hits: [{ id: 'chunk-1', score: 0.91, excerpt: '真实片段内容' }],
      }
    },
    renderForModel: () => '- 命中 1 条',
  }
  registry.register(tool)
  return registry
}

async function startRecorder(store: TraceStore, sessionId = 's1') {
  const recorder = await store.beginTurn({
    sessionId,
    packageId: 'pkg',
    turn: 1,
    provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
    tools: [{ name: 'search_knowledge', enabled: true, riskLevel: 'safe' }],
  })
  if (!recorder) throw new Error('recorder 未创建')
  return recorder
}

function typesOf(events: TraceEvent[]): string[] {
  return events.map((event) => event.type)
}

describe('检索命中提取', () => {
  it('从知识库命中提取标识、分数与召回来源', () => {
    const hits = retrievalHitsFromOutput(
      {
        hits: [
          {
            documentId: 'd1',
            chunkId: 'k1',
            title: '面试要点',
            excerpt: '片段',
            score: 0.88,
            sparseScore: 0.4,
            vectorScore: 0.9,
            recallSource: 'both',
          },
        ],
      },
      'knowledge',
    )
    expect(hits).toEqual([
      {
        id: 'd1',
        score: 0.88,
        sparseScore: 0.4,
        vectorScore: 0.9,
        rerankScore: undefined,
        recallSource: 'both',
        title: '面试要点',
      },
    ])
  })

  it('从历史会话命中提取标识并用内容前 80 字作标题', () => {
    const hits = retrievalHitsFromOutput(
      { hits: [{ sessionId: 's9', messageId: 'm9', content: '很久以前聊过的话题', score: 0.5 }] },
      'history',
    )
    expect(hits[0]).toMatchObject({ id: 's9', score: 0.5, title: '很久以前聊过的话题' })
  })

  it('无可解析命中时返回空数组（不伪造命中）', () => {
    expect(retrievalHitsFromOutput(undefined, 'knowledge')).toEqual([])
    expect(retrievalHitsFromOutput({ hits: 'nope' }, 'knowledge')).toEqual([])
    expect(retrievalHitsFromOutput({}, 'memory')).toEqual([])
  })
})

describe('链路采集接入（AgentRuntime）', () => {
  it('产生完整链路：节点 span、规划丢弃原因、工具真实入参与输出、模型用量与首字延迟', async () => {
    const paths = await tempPaths()
    const store = new TraceStore(paths, config)
    const recorder = await startRecorder(store)

    let plannedOnce = false
    const tokenCount = 50
    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, _signal, onToken) => {
          for (let i = 0; i < tokenCount; i += 1) onToken('喵')
          return { text: '喵'.repeat(tokenCount), ttftMs: 1 }
        },
        planToolCalls: async () => {
          if (plannedOnce) return { toolCalls: [] }
          plannedOnce = true
          return {
            toolCalls: [
              { name: 'search_knowledge', input: { query: '并发编程' } },
              { name: 'search_knowledge', input: { query: '并发编程' } },
              { name: 'not_registered', input: {} },
            ],
          }
        },
      },
      makeRegistry(),
    )

    recorder.turnStart('user-1')
    recorder.userMessage({ messageId: 'user-1', content: '讲讲并发' })
    const reply = await runtime.run({
      sessionId: 's1',
      packageId: 'pkg',
      messages: [
        {
          id: 'user-1',
          sessionId: 's1',
          role: 'user',
          content: '讲讲并发',
          status: 'complete',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      config: {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: 'test-key',
      },
      signal: new AbortController().signal,
      onToken: () => undefined,
      trace: recorder,
    })
    recorder.assistantMessage({ messageId: 'assistant-1', content: reply })
    recorder.turnEnd({ status: 'completed', latencyMs: 42 })
    await store.flush('s1')

    expect(reply).toHaveLength(tokenCount)

    const result = await store.readSession('s1', { limit: 1000 })
    const events = result.events
    const types = typesOf(events)

    // 用户与助手消息
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/message')

    // 七个节点均有成对 span
    const stepStarts = events
      .filter((event) => event.type === 'step/start')
      .map((event) => event.data.node)
    const stepEnds = events
      .filter((event) => event.type === 'step/end')
      .map((event) => event.data.node)
    expect(new Set(stepStarts)).toEqual(
      new Set(['normalize', 'recall', 'plan', 'toolBoundary', 'maybeReplan', 'model', 'commit']),
    )
    expect(stepEnds.length).toBe(stepStarts.length)
    for (const event of events) {
      if (event.type === 'step/end') expect(event.data.latencyMs).toBeGreaterThanOrEqual(0)
    }

    // 规划结果含丢弃原因
    const plan = events.find((event) => event.type === 'plan/result')
    expect(plan).toBeDefined()
    if (plan?.type === 'plan/result') {
      expect(plan.data.candidates).toBe(1)
      expect(plan.data.planned.map((call) => call.name)).toEqual(['search_knowledge'])
      expect(plan.data.dropped).toEqual([
        { name: 'not_registered', reason: 'not_allowed' },
        { name: 'search_knowledge', reason: 'duplicate' },
      ])
    }

    // 工具真实入参与真实输出（非占位）
    const call = events.find((event) => event.type === 'tool/call')
    expect(call).toBeDefined()
    if (call?.type === 'tool/call') {
      expect(call.data.name).toBe('search_knowledge')
      expect(call.data.riskLevel).toBe('safe')
      expect(call.data.args).toBe(JSON.stringify({ query: '并发编程', sourceSessionId: 's1' }))
    }
    const toolResult = events.find((event) => event.type === 'tool/result')
    expect(toolResult).toBeDefined()
    if (toolResult?.type === 'tool/result') {
      expect(toolResult.data.ok).toBe(true)
      const output = String(toolResult.data.output)
      expect(output).toContain('chunk-1')
      expect(output).toContain('真实片段内容')
    }

    // 模型调用：请求信封、上下文占用、用量缺失时的首字延迟与耗时
    expect(types).toContain('request/header')
    expect(types).toContain('request/context')
    // 规划与最终回复各产生一对 model/call + model/result，按 kind 区分
    const planResult = events.find(
      (event) => event.type === 'model/result' && event.data.kind === 'plan',
    )
    expect(planResult).toBeDefined()
    if (planResult?.type === 'model/result') {
      // 测试桩未返回用量 → provider 层才会估算；桩直接给出 usage 时才记录
      expect(planResult.data.ok).toBe(true)
    }
    const modelResult = events.find(
      (event) => event.type === 'model/result' && event.data.kind === 'reply',
    )
    expect(modelResult).toBeDefined()
    if (modelResult?.type === 'model/result') {
      expect(modelResult.data.ok).toBe(true)
      expect(modelResult.data.ttftMs).toBeGreaterThanOrEqual(0)
      expect(modelResult.data.characters).toBe(tokenCount)
    }
    const context = events.find((event) => event.type === 'request/context')
    if (context?.type === 'request/context') {
      expect(context.data.parts.messages).toBeGreaterThan(0)
      expect(context.data.usedCharacters).toBeGreaterThan(0)
    }

    // 轮次结束：终态与聚合计数（首轮规划 + 检索后二次规划 + 最终回复 = 3 次模型调用）
    const turnEnd = events.find((event) => event.type === 'turn/end')
    expect(turnEnd).toBeDefined()
    if (turnEnd?.type === 'turn/end') {
      expect(turnEnd.data.status).toBe('completed')
      expect(turnEnd.data.modelCalls).toBe(3)
      expect(turnEnd.data.toolCalls).toBe(1)
      expect(turnEnd.data.toolSuccesses).toBe(1)
    }

    // 检索命中事件：复用工具已算出的分数，不额外计算
    const retrieval = events.find(
      (event) => event.type === 'retrieval/hits' && event.data.source === 'knowledge',
    )
    expect(retrieval).toBeDefined()
    if (retrieval?.type === 'retrieval/hits') {
      expect(retrieval.data.query).toBe('并发编程')
      expect(retrieval.data.hits).toHaveLength(1)
      expect(retrieval.data.hits[0]).toMatchObject({ id: 'chunk-1', score: 0.91 })
    }

    // 不采集逐 token 增量：50 个 token 不产生 50 条事件
    expect(types.filter((type) => type.includes('chunk'))).toEqual([])
    expect(events.length).toBeLessThan(40)

    // seq 稠密
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index))
  })

  it('模型调用被取消时记录失败终态与取消错误码', async () => {
    const paths = await tempPaths()
    const store = new TraceStore(paths, config)
    const recorder = await startRecorder(store)
    const controller = new AbortController()

    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, signal, onToken) => {
          onToken('部分')
          controller.abort()
          const error = new Error('aborted')
          error.name = 'AbortError'
          void signal
          throw error
        },
        planToolCalls: async () => ({ toolCalls: [] }),
      },
      makeRegistry(),
    )

    await expect(
      runtime.run({
        sessionId: 's1',
        packageId: 'pkg',
        messages: [
          {
            id: 'user-1',
            sessionId: 's1',
            role: 'user',
            content: '你好',
            status: 'complete',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'k' },
        signal: controller.signal,
        onToken: () => undefined,
        trace: recorder,
      }),
    ).rejects.toThrow('aborted')

    recorder.turnEnd({
      status: 'cancelled',
      latencyMs: 10,
      errorCode: 'cancelled',
      message: '已停止生成',
    })
    await store.flush('s1')

    const result = await store.readSession('s1', { limit: 1000 })
    const modelResult = result.events.find(
      (event) => event.type === 'model/result' && event.data.kind === 'reply',
    )
    expect(modelResult).toBeDefined()
    if (modelResult?.type === 'model/result') {
      expect(modelResult.data.ok).toBe(false)
      expect(modelResult.data.errorCode).toBe('cancelled')
      expect(modelResult.data.ttftMs).toBeGreaterThanOrEqual(0)
    }
    const modelStep = result.events.find(
      (event) => event.type === 'step/end' && event.data.node === 'model',
    )
    if (modelStep?.type === 'step/end') {
      expect(modelStep.data.note).toContain('error')
    }
    const turnEnd = result.events.find((event) => event.type === 'turn/end')
    if (turnEnd?.type === 'turn/end') {
      expect(turnEnd.data.status).toBe('cancelled')
      expect(turnEnd.data.errorCode).toBe('cancelled')
    }
  })

  it('密钥样式的工具入参不落明文', async () => {
    const paths = await tempPaths()
    const store = new TraceStore(paths, config)
    const recorder = await startRecorder(store)
    const registry = new ToolRegistry()
    registry.register({
      name: 'web_fetch',
      description: '抓取网页（测试桩）',
      parameters: { type: 'object', properties: { url: { type: 'string' } } },
      riskLevel: 'confirm',
      validate: (input) => input as { url: string },
      execute: async () => ({ content: 'ok' }),
      renderForModel: () => '- ok',
    })

    const runtime = new AgentRuntime(
      {
        stream: async () => ({ text: 'done' }),
        planToolCalls: async () => ({
          toolCalls: [{ name: 'web_fetch', input: { url: 'https://x.test', apiKey: 'sk-abcdefghijklmnop' } }],
        }),
      },
      registry,
    )

    await runtime.run({
      sessionId: 's1',
      packageId: 'pkg',
      messages: [
        {
          id: 'user-1',
          sessionId: 's1',
          role: 'user',
          content: '抓一下',
          status: 'complete',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'k' },
      signal: new AbortController().signal,
      onToken: () => undefined,
      confirmTool: async () => false,
      trace: recorder,
    })
    await store.flush('s1')

    const raw = await readFile(store.logPathFor('s1'), 'utf8')
    expect(raw).not.toContain('sk-abcdefghijklmnop')
    expect(raw).toContain('[REDACTED]')

    const result = await store.readSession('s1', { limit: 1000 })
    const confirm = result.events.find((event) => event.type === 'tool/confirm')
    if (confirm?.type === 'tool/confirm') {
      expect(confirm.data.decision).toBe('denied')
      expect(confirm.data.waitedMs).toBeGreaterThanOrEqual(0)
    }
    const toolResult = result.events.find((event) => event.type === 'tool/result')
    if (toolResult?.type === 'tool/result') {
      expect(toolResult.data.ok).toBe(false)
      expect(toolResult.data.errorCode).toBe('cancelled')
    }
  })
})
