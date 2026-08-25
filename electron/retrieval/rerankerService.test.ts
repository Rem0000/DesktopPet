import { afterEach, describe, expect, it } from 'vitest'
import {
  getRerankerModelStatus,
  rerank,
  resetRerankerServiceForTests,
  setRerankerCoreForTests,
  setRerankerLoadErrorForTests,
} from './rerankerService'

describe('rerankerService', () => {
  afterEach(() => {
    resetRerankerServiceForTests()
  })

  it('分批调用（每批 8）并以全局排序截断 topK', async () => {
    const calls: string[][] = []
    setRerankerCoreForTests({
      tokenizer: async (_texts, options) => {
        const textPair = (options?.text_pair as string[]) ?? []
        calls.push(textPair)
        return { input_ids: textPair, attention_mask: textPair }
      },
      model: async (input) => {
        const ids = (input as { input_ids: string[] }).input_ids
        const logits = ids.map((text) => Number(String(text).split('text ')[1]))
        return { logits: { data: new Float32Array(logits), dims: [logits.length, 1] } }
      },
    })

    const items = Array.from({ length: 18 }, (_, i) => ({ id: `c${i}`, text: `text ${i}` }))
    const result = await rerank('query', items, 5)

    // 18 条 → 3 批：8/8/2；text_pair 传入候选原文
    expect(calls.map((batch) => batch.length)).toEqual([8, 8, 2])
    expect(calls[0]?.[0]).toBe('text 0')

    // logit = n（递增），sigmoid 后全局排序 top5 应横跨多个批次
    expect(result.map((entry) => entry.id)).toEqual(['c17', 'c16', 'c15', 'c14', 'c13'])
    expect(getRerankerModelStatus().state).toBe('ready')
  })

  it('空候选直接返回空数组，不触发模型加载', async () => {
    const result = await rerank('query', [], 5)
    expect(result).toEqual([])
  })

  it('模型加载失败进入 error 状态且 rerank 抛错', async () => {
    setRerankerLoadErrorForTests(new Error('本地权重缺失'))

    const status = getRerankerModelStatus()
    expect(status.state).toBe('error')
    if (status.state === 'error') {
      expect(status.modelId).toBe('Xenova/bge-reranker-base')
      expect(status.manualDownloadHint).toContain('手动下载')
    }

    await expect(
      rerank('query', [{ id: 'a', text: 'text' }], 5),
    ).rejects.toThrow('本地权重缺失')
  })
})
