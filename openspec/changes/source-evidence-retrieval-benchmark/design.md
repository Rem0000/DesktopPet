# Design: source-evidence retrieval benchmark

## Dataset contract

`evals/retrieval/knowledge-evidence.v1.json` contains a version, fixed `topK`, corpus manifest, and queries. Each evidence item has a stable `evidenceId`, source document alias, expected `headingPath`, verbatim `anchor`, positive `relevance`, and `required` flag. The source files under `evals/retrieval/corpus/` are the benchmark corpus; their SHA-256 hashes are checked before indexing.

## Mapping

The evaluator normalizes CRLF/CR line endings and collapses whitespace for comparison. An evidence item maps to every current chunk from its source document whose normalized `content` contains the complete normalized anchor. The evaluator never joins adjacent chunks and never rewrites an anchor to follow a chunk boundary. A zero mapping is reported as a corpus/chunker diagnostic.

## Metrics

For each query, ranked hits are translated to unique evidence IDs, so overlapping chunks cannot inflate coverage. `evidenceRecallAt10` divides covered evidence by all evidence, including unmapped items. `requiredEvidenceRecallAt10` divides covered required evidence by all required evidence, also including unmapped items. `requiredEvidenceMrrAt10` is the reciprocal rank of the first top-K hit covering a mapped required evidence; no mapped required evidence or no hit yields zero.

Metrics are macro-averaged across all 64 queries. The report includes corpus hashes, chunk count, mapping success rate, unmapped evidence details, aggregate metrics, and per-query scores.

## Reproducibility

The comparison keeps the dataset, frozen source files, embedding model, retrieval configuration, and `topK` unchanged. Only the chunker may change between runs. The real-BGE runner is gated behind `npm run eval:retrieval:kb`; ordinary test runs skip the expensive benchmark. ANN approximation remains a separate evaluation.

## Faithfulness integration

The real-KB faithfulness evaluator imports the same frozen corpus and maps the same evidence labels. Its generation context remains the actual `KnowledgeStore.search()` output; retrieval diagnostics use evidence-level Recall/MRR rather than chunk suffix qrels.