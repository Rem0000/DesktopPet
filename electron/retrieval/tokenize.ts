const CJK = /[\u3400-\u9fff]/u

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2)
}

function addCjkNgrams(text: string, out: Set<string>): void {
  const chars = [...text].filter((char) => CJK.test(char))
  for (let n = 2; n <= 3; n += 1) {
    for (let index = 0; index + n <= chars.length; index += 1) {
      out.add(chars.slice(index, index + n).join(''))
    }
  }
}

/** 空格分词 + 中文 2/3 字滑动窗口 */
export function extractSearchTerms(text: string): string[] {
  const normalized = text.toLowerCase().trim()
  if (!normalized) return []
  const terms = new Set<string>()
  for (const token of tokenizeWords(normalized)) {
    terms.add(token)
    addCjkNgrams(token, terms)
  }
  for (const run of normalized.match(/[\u3400-\u9fff]+/gu) ?? []) {
    if (run.length >= 2) terms.add(run)
    addCjkNgrams(run, terms)
  }
  return [...terms]
}

export function tokenizeForBm25(text: string): string[] {
  return extractSearchTerms(text)
}
