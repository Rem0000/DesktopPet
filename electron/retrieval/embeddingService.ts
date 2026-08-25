import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveDataSubpath } from '../projectPaths'
import { ensureSharpStubForTransformers } from './sharpStub'
import {
  BGE_SMALL_ZH_LOCAL_DIR,
  BGE_SMALL_ZH_MODEL_ID,
  buildManualDownloadHint,
  type EmbeddingModelStatus,
  EmbeddingModelError,
} from './types'

type FeatureExtractionPipeline = (
  text: string | string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[] }>

const transformersRequire = createRequire(import.meta.url)

async function loadTransformersModule(): Promise<{
  env: {
    cacheDir: string
    localModelPath: string
    allowLocalModels: boolean
    allowRemoteModels: boolean
  }
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<FeatureExtractionPipeline>
}> {
  ensureSharpStubForTransformers()
  return transformersRequire('@xenova/transformers')
}

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null
let status: EmbeddingModelStatus = { state: 'idle' }

export function getEmbeddingModelStatus(): EmbeddingModelStatus {
  return status
}

export function resetEmbeddingServiceForTests(): void {
  pipelinePromise = null
  status = { state: 'idle' }
}

export function setEmbeddingPipelineForTests(
  pipeline: FeatureExtractionPipeline,
): void {
  const cacheDir = resolveDataSubpath('models')
  pipelinePromise = Promise.resolve(pipeline)
  status = { state: 'ready', modelId: BGE_SMALL_ZH_MODEL_ID, cacheDir }
}

function toNumberArray(data: Float32Array | number[]): number[] {
  return Array.from(data)
}

function resolveLocalModelPath(cacheDir: string): string | null {
  const candidates = [
    path.join(cacheDir, BGE_SMALL_ZH_LOCAL_DIR),
    path.join(cacheDir, 'Xenova', BGE_SMALL_ZH_LOCAL_DIR),
  ]
  for (const dir of candidates) {
    const hasConfig = fs.existsSync(path.join(dir, 'config.json'))
    const hasQuantized = fs.existsSync(path.join(dir, 'onnx', 'model_quantized.onnx'))
    const hasFull = fs.existsSync(path.join(dir, 'onnx', 'model.onnx'))
    if (hasConfig && (hasQuantized || hasFull)) return dir
  }
  return null
}

async function createPipeline(options: { localOnly?: boolean } = {}): Promise<FeatureExtractionPipeline> {
  const cacheDir = resolveDataSubpath('models')
  status = { state: 'loading', message: '正在加载 BGE-Small-ZH-v1.5…' }
  try {
    const { env, pipeline } = await loadTransformersModule()
    env.cacheDir = cacheDir
    env.allowLocalModels = true

    const localModelDir = resolveLocalModelPath(cacheDir)
    if (options.localOnly && !localModelDir) {
      throw new Error(`未找到本地 BGE 模型：${path.join(cacheDir, BGE_SMALL_ZH_LOCAL_DIR)}`)
    }

    let modelSource = BGE_SMALL_ZH_MODEL_ID
    let localOnly = options.localOnly ?? false
    env.allowRemoteModels = !localOnly

    if (localModelDir) {
      env.localModelPath = `${path.dirname(localModelDir)}${path.sep}`
      modelSource = path.basename(localModelDir)
      localOnly = true
      env.allowRemoteModels = false
    }

    const extractor = await pipeline('feature-extraction', modelSource, {
      cache_dir: cacheDir,
      local_files_only: localOnly,
    })
    status = {
      state: 'ready',
      modelId: BGE_SMALL_ZH_MODEL_ID,
      cacheDir: localModelDir ?? cacheDir,
    }
    console.log(
      '[retrieval] embedding model ready:',
      localModelDir ? `local ${localModelDir}` : `remote ${BGE_SMALL_ZH_MODEL_ID}`,
    )
    return extractor as FeatureExtractionPipeline
  } catch (error) {
    const manualDownloadHint = buildManualDownloadHint(cacheDir)
    const message =
      error instanceof Error
        ? `Embedding 模型加载失败：${error.message}`
        : 'Embedding 模型加载失败'
    status = {
      state: 'error',
      modelId: BGE_SMALL_ZH_MODEL_ID,
      cacheDir,
      message,
      manualDownloadHint,
    }
    throw new EmbeddingModelError({
      message,
      modelId: BGE_SMALL_ZH_MODEL_ID,
      cacheDir,
      manualDownloadHint,
      cause: error,
    })
  }
}

export async function ensureEmbeddingModelLoaded(options: { localOnly?: boolean } = {}): Promise<void> {
  if (options.localOnly && !resolveLocalModelPath(resolveDataSubpath('models'))) {
    const cacheDir = resolveDataSubpath('models')
    const manualDownloadHint = buildManualDownloadHint(cacheDir)
    throw new EmbeddingModelError({
      message: `Embedding 模型加载失败：未找到本地 BGE 模型：${path.join(cacheDir, BGE_SMALL_ZH_LOCAL_DIR)}`,
      modelId: BGE_SMALL_ZH_MODEL_ID,
      cacheDir,
      manualDownloadHint,
    })
  }
  if (status.state === 'ready') return
  if (!pipelinePromise) pipelinePromise = createPipeline(options)
  await pipelinePromise
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  await ensureEmbeddingModelLoaded()
  if (!pipelinePromise) throw new Error('Embedding pipeline 未初始化')
  const extractor = await pipelinePromise

  if (texts.length === 1) {
    const output = await extractor(texts[0]!, { pooling: 'mean', normalize: true })
    return [toNumberArray(output.data)]
  }

  try {
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    const data = toNumberArray(output.data)
    const dim = Math.floor(data.length / texts.length)
    if (dim > 0 && dim * texts.length === data.length) {
      const vectors: number[][] = []
      for (let index = 0; index < texts.length; index += 1) {
        vectors.push(data.slice(index * dim, (index + 1) * dim))
      }
      return vectors
    }
  } catch {
    // 批推理不可用时回退逐条
  }

  const vectors: number[][] = []
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true })
    vectors.push(toNumberArray(output.data))
  }
  return vectors
}

export async function embedQuery(query: string): Promise<number[]> {
  const [vector] = await embedTexts([query])
  if (!vector) throw new Error('查询向量生成失败')
  return vector
}

export function getEmbeddingCacheDir(): string {
  return path.resolve(resolveDataSubpath('models'))
}

export async function retryEmbeddingModelLoad(): Promise<EmbeddingModelStatus> {
  pipelinePromise = null
  status = { state: 'idle' }
  try {
    await ensureEmbeddingModelLoaded()
  } catch {
    // status already set in createPipeline
  }
  return getEmbeddingModelStatus()
}
