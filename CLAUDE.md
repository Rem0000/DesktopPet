# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

DesktopPet is a Windows transparent always-on-top desktop pet (Electron + React + Pixi/Live2D) with a DeepSeek-powered chat agent and a separate "novel writing studio". The chat agent runs in the **main process** (LangGraph), not the renderer. UI copy and code comments are predominantly Simplified Chinese — match that when adding user-visible strings.

Source conventions: runtime **contracts shared between main and renderer live under `src/chat/contracts.ts` and `src/novel/contracts.ts`** and are imported by both sides. Main-process logic lives in `electron/`. UI lives in `src/<feature>/` with one React entry per window.

## Commands

```bash
npm install           # .npmrc pins electron binaries to the npmmirror (China mirror)
npm run dev           # Vite dev server + Electron (main + preload built by vite-plugin-electron)
npm run typecheck     # tsc for both tsconfig.json and tsconfig.node.json
npm test              # vitest run (electron/, src/, evals/ *.test.ts)
npm test -- <file>    # run a single test file (e.g. npm test -- electron/chat/agentRuntime.test.ts)
npm run eval:retrieval       # retrieval IR eval (P@4/R@4/MRR@10), mock embedding (fast)
npm run eval:retrieval:real  # same eval with real BGE weights (needs data/models)
npm run build         # tsc -p tsconfig.node.json --noEmit && vite build
npm run pack          # build + electron-builder --dir → release/ (unpacked, for local verify)
npm run dist          # build + electron-builder → NSIS installer + dir
```

`vitest.config.ts` is the test config; run individual suites directly with `npm test -- <path>`.

## Architecture

### Windows and IPC

Four BrowserWindows are created in `electron/main.ts`: the transparent pet window, the Live2D library manager, the chat window, and the novel studio window. All renderers share **one** preload (`electron/preload.ts`) that exposes a typed `window.api` via `contextBridge`; `contextIsolation: true`, `nodeIntegration: false`.

IPC channels are namespaced `domain:action` (`live2d:*`, `chat:*`, `memory:*`, `reminders:*`, `tools:*`, `knowledge:*`, `retrieval:*`, `novel:*`, `pet:*`, `window:*`). Handlers are registered in `initializeChatController` (`electron/chat/chatController.ts`) and `initializeNovelController` (`electron/novel/novelController.ts`), both called from `app.whenReady()`. **All IPC inputs are validated by `require*` helpers before use** — follow that pattern for new handlers. Streaming replies use `event.sender.send('chat:stream' | 'novel:stream', ...)` with a requestId/sessionId envelope; cancellation uses AbortController keyed by sender webContents id.

### Chat agent (LangGraph)

`electron/chat/agentRuntime.ts` compiles a `StateGraph`: `normalize → recall → plan → toolBoundary → maybeReplan → model → commit`.

- `normalize`: trims context to a char budget (default 24k).
- `recall`: `MemoryService.assemble` injects cross-model shared profile/facts + the active Live2D package persona (or `DEFAULT_SYSTEM_PROMPT`) + session summary.
- `plan`: asks the provider (`DeepSeekProvider.planToolCalls`) to propose tool calls from the enabled tools; dedupes and filters already-succeeded memory writes.
- `toolBoundary`: executes each pending tool (with input validation, confirm gate, and `ToolBoundaryEvent` observability for `data/traces/`).
- `maybeReplan`: **only** replans when the round used a retrieval tool (`search_knowledge`). Bounds: `MAX_TOOL_ROUNDS = 2`, `MAX_TOOL_CALLS = 6`.
- `model`: streams the final reply; tool results are re-formatted back into the prompt via `formatToolResultsForModel`, which enforces hard Chinese constraints (e.g. the model MUST NOT claim a memory was written if no tool succeeded).

### Tool registry pattern (how to add a tool)

`electron/chat/toolRegistry.ts` defines `ToolRegistry` and the shared `defaultToolRegistry` singleton. A tool has `{ name, description, parameters (JSON schema), enabled, riskLevel: 'safe' | 'confirm', validate, execute }`. Services register their own tools with `registerDefaultTools()`: memory (`update_profile`, `remember_fact`, `forget_memory` — note `remember_preference` is intentionally removed), reminders (`schedule_reminder`, `cancel_reminder`), knowledge (`search_knowledge`). Enabled state can be overridden per-tool by JSON in `data/config/` (loaded via `loadToolConfigOverrides`). `riskLevel: 'confirm'` tools block on a user dialog through the `chat:tool-confirm` IPC (60s timeout). Only enabled tools with `parameters` appear in the planning set (`listForPlanning`).

### Retrieval (BM25 + BGE vector + RRF)

`electron/retrieval/` implements hybrid search: BM25 (sparse) + BGE-Small-ZH-v1.5 embeddings (via `@xenova/transformers` + onnxruntime-node) fused with reciprocal rank fusion and a `alpha·sparse + beta·vector + gamma·metadataBoost` score. The same engine backs memory recall, knowledge RAG, and per-novel-book indexes.

Embedding model weights must be at `data/models/bge-small-zh-v1.5/` (config.json + tokenizer + quantized onnx). **There is no keyword-only fallback** — if the model fails to load, retrieval errors rather than degrading. `npm run eval:retrieval:real` is the only eval that exercises the true vector path; the default uses mock embeddings.

### Novel writing studio

`electron/novel/` + `src/novel/`. Per book, a `NovelStoryStore` writes JSON entities to `data/novels/<bookId>/` (meta, outline, relationships, knowledge, timeline, promises, canon, divergences) plus accepted chapters as `ch-###.md`. This is a **narrative state machine**, not chat:

1. **Outline workflow**: generate / revise outline cards (LLM returns JSON, normalized defensively — `normalizeOutline`, `extractJsonObject`, `normalizeStateDiff` all guard against sloppy LLM shapes).
2. **Chapter workflow** (`novelRuntime.ts`): `assemble` (fixed block: premise/style/POV/promises/hook/voice samples + retrieval block from the per-book hybrid index) → `draft` (streamed) → **StateDiff extraction** (LLM, editable by user) → **Continuity Guard** (`runContinuityGuard`: dead-character, knowledge-leak, early-payoff, timeline, divergence warnings) → **human Accept / Reject / Revise**.
3. **Accept is the only gate that mutates Canon**: it commits the draft, applies the confirmed StateDiff, regenerates summaries, and rebuilds the per-book index. Drafts never touch Canon. Reject leaves everything unchanged.

Novel data is **strictly isolated** from chat memory/knowledge: accepted chapters are not written into chat memory and chat recall never reads novel bodies. Do not couple them.

### Data layout

All runtime data defaults to `<projectRoot>/data/` (gitignored), resolved by `electron/projectPaths.ts`. Overridable via `DESKTOP_PET_DATA`, `DESKTOP_PET_LAYER_PACKS`, or `DESKTOP_PET_USE_USER_DATA=1` (legacy Electron userData). Subpaths: `chat/`, `memory/` (JSON + vector index), `knowledge/`, `novels/<bookId>/`, `traces/` (tool-call JSONL), `logs/`, `models/` (BGE weights), `reminders/`, `config/`. The pet's own persona lives per Live2D package (`readPackagePersona`/`writePackagePersona` in `electron/live2dLibrary.ts`).

### Live2D

Cubism 2/4 runtime cores ship in `public/live2d/` (served via the custom `pet-asset://` protocol, `electron/petAssetProtocol.ts`). Imported model packages are cached under `layer-packs/live2d-models/<import-timestamp>/`; `electron/live2dBind.ts` scans/copies a model folder on import and `electron/live2dLibrary.ts` manages the library + persona. The pet window renders via `src/pet/PetStage.tsx` + `src/live2d/Live2DView.tsx` (Pixi.js).

## Working practices

- **Spec-driven development (OpenSpec).** Canonical requirements live in `openspec/specs/<subsystem>/spec.md` (the `pet-agent-runtime`, `agent-memory`, `hybrid-retrieval`, `local-rag`, and `novel-*` specs are the best architecture references). Feature work goes through `openspec/changes/<change>/` (proposal → design → specs → tasks), archived when done. The `.cursor/` commands/skills (`opsx-propose`, `opsx-apply`, etc.) wrap this workflow — follow the same rhythm. `highlight_resume_pet.md` summarizes current deliverables and eval status.
- **Daily worklog.** At the end of each work session, create or append `docs/worklog/YYYY-MM-DD.md` recording what changed that day (features/fixes, evals, decisions, pending items), kept in sync with `highlight_resume_pet.md`'s 维护记录. This is the per-day audit trail for the interview prep story.
- **Behavioral requirements are enforced in prompt constraints.** Hard rules about what the model may claim (e.g. no fake memory-write success, remember-intent routing to persona vs `remember_fact`) are encoded as Chinese instructions in `agentRuntime.ts` and covered by eval scenarios in `evals/`.
- **Secrets.** API keys are held only in the main process (`safeStorage` when possible), never round-tripped to the renderer or written to chat logs. Do not introduce VITE_-exposed env secrets.
- **Packaging gotchas.** Native modules (`@xenova/transformers`, `onnxruntime-node`, `onnxruntime-common`, `sharp`) are marked `external` in the electron main build (`vite.config.ts`) and loaded from `node_modules` at runtime; they are `asarUnpack`ed in `electron-builder`. `sharp` is overridden to a local stub (`stubs/sharp`, plus `electron/retrieval/sharpStub.ts`) — it is not the real library. Don't add new `sharp`-style native deps without handling the same external/unpack/stub story.
- **Tests.** Vitest in `node` env; colocate `*.test.ts` (and `*.test.tsx` for components) next to source. `electron/retrieval/testHelpers.ts` provides fixtures. The eval suite (`evals/run.eval.test.ts`, `evals/run.retrieval.eval.test.ts`, `evals/scenarios.json`) asserts agent/tool/memory/RAG behavior and currently passes 37/37.
