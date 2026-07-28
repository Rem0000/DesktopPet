import {
  resetEmbeddingServiceForTests,
  setEmbeddingPipelineForTests,
} from './embeddingService'

export function resetEmbeddingPipelineForTests(): void {
  resetEmbeddingServiceForTests()
}

export function installMockEmbeddingPipeline(dim = 8): void {
  setEmbeddingPipelineForTests(async (text: string | string[]) => {
    const texts = Array.isArray(text) ? text : [text]
    const data: number[] = []
    for (const item of texts) {
      for (let index = 0; index < dim; index += 1) {
        const code = item.charCodeAt(index % Math.max(item.length, 1)) || 1
        data.push(code / 1000)
      }
    }
    return { data }
  })
}
