import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tokenizeForBm25 } from './tokenize'

export type Bm25Document = {
  id: string
  text: string
}

export type Bm25Hit = {
  id: string
  score: number
}

const K1 = 1.2
const B = 0.75

export class Bm25Index {
  private documents = new Map<string, string>()
  private docLengths = new Map<string, number>()
  private termFreqs = new Map<string, Map<string, number>>()
  private docFreqs = new Map<string, number>()
  private avgDocLength = 0

  build(docs: Bm25Document[]): void {
    this.documents.clear()
    this.docLengths.clear()
    this.termFreqs.clear()
    this.docFreqs.clear()

    let totalLength = 0
    for (const doc of docs) {
      const terms = tokenizeForBm25(doc.text)
      this.documents.set(doc.id, doc.text)
      this.docLengths.set(doc.id, terms.length)
      totalLength += terms.length

      const freq = new Map<string, number>()
      for (const term of terms) {
        freq.set(term, (freq.get(term) ?? 0) + 1)
      }
      this.termFreqs.set(doc.id, freq)
      for (const term of new Set(terms)) {
        this.docFreqs.set(term, (this.docFreqs.get(term) ?? 0) + 1)
      }
    }
    this.avgDocLength = docs.length === 0 ? 0 : totalLength / docs.length
  }

  search(query: string, topK = 20): Bm25Hit[] {
    const terms = tokenizeForBm25(query)
    if (terms.length === 0 || this.documents.size === 0) return []

    const n = this.documents.size
    const scores = new Map<string, number>()

    for (const [docId] of this.documents) {
      const docLength = this.docLengths.get(docId) ?? 0
      const freqMap = this.termFreqs.get(docId) ?? new Map<string, number>()
      let score = 0
      for (const term of terms) {
        const tf = freqMap.get(term) ?? 0
        if (tf === 0) continue
        const df = this.docFreqs.get(term) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        const numerator = tf * (K1 + 1)
        const denominator = tf + K1 * (1 - B + (B * docLength) / (this.avgDocLength || 1))
        score += idf * (numerator / denominator)
      }
      if (score > 0) scores.set(docId, score)
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  hasDocument(id: string): boolean {
    return this.documents.has(id)
  }
}

export type PersistedBm25Index = {
  version: 1
  documents: Array<{ id: string; text: string }>
}

export async function loadBm25Index(filePath: string): Promise<Bm25Index | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as PersistedBm25Index
    if (parsed?.version !== 1 || !Array.isArray(parsed.documents)) return null
    const index = new Bm25Index()
    index.build(parsed.documents)
    return index
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    return null
  }
}

export async function persistBm25Index(
  filePath: string,
  _index: Bm25Index,
  documents: Bm25Document[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const payload: PersistedBm25Index = { version: 1, documents }
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(payload), 'utf8')
  await rename(temporaryPath, filePath)
}
