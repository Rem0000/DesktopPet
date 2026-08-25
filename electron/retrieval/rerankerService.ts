import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveDataSubpath } from '../projectPaths'
import { ensureSharpStubForTransformers } from './sharpStub'
import {
  BGE_RERANKER_LOCAL_DIR,
  BGE_RERANKER_MODEL_ID,
  buildRerankerManualDownloadHint,
  type RerankerModelStatus,
  type RerankItem,
  type RerankScore,
} from './types'

/**
 * bge-reranker-base 是单输出 logit 的 cross-encoder（config 里 id2label 只有 LABEL_0），
 * `text-classification` pipeline 对单类恒返回 score=1、`function_to_apply` 不生效，
 * 因此这里不走 pipeline，而是 AutoTokenizer + AutoModel 取原始 logit 再手动 sigmoid。
 */
type RerankerCore = {
  tokenizer: (
    texts: string | string[],
    options?: Record<string, unknown>,
  ) => Promise<{ input_ids: unknown; attention_mask: unknown }>
  model: (input: unknown) => Promise<{
    logits: { data: Float32Array | number[]; dims?: number[] }
  }>
}

const transformersRequire = createRequire(import.meta.url)

async function loadTransformersModule(): Promise<{
  env: {
    cacheDir: string
    localModelPath: string
    allowLocalModels: boolean
    allowRemoteModels: boolean
  }
  AutoTokenizer: {
    from_pretrained: (
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<RerankerCore['tokenizer']>
  }
  AutoModel: {
    from_pretrained: (
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<RerankerCore['model']>
  }
}> {
  ensureSharpStubForTransformers()
  return transformersRequire('@xenova/transformers')
}

let corePromise: Promise<RerankerCore> | null = null
let status: RerankerModelStatus = { state: 'idle' }

export function getRerankerModelStatus(): RerankerModelStatus {
  return status
}

export function resetRerankerServiceForTests(): void {
  corePromise = null
  status = { state: 'idle' }
}

export function setRerankerCoreForTests(core: RerankerCore): void {
  const cacheDir = resolveDataSubpath('models')
  corePromise = Promise.resolve(core)
  status = { state: 'ready', modelId: BGE_RERANKER_MODEL_ID, cacheDir }
}

/** 测试专用：模拟模型加载失败，使服务进入 error 状态（不触网）。 */
export function setRerankerLoadErrorForTests(error: Error): void {
  const cacheDir = resolveDataSubpath('models')
  corePromise = Promise.reject(error)
  status = {
    state: 'error',
    modelId: BGE_RERANKER_MODEL_ID,
    cacheDir,
    message: error.message,
    manualDownloadHint: buildRerankerManualDownloadHint(cacheDir),
  }
}

function resolveLocalModelPath(cacheDir: string): string | null {
  const candidates = [
    path.join(cacheDir, BGE_RERANKER_LOCAL_DIR),
    path.join(cacheDir, 'Xenova', BGE_RERANKER_LOCAL_DIR),
  ]
  for (const dir of candidates) {
    const hasConfig = fs.existsSync(path.join(dir, 'config.json'))
    const hasQuantized = fs.existsSync(path.join(dir, 'onnx', 'model_quantized.onnx'))
    const hasFull = fs.existsSync(path.join(dir, 'onnx', 'model.onnx'))
    if (hasConfig && (hasQuantized || hasFull)) return dir
  }
  return null
}

async function createCore(): Promise<RerankerCore> {
  const cacheDir = resolveDataSubpath('models')
  status = { state: 'loading', message: '正在加载 BGE-Reranker-Base…' }
  try {
    const { env, AutoTokenizer, AutoModel } = await loadTransformersModule()
    env.cacheDir = cacheDir
    env.allowLocalModels = true
    env.allowRemoteModels = true

    const localModelDir = resolveLocalModelPath(cacheDir)
    let modelSource = BGE_RERANKER_MODEL_ID
    let localOnly = false

    if (localModelDir) {
      env.localModelPath = `${path.dirname(localModelDir)}${path.sep}`
      modelSource = path.basename(localModelDir)
      localOnly = true
      env.allowRemoteModels = false
    }

    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelSource, {
        cache_dir: cacheDir,
        local_files_only: localOnly,
      }),
      AutoModel.from_pretrained(modelSource, {
        cache_dir: cacheDir,
        local_files_only: localOnly,
      }),
    ])
    status = {
      state: 'ready',
      modelId: BGE_RERANKER_MODEL_ID,
      cacheDir: localModelDir ?? cacheDir,
    }
    console.log(
      '[retrieval] reranker model ready:',
      localModelDir ? `local ${localModelDir}` : `remote ${BGE_RERANKER_MODEL_ID}`,
    )
    return { tokenizer, model }
  } catch (error) {
    const manualDownloadHint = buildRerankerManualDownloadHint(cacheDir)
    const message =
      error instanceof Error
        ? `Reranker 模型加载失败：${error.message}`
        : 'Reranker 模型加载失败'
    status = {
      state: 'error',
      modelId: BGE_RERANKER_MODEL_ID,
      cacheDir,
      message,
      manualDownloadHint,
    }
    throw error
  }
}

export async function ensureRerankerModelLoaded(): Promise<void> {
  if (status.state === 'ready') return
  if (!corePromise) corePromise = createCore()
  await corePromise
}

function sigmoid(logit: number): number {
  return 1 / (1 + Math.exp(-logit))
}

const RERANK_BATCH_SIZE = 8

export async function rerank(
  query: string,
  items: RerankItem[],
  topK: number,
): Promise<RerankScore[]> {
  if (items.length === 0) return []
  await ensureRerankerModelLoaded()
  if (!corePromise) throw new Error('Reranker 模型未初始化')
  const { tokenizer, model } = await corePromise

  const scored: RerankScore[] = []
  for (let index = 0; index < items.length; index += RERANK_BATCH_SIZE) {
    const batch = items.slice(index, index + RERANK_BATCH_SIZE)
    const encoded = await tokenizer(batch.map(() => query), {
      text_pair: batch.map((item) => item.text),
      padding: true,
      truncation: true,
    })
    const output = await model(encoded)
    const logits = output.logits
    const data = logits.data
    const perItem = logits.dims?.[1] ?? 1
    batch.forEach((item, offset) => {
      const logit = typeof data[offset * perItem] === 'number' ? data[offset * perItem]! : 0
      scored.push({ id: item.id, score: sigmoid(logit) })
    })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
