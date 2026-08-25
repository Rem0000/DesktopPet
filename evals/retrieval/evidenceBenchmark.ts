import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeStore, type KnowledgeChunk, type KnowledgeHit } from '../../electron/chat/knowledgeStore'
import {
  CHILD_MAX_CHARS,
  CHILD_OVERLAP_CHARS,
  PARENT_MAX_CHARS,
  PARENT_OVERLAP_CHARS,
} from '../../electron/retrieval/markdownChunker'
import { BGE_SMALL_ZH_MODEL_ID, HYBRID_DEFAULTS } from '../../electron/retrieval/types'

export type Evidence = {
  evidenceId: string
  document: string
  headingPath: string[]
  anchor: string
  relevance: number
  required: boolean
}

export type EvidenceQuery = {
  id: string
  query: string
  category: string
  evidence: Evidence[]
}

export type CorpusDocument = { alias: string; file: string; sha256: string }

export type EvidenceDataset = {
  version: number
  description: string
  topK: number
  corpus: CorpusDocument[]
  queries: EvidenceQuery[]
}

export type BenchmarkCorpus = {
  store: KnowledgeStore
  temporaryDirectory: string
  documentIds: Map<string, string>
  sourceTexts: Map<string, string>
}

export type EvidenceMapping = Map<string, Set<string>>

export type ParentEvidenceMapping = EvidenceMapping

export type QueryEvidenceScore = {
  id: string
  category: string
  query: string
  evidenceRecall: number
  requiredEvidenceRecall: number
  requiredEvidenceMrr: number
  retrievedEvidenceIds: string[]
  unmappedEvidenceIds: string[]
}

export type RetrievalEvaluationReport = {
  benchmark: string
  mode: 'real_embedding'
  generatedAt: string
  dataset: {
    version: number
    description: string
    topK: number
    corpus: CorpusDocument[]
  }
  model: {
    id: string
    localOnly: true
  }
  chunking: {
    parentMaxChars: number
    parentOverlapChars: number
    childMaxChars: number
    childOverlapChars: number
  }
  hybrid: typeof HYBRID_DEFAULTS
  corpus: {
    parentChunks: number
    childChunks: number
  }
  evidence: {
    total: number
    required: number
    mapped: number
    mappingSuccessRate: number
    unmapped: Array<{
      evidenceId: string
      document: string
      required: boolean
      anchor: string
    }>
  }
  metrics: {
    evidenceRecallAtK: number
    requiredEvidenceRecallAtK: number
    requiredEvidenceMrrAtK: number
  }
  perQuery: Array<QueryEvidenceScore & {
    evidenceRecallAtK: number
    requiredEvidenceRecallAtK: number
    requiredEvidenceMrrAtK: number
  }>
}

export function normalizeEvidenceText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function assertDataset(dataset: EvidenceDataset): void {
  if (dataset.version !== 1 || !Array.isArray(dataset.corpus) || !Array.isArray(dataset.queries)) {
    throw new Error('evidence benchmark 数据集格式非法')
  }
  if (!Number.isInteger(dataset.topK) || dataset.topK <= 0) {
    throw new Error('evidence benchmark topK 必须为正整数')
  }
  if (dataset.corpus.length === 0 || dataset.queries.length === 0) {
    throw new Error('evidence benchmark 语料与查询不能为空')
  }
  const aliases = new Set<string>()
  for (const document of dataset.corpus) {
    if (
      typeof document.alias !== 'string' ||
      !document.alias.trim() ||
      typeof document.file !== 'string' ||
      !document.file.trim() ||
      typeof document.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(document.sha256)
    ) {
      throw new Error('evidence benchmark 语料清单非法')
    }
    if (aliases.has(document.alias)) throw new Error('evidence benchmark 文档别名重复')
    aliases.add(document.alias)
  }
  const queryIds = new Set<string>()
  const evidenceIds = new Set<string>()
  const anchors = new Set<string>()
  for (const query of dataset.queries) {
    if (!query.id || queryIds.has(query.id)) throw new Error(`query id 非法或重复：${query.id}`)
    queryIds.add(query.id)
    if (!query.query?.trim() || !query.category?.trim() || !Array.isArray(query.evidence) || query.evidence.length === 0) {
      throw new Error(`query 缺少查询、分类或 evidence：${query.id}`)
    }
    if (!query.evidence.some((evidence) => evidence.required)) {
      throw new Error(`query 至少需要一条 required evidence：${query.id}`)
    }
    for (const evidence of query.evidence) {
      if (!aliases.has(evidence.document)) throw new Error(`evidence 引用了未知文档：${evidence.evidenceId}`)
      if (!evidence.evidenceId || evidenceIds.has(evidence.evidenceId)) {
        throw new Error(`evidence id 非法或重复：${evidence.evidenceId}`)
      }
      if (!Array.isArray(evidence.headingPath) || !Number.isInteger(evidence.relevance) || evidence.relevance <= 0) {
        throw new Error(`evidence 元数据非法：${evidence.evidenceId}`)
      }
      const anchor = normalizeEvidenceText(evidence.anchor)
      if (!anchor) throw new Error(`evidence anchor 为空：${evidence.evidenceId}`)
      const anchorKey = JSON.stringify([evidence.document, anchor])
      if (anchors.has(anchorKey)) throw new Error(`evidence anchor 在同一文档重复：${evidence.evidenceId}`)
      anchors.add(anchorKey)
      evidenceIds.add(evidence.evidenceId)
    }
  }
}

export async function loadEvidenceDataset(datasetPath: string): Promise<EvidenceDataset> {
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as EvidenceDataset
  assertDataset(dataset)
  return dataset
}

export async function loadFrozenSources(dataset: EvidenceDataset, datasetDirectory: string): Promise<Map<string, string>> {
  assertDataset(dataset)
  const sources = new Map<string, string>()
  for (const document of dataset.corpus) {
    const text = await readFile(path.resolve(datasetDirectory, document.file), 'utf8')
    if (sha256(text) !== document.sha256) throw new Error(`语料快照 hash 不匹配：${document.alias}`)
    sources.set(document.alias, text)
  }
  for (const query of dataset.queries) {
    for (const evidence of query.evidence) {
      const source = sources.get(evidence.document)
      const anchor = normalizeEvidenceText(evidence.anchor)
      const occurrences = source ? normalizeEvidenceText(source).split(anchor).length - 1 : 0
      if (occurrences !== 1) {
        throw new Error(`evidence anchor 必须在原文唯一出现（${occurrences} 次）：${evidence.evidenceId}`)
      }
    }
  }
  return sources
}

export async function createBenchmarkCorpus(dataset: EvidenceDataset, datasetDirectory: string): Promise<BenchmarkCorpus> {
  const sourceTexts = await loadFrozenSources(dataset, datasetDirectory)
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'pet-evidence-benchmark-'))
  const store = new KnowledgeStore(temporaryDirectory)
  await store.initialize()
  const documentIds = new Map<string, string>()
  for (const document of dataset.corpus) {
    const text = sourceTexts.get(document.alias)
    if (!text) throw new Error(`缺失已校验的语料：${document.alias}`)
    const imported = await store.importText(document.alias, text, path.basename(document.file))
    documentIds.set(document.alias, imported.id)
  }
  return { store, temporaryDirectory, documentIds, sourceTexts }
}

export async function disposeBenchmarkCorpus(corpus: BenchmarkCorpus): Promise<void> {
  await rm(corpus.temporaryDirectory, { recursive: true, force: true })
}

export function mapEvidenceToChunks(dataset: EvidenceDataset, chunks: KnowledgeChunk[], documentIds: Map<string, string>): EvidenceMapping {
  const mappings: EvidenceMapping = new Map()
  const parentChunks = chunks.filter((chunk) => chunk.kind !== 'child')
  for (const query of dataset.queries) {
    for (const evidence of query.evidence) {
      const documentId = documentIds.get(evidence.document)
      const anchor = normalizeEvidenceText(evidence.anchor)
      const chunkIds = new Set(
        parentChunks
          .filter((chunk) => chunk.documentId === documentId && normalizeEvidenceText(chunk.content).includes(anchor))
          .map((chunk) => chunk.parentChunkId || chunk.chunkId),
      )
      mappings.set(evidence.evidenceId, chunkIds)
    }
  }
  return mappings
}

function coverageByChunk(mapping: EvidenceMapping): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [evidenceId, chunkIds] of mapping) {
    for (const chunkId of chunkIds) result.set(chunkId, [...(result.get(chunkId) ?? []), evidenceId])
  }
  return result
}

export function scoreEvidenceQuery(query: EvidenceQuery, hits: KnowledgeHit[], mapping: EvidenceMapping, topK: number): QueryEvidenceScore {
  const relevant = query.evidence.map((evidence) => evidence.evidenceId)
  const required = query.evidence.filter((evidence) => evidence.required).map((evidence) => evidence.evidenceId)
  const relevantSet = new Set(relevant)
  const requiredSet = new Set(required)
  const coverage = coverageByChunk(mapping)
  const retrievedEvidenceIds: string[] = []
  const retrievedSet = new Set<string>()
  let firstRequiredRank: number | undefined
  for (const [index, hit] of hits.slice(0, topK).entries()) {
    const evidenceIds = coverage.get(hit.chunkId) ?? []
    if (firstRequiredRank === undefined && evidenceIds.some((id) => requiredSet.has(id))) firstRequiredRank = index + 1
    for (const evidenceId of evidenceIds) {
      if (relevantSet.has(evidenceId) && !retrievedSet.has(evidenceId)) {
        retrievedSet.add(evidenceId)
        retrievedEvidenceIds.push(evidenceId)
      }
    }
  }
  const mappedRequired = required.filter((id) => (mapping.get(id)?.size ?? 0) > 0)
  const retrievedRequired = required.filter((id) => retrievedSet.has(id))
  return {
    id: query.id,
    category: query.category,
    query: query.query,
    evidenceRecall: relevant.length === 0 ? 0 : retrievedSet.size / relevant.length,
    requiredEvidenceRecall: required.length === 0 ? 0 : retrievedRequired.length / required.length,
    requiredEvidenceMrr: mappedRequired.length === 0 || firstRequiredRank === undefined ? 0 : 1 / firstRequiredRank,
    retrievedEvidenceIds,
    unmappedEvidenceIds: relevant.filter((id) => (mapping.get(id)?.size ?? 0) === 0),
  }
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

export function buildRetrievalEvaluationReport(input: {
  benchmark: string
  dataset: EvidenceDataset
  scores: QueryEvidenceScore[]
  mapping: EvidenceMapping
  parentChunks: number
  childChunks: number
  generatedAt: string
}): RetrievalEvaluationReport {
  const evidence = input.dataset.queries.flatMap((query) => query.evidence)
  const unmapped = evidence
    .filter((item) => (input.mapping.get(item.evidenceId)?.size ?? 0) === 0)
    .map((item) => ({
      evidenceId: item.evidenceId,
      document: item.document,
      required: item.required,
      anchor: item.anchor,
    }))

  return {
    benchmark: input.benchmark,
    mode: 'real_embedding',
    generatedAt: input.generatedAt,
    dataset: {
      version: input.dataset.version,
      description: input.dataset.description,
      topK: input.dataset.topK,
      corpus: input.dataset.corpus.map(({ alias, file, sha256 }) => ({ alias, file, sha256 })),
    },
    model: {
      id: BGE_SMALL_ZH_MODEL_ID,
      localOnly: true,
    },
    chunking: {
      parentMaxChars: PARENT_MAX_CHARS,
      parentOverlapChars: PARENT_OVERLAP_CHARS,
      childMaxChars: CHILD_MAX_CHARS,
      childOverlapChars: CHILD_OVERLAP_CHARS,
    },
    hybrid: HYBRID_DEFAULTS,
    corpus: {
      parentChunks: input.parentChunks,
      childChunks: input.childChunks,
    },
    evidence: {
      total: evidence.length,
      required: evidence.filter((item) => item.required).length,
      mapped: evidence.length - unmapped.length,
      mappingSuccessRate: round((evidence.length - unmapped.length) / evidence.length),
      unmapped,
    },
    metrics: {
      evidenceRecallAtK: round(average(input.scores.map((score) => score.evidenceRecall))),
      requiredEvidenceRecallAtK: round(average(input.scores.map((score) => score.requiredEvidenceRecall))),
      requiredEvidenceMrrAtK: round(average(input.scores.map((score) => score.requiredEvidenceMrr))),
    },
    perQuery: input.scores.map((score) => ({
      ...score,
      evidenceRecallAtK: score.evidenceRecall,
      requiredEvidenceRecallAtK: score.requiredEvidenceRecall,
      requiredEvidenceMrrAtK: score.requiredEvidenceMrr,
    })),
  }
}

export async function writeRetrievalEvaluationReport(
  reportPath: string,
  report: RetrievalEvaluationReport,
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
