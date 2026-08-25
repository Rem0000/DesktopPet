# Delta: Source-evidence retrieval benchmark

## ADDED Requirements

### Requirement: Versioned frozen source corpus

The system SHALL store each document-relevance benchmark corpus as tracked source fixtures with a versioned dataset manifest. Each manifest entry SHALL include a logical document alias, fixture path, and SHA-256 hash.

Before building the evaluation index, the evaluator SHALL verify every fixture hash and SHALL fail rather than run against a changed source document.

#### Scenario: Fixture content drifts

- **WHEN** a corpus fixture no longer matches its manifest SHA-256 hash
- **THEN** the evaluator fails before importing documents or calculating metrics

### Requirement: Chunker-independent evidence labels

The document-relevance dataset SHALL label expected content as source-level evidence, not `chunkId`, chunk index, or a runtime document UUID. Each evidence item SHALL provide a stable ID, source document alias, heading path, verbatim anchor, positive relevance grade, and required flag.

Each anchor SHALL occur exactly once in the normalized text of its referenced source fixture.

#### Scenario: Replacing the chunker

- **WHEN** the production Markdown chunker changes while the frozen corpus and evidence dataset remain unchanged
- **THEN** the evaluator derives the current evidence-to-chunk mapping dynamically and does not require a rewritten qrel dataset

### Requirement: Strict evidence-to-chunk mapping

The evaluator SHALL normalize line endings and whitespace consistently for source-anchor and chunk-anchor comparisons. An evidence item SHALL map to every chunk from its referenced source document whose normalized content completely contains its normalized anchor.

The evaluator SHALL NOT join adjacent chunks, truncate anchors, or rewrite labels to accommodate a changed chunk boundary.

#### Scenario: Anchor crosses a chunk boundary

- **WHEN** no single current chunk fully contains an evidence anchor
- **THEN** the evidence is reported as unmapped
- **AND** it remains in Recall denominators
- **AND** it cannot receive MRR credit

### Requirement: Evidence-level retrieval metrics

The evaluator SHALL translate ranked chunk hits into unique evidence IDs before scoring, so overlapping chunks cannot inflate coverage. For the dataset's fixed top-K, it SHALL report macro-averaged Evidence Recall, Required Evidence Recall, and Required Evidence MRR.

Evidence Recall SHALL use all labeled evidence as its denominator. Required Evidence Recall SHALL use all required evidence as its denominator. Required Evidence MRR SHALL be the reciprocal rank of the first retrieved hit covering a mapped required evidence, or zero if none exists.

#### Scenario: Overlapping chunks cover one anchor

- **WHEN** multiple returned chunks map to the same evidence item
- **THEN** that evidence contributes once to Recall coverage

### Requirement: Comparable real retrieval execution

The document-relevance benchmark SHALL import the frozen fixtures through the production `KnowledgeStore.importText()` and retrieve through `KnowledgeStore.search()`. The real embedding model, retrieval configuration, frozen corpus, dataset, and top-K SHALL remain unchanged across a chunker A/B comparison.

The real benchmark SHALL be gated behind `npm run eval:retrieval:kb`; ordinary unit-test execution SHALL skip the expensive real-model run. ANN approximation evaluation SHALL remain separate from document-relevance evaluation.

#### Scenario: Ordinary test run

- **WHEN** the normal test suite runs without the retrieval benchmark npm lifecycle command
- **THEN** the real BGE benchmark is skipped

### Requirement: Evidence diagnostics for faithfulness evaluation

The real-KB faithfulness evaluator SHALL use the same frozen source corpus and source-evidence dataset for retrieval diagnostics. It SHALL retain actual `KnowledgeStore.search()` hits as generation context and SHALL not derive qrels from chunk suffixes.

#### Scenario: Faithfulness retrieval diagnostics

- **WHEN** the real-KB faithfulness evaluation runs on the frozen corpus
- **THEN** its retrieval diagnostics are calculated from dynamic evidence coverage
- **AND** no dependency on legacy chunk-index datasets exists
