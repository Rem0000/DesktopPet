import { afterEach, describe, expect, it } from 'vitest'
import {
  getEmbeddingModelStatus,
  resetEmbeddingServiceForTests,
  setEmbeddingPipelineForTests,
} from './embeddingService'
import { EmbeddingModelError } from './types'

describe('embeddingService', () => {
  afterEach(() => {
    resetEmbeddingServiceForTests()
  })

  it('EmbeddingModelError 携带缓存目录与手动下载指引', () => {
    const error = new EmbeddingModelError({
      message: '加载失败',
      modelId: 'Xenova/bge-small-zh-v1.5',
      cacheDir: 'D:/ProjectWork/DesktopPet/data/models',
      manualDownloadHint: '请手动下载 BGE-Small-ZH-v1.5',
    })
    expect(error.cacheDir).toContain('models')
    expect(error.manualDownloadHint).toContain('手动下载')
  })

  it('测试注入 pipeline 后状态为 ready', async () => {
    setEmbeddingPipelineForTests(async () => ({ data: [0.1, 0.2, 0.3] }))
    const { embedQuery } = await import('./embeddingService')
    const vector = await embedQuery('测试')
    expect(vector.length).toBeGreaterThan(0)
    expect(getEmbeddingModelStatus().state).toBe('ready')
  })
})
