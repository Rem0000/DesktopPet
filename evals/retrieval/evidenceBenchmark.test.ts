import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRetrievalEvaluationReport,
  loadEvidenceDataset,
  loadFrozenSources,
  mapEvidenceToChunks,
  sha256,
  normalizeEvidenceText,
  scoreEvidenceQuery,
  type EvidenceDataset,
} from './evidenceBenchmark'

const dataset: EvidenceDataset = {
  version: 1,
  description: 'test',
  topK: 10,
  corpus: [{ alias: 'doc', file: 'doc.md', sha256: 'unused' }],
  queries: [
    {
      id: 'q1',
      query: '问题',
      category: 'test',
      evidence: [
        { evidenceId: 'e1', document: 'doc', headingPath: [], anchor: '核心 证据', relevance: 3, required: true },
        { evidenceId: 'e2', document: 'doc', headingPath: [], anchor: '补充证据', relevance: 1, required: false },
      ],
    },
  ],
}

describe('source-evidence benchmark helpers', () => {
  it('规范化换行与空白，严格以单个 chunk 的完整 anchor 映射 evidence', () => {
    expect(normalizeEvidenceText('核心\r\n  证据')).toBe('核心 证据')
    const mapping = mapEvidenceToChunks(
      dataset,
      [
        { chunkId: 'doc:0', documentId: 'runtime-doc', title: 'doc', content: '前文\n核心  证据\n后文', headingPath: [], startOffset: 0, endOffset: 10 },
        { chunkId: 'doc:1', documentId: 'runtime-doc', title: 'doc', content: '核心 证据 与 补充证据', headingPath: [], startOffset: 0, endOffset: 10 },
        { chunkId: 'doc:2', documentId: 'runtime-doc', title: 'doc', content: '补充', headingPath: [], startOffset: 0, endOffset: 10 },
      ],
      new Map([['doc', 'runtime-doc']]),
    )
    expect(mapping.get('e1')).toEqual(new Set(['doc:0', 'doc:1']))
    expect(mapping.get('e2')).toEqual(new Set(['doc:1']))
  })

  it('按 evidence 去重计算 Recall，并以首个 required evidence 计算 MRR', () => {
    const mapping = new Map<string, Set<string>>([
      ['e1', new Set(['doc:0', 'doc:1'])],
      ['e2', new Set(['doc:2'])],
    ])
    const score = scoreEvidenceQuery(
      dataset.queries[0]!,
      [
        { chunkId: 'doc:0', documentId: 'runtime-doc', title: 'doc', sourceName: 'doc', content: '', headingPath: [], score: 1 },
        { chunkId: 'doc:1', documentId: 'runtime-doc', title: 'doc', sourceName: 'doc', content: '', headingPath: [], score: 0.9 },
        { chunkId: 'doc:2', documentId: 'runtime-doc', title: 'doc', sourceName: 'doc', content: '', headingPath: [], score: 0.8 },
      ],
      mapping,
      10,
    )
    expect(score.retrievedEvidenceIds).toEqual(['e1', 'e2'])
    expect(score.evidenceRecall).toBe(1)
    expect(score.requiredEvidenceRecall).toBe(1)
    expect(score.requiredEvidenceMrr).toBe(1)
  })

  it('拒绝 hash 漂移的冻结语料', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-evidence-test-'))
    const source = '原始内容'
    const invalidDataset: EvidenceDataset = {
      ...dataset,
      corpus: [{ alias: 'doc', file: 'doc.md', sha256: sha256(source) }],
      queries: [{
        ...dataset.queries[0]!,
        evidence: [{ ...dataset.queries[0]!.evidence[0]!, anchor: source }],
      }],
    }
    try {
      await writeFile(path.join(directory, 'doc.md'), `${source}已漂移`, 'utf8')
      await expect(loadFrozenSources(invalidDataset, directory)).rejects.toThrow('语料快照 hash 不匹配')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('拒绝格式非法的数据集、重复 evidence id 与重复 anchor', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-evidence-invalid-'))
    try {
      await writeFile(path.join(directory, 'invalid.json'), JSON.stringify({ ...dataset, topK: 0 }), 'utf8')
      await expect(loadEvidenceDataset(path.join(directory, 'invalid.json'))).rejects.toThrow('topK')

      const source = '唯一证据'
      const duplicatedAnchorDataset: EvidenceDataset = {
        ...dataset,
        corpus: [{ alias: 'doc', file: 'doc.md', sha256: sha256(source) }],
        queries: [{
          ...dataset.queries[0]!,
          evidence: [
            { ...dataset.queries[0]!.evidence[0]!, anchor: source },
            { ...dataset.queries[0]!.evidence[1]!, anchor: source },
          ],
        }],
      }
      await writeFile(path.join(directory, 'doc.md'), source, 'utf8')
      await expect(loadFrozenSources(duplicatedAnchorDataset, directory)).rejects.toThrow('同一文档重复')

      const duplicateEvidenceIdDataset: EvidenceDataset = {
        ...dataset,
        corpus: [{ alias: 'doc', file: 'doc.md', sha256: sha256('unused') }],
        queries: [{
          ...dataset.queries[0]!,
          evidence: [
            dataset.queries[0]!.evidence[0]!,
            { ...dataset.queries[0]!.evidence[1]!, evidenceId: 'e1' },
          ],
        }],
      }
      await writeFile(path.join(directory, 'duplicate-id.json'), JSON.stringify(duplicateEvidenceIdDataset), 'utf8')
      await expect(loadEvidenceDataset(path.join(directory, 'duplicate-id.json'))).rejects.toThrow('evidence id')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('未映射 evidence 保留在 Recall 分母，且不会获得 MRR credit', async () => {
    const score = scoreEvidenceQuery(
      dataset.queries[0]!,
      [{ chunkId: 'doc:2', documentId: 'runtime-doc', title: 'doc', sourceName: 'doc', content: '', headingPath: [], score: 1 }],
      new Map([
        ['e1', new Set()],
        ['e2', new Set(['doc:2'])],
      ]),
      10,
    )
    expect(score.evidenceRecall).toBe(0.5)
    expect(score.requiredEvidenceRecall).toBe(0)
    expect(score.requiredEvidenceMrr).toBe(0)
    expect(score.unmappedEvidenceIds).toEqual(['e1'])
  })

  it('生成包含模型、切分、索引与逐查询诊断的机器可读报告', () => {
    const score = scoreEvidenceQuery(
      dataset.queries[0]!,
      [{ chunkId: 'doc:0', documentId: 'runtime-doc', title: 'doc', sourceName: 'doc', content: '', headingPath: [], score: 1 }],
      new Map([
        ['e1', new Set(['doc:0'])],
        ['e2', new Set()],
      ]),
      dataset.topK,
    )
    const report = buildRetrievalEvaluationReport({
      benchmark: 'parent-child-rag.v1',
      dataset,
      scores: [score],
      mapping: new Map([
        ['e1', new Set(['doc:0'])],
        ['e2', new Set()],
      ]),
      parentChunks: 2,
      childChunks: 4,
      generatedAt: '2026-08-25T00:00:00.000Z',
    })
    expect(report.mode).toBe('real_embedding')
    expect(report.model.localOnly).toBe(true)
    expect(report.chunking.childMaxChars).toBeGreaterThan(0)
    expect(report.hybrid.alpha).toBeGreaterThan(0)
    expect(report.corpus).toEqual({ parentChunks: 2, childChunks: 4 })
    expect(report.evidence.unmapped.map((item) => item.evidenceId)).toEqual(['e2'])
    expect(report.metrics.requiredEvidenceMrrAtK).toBe(1)
    expect(report.perQuery[0]?.requiredEvidenceRecallAtK).toBe(1)
  })
})
