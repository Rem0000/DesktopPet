export type RecallSource = 'sparse' | 'vector' | 'both'

export type RetrievalCorpusItem = {
  id: string
  text: string
  metadata?: Record<string, unknown>
}

export type HybridSearchResult = {
  id: string
  text: string
  score: number
  sparseScore: number
  vectorScore: number
  recallSource: RecallSource
  metadata?: Record<string, unknown>
}

export type HybridSearchOptions = {
  topK: number
  sparseTopK?: number
  vectorTopK?: number
  rerankTopK?: number
  rrfK?: number
  alpha?: number
  beta?: number
  gamma?: number
  minScore?: number
  embedQuery: (query: string) => Promise<number[]>
  getVector: (id: string) => number[] | undefined
  /**
   * ANN 向量召回回调：传入时为近似最近邻（如 HNSW）查询，取代 hybridSearch 内部的
   * 全量余弦扫描；未传入时回退现状全量扫描（行为不变）。
   */
  searchVector?: (queryVector: number[], topK: number) => Array<{ id: string; score: number }>
  metadataBoost?: (item: RetrievalCorpusItem) => number
}

export const HYBRID_DEFAULTS = {
  sparseTopK: 20,
  vectorTopK: 20,
  rerankTopK: 10,
  rrfK: 60,
  alpha: 0.35,
  beta: 0.55,
  gamma: 0.1,
  minScore: 0.18,
} as const

export type EmbeddingModelStatus =
  | { state: 'idle' }
  | { state: 'loading'; message?: string }
  | { state: 'ready'; modelId: string; cacheDir: string }
  | {
      state: 'error'
      modelId: string
      cacheDir: string
      message: string
      manualDownloadHint: string
    }

export class EmbeddingModelError extends Error {
  readonly modelId: string
  readonly cacheDir: string
  readonly manualDownloadHint: string

  constructor(input: {
    message: string
    modelId: string
    cacheDir: string
    manualDownloadHint: string
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'EmbeddingModelError'
    this.modelId = input.modelId
    this.cacheDir = input.cacheDir
    this.manualDownloadHint = input.manualDownloadHint
  }
}

export const BGE_SMALL_ZH_MODEL_ID = 'Xenova/bge-small-zh-v1.5'
/** 手动放置时推荐的本地子目录名（位于 data/models/ 下） */
export const BGE_SMALL_ZH_LOCAL_DIR = 'bge-small-zh-v1.5'

export function buildManualDownloadHint(cacheDir: string): string {
  const localDir = `${cacheDir}\\${BGE_SMALL_ZH_LOCAL_DIR}`
  return [
    `请手动下载 BGE-Small-ZH-v1.5（${BGE_SMALL_ZH_MODEL_ID}）权重并放入：`,
    localDir,
    `示例：huggingface-cli download Xenova/bge-small-zh-v1.5 --local-dir "${localDir}"`,
    '至少需要 tokenizer 相关文件与 onnx/model_quantized.onnx（或 onnx/model.onnx）。',
    '放置完成后重启应用或触发「重试加载模型」。',
  ].join('\n')
}
