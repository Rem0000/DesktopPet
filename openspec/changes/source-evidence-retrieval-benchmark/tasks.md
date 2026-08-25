# Tasks: source-evidence retrieval benchmark

## 1. Dataset and fixtures

- [x] 1.1 Freeze the four source documents in `evals/retrieval/corpus/` and record their SHA-256 values.
- [x] 1.2 Create the versioned 64-query, 88-evidence `knowledge-evidence.v1.json` dataset.
- [x] 1.3 Validate unique anchor occurrence and strict current-chunker mappings for the baseline corpus.

## 2. Evaluation implementation

- [x] 2.1 Add reusable source loading, integrity validation, anchor mapping, and evidence scoring helpers.
- [x] 2.2 Add focused tests for normalization, mapping, deduplication, Recall, and MRR semantics.
- [x] 2.3 Expose the current `KnowledgeStore` chunks through a read-only snapshot API for evaluators.
- [x] 2.4 Replace the real retrieval runner with the gated frozen-corpus evidence benchmark.
- [x] 2.5 Remove chunk-ID-bound datasets, generator, runner, metrics helper, and npm commands.
- [x] 2.6 Migrate real-KB faithfulness retrieval diagnostics to the shared evidence dataset.

## 3. Documentation and specification

- [x] 3.1 Document the source-evidence contract, metric semantics, and reproducibility constraints.
- [x] 3.2 Update current command and benchmark documentation.
- [x] 3.3 Add the 2026-08-25 worklog entry after final verification.

## 4. Verification

- [x] 4.1 Run focused helper/store/runner tests.
- [x] 4.2 Run `npm run typecheck`.
- [x] 4.3 Run `npm test` (the retrieval migration passes its focused suite; the full suite is blocked by the pre-existing missing `evals/judge/scenarios.json` fixture, unrelated to this change).
- [x] 4.4 Run `npm run eval:retrieval:kb` with local BGE weights and record the current-chunker baseline.
