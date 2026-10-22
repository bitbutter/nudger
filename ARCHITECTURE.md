# nudger architecture

## Shape

nudger is a single-page static app: React 18 + TypeScript + Vite, Dexie for IndexedDB. There is no server, no API route, no proxy, and no runtime configuration from the environment. `npm run build` produces a `dist/` directory that can be hosted anywhere static. Hash routing (`#/doc/:id`, `#/doc/:id/files`, `#/templates`, `#/settings`) works from a GitHub Pages subpath without rewrites.

The local database is the source of truth. IndexedDB (`nudger`) holds seven tables: `documents`, `versions`, `files`, `nudgers`, `replies`, `templates`, `settings`. Reference files belong to one nudger (`files.nudgerId`, `null` for the unassigned leftovers of a migration), and every nudger carries its document's `documentId`, so prompts, files, budget and auto-run never leak into another document; templates are the only cross-document artifact. Database version 2 gives nudgers that column and migrates version 1 data: each global nudger is copied into every existing document and replies are rewired to the copy for their document. Version 3 does the same for the old shared file library: each file is copied into every document, nudger and reply `fileIds` are pointed at the copies, and a legacy file with no document to own it is dropped (`src/lib/migrate.ts`). Version 4 moves the default layout to the split view. Version 5 makes files nudger-owned: a file attached to several nudgers becomes one independent copy per nudger (replies are rewired to their nudger's copy) and a file no nudger attaches stays in its document with `nudgerId: null`, shown as unassigned rather than deleted. `planFileOwnershipMigration` is shared by the upgrade and the importer, so old exports and old databases converge on the same shape. With no documents, nudger configuration is preserved as custom templates instead of being dropped. The API key is deliberately outside the database: `sessionStorage` by default, `localStorage` when the user opts in.

## Module map

| Area | Files |
| --- | --- |
| Types | `src/types.ts` |
| IndexedDB schema and store | `src/lib/db.ts`, `src/lib/storage.ts` |
| Defaults and starter library | `src/lib/defaults.ts`, `src/lib/starters.ts` |
| Placeholder resolution | `src/lib/placeholders.ts` |
| Fact-clue protocol and parsing | `src/lib/facts.ts`, `src/components/FactsFields.tsx` |
| File wrappers, validation, upload names | `src/lib/referenceFiles.ts` |
| Provider adapters and errors | `src/lib/providers.ts`, `src/lib/errors.ts` |
| Run preparation, execution, retries | `src/lib/run.ts` |
| Concurrency and per-nudger run state | `src/lib/runManager.ts` |
| Export validation and filenames | `src/lib/exportImport.ts` |
| Key storage | `src/lib/keyStore.ts` |
| Hash routing | `src/lib/hashRoute.ts` |
| Autosave | `src/hooks/useDraft.ts`, `src/hooks/useAutoSave.ts` |
| Auto-run trigger | `src/lib/autoRunTrigger.ts` |
| Draft column width preference | `src/lib/editorWidth.ts` |
| App shell and orchestration | `src/App.tsx` |
| UI | `src/components/*.tsx`, `src/styles.css` |
| Tests | `src/test/*.test.ts` |

`storage.ts` is a store factory (`createStore(database)`) so tests can create an isolated fake-indexeddb database; the app uses a module-level singleton. UI components never talk to Dexie directly except through `useLiveQuery` against store methods.

The document page is a draggable split on wide screens (default layout `side`): the draft column is a fixed pixel width taken from `localStorage` (`nudger.editorWidth`, clamped to at least 320 px and to leave 320 px plus the 24 px handle for nudgers) and the nudger board takes the rest. Dragging, arrow keys on the handle and double-click reset all write that preference; nothing about it touches IndexedDB. Nudgers themselves lay out with `repeat(auto-fill, minmax(300px, 1fr))`, so they fill left to right in as many columns as the board is wide.

Reference files have no page of their own. The **n files** chip on a nudger card opens `src/components/FilesPanel.tsx` for that nudger beneath the editor and board; the `#/doc/:id/nudger/:nudgerId/files` route is the same document page with that panel open, so reload and back/forward keep the right draft and nudger on screen. Files with no owner are listed in an **Unassigned files** section of the document page, where they can be attached to a nudger or deleted. `prepareRun` re-checks `file.nudgerId === nudger.id` before resolving anything, so a stale id cannot pull another nudger's material into a prompt.

## Data flow

1. `App` subscribes to documents, nudgers, files, templates, settings, version counts, and the active document's replies and versions with Dexie live queries. DB writes therefore update the UI without manual refetching.
2. The active draft text is local React state (`useDraft`). Every change schedules a 450 ms IndexedDB write. Changing documents flushes the previous draft first. A draft is also flushed before Save version, Restore, Duplicate, Export, Delete and Import, so operations never read a stale database copy.
3. A run snapshots the current in-memory text, the caret (`selectionStart`/`selectionEnd`), the document title, the open document's files and the settings, then calls `prepareRun`. Resolution happens at that moment, not when the prompt was saved.
4. `prepareRun` resolves the system and user prompts, handles file insertion/auto-append, collects blocking/warning issues, computes characters and estimated tokens, and checks `maxContextChars`. The fixed two-short-sentences rule (`REPLY_LENGTH_RULE`) is appended to every system prompt, and when the nudger's `facts` flag is on the fixed fact-clue JSON protocol is appended after it (the focus text comes from `factsPrompt`). Both are fixed costs that trimming reserves. It returns a `PreparedRun` containing the exact text, files to send, issues and the provider configuration.
5. `createAutoRunTrigger` owns the auto-run timing: it arms a cooldown after each keystroke and fires only once the cooldown has elapsed **and** a `pointermove` has arrived since that keystroke, so a resting mouse never recalculates. Manual Run and Run all bypass it and send eligible prepared jobs to `RunManager`. The manager guarantees one in-flight job per nudger and a configurable global concurrency limit; extras queue. It owns abort controllers and emits per-nudger state (queued/running/retrying/error) scoped by `documentId`.
6. `executeRun` calls the provider adapter, retries 429/5xx with backoff when the wait is short, then parses the response. With facts off the response is the reply. With facts on the response must be `{"reply":"...","facts":[...]}`; `parseStructuredNudge` strips fences/prose, recovers a usable reply if possible, parses and normalizes the fact list (max five, deduped, strings or `{text}` objects), and falls back to plain prose as the reply while recording `factsError`. A JSON-shaped response that cannot be recovered becomes a clear `bad_request` failure with Retry rather than being saved as raw text.
7. The parsed reply is stored through `addReply` with the exact `resolvedPrompt`, sent file ids, provider, model, facts and facts error. Editing sources later cannot rewrite that record. `addReply` refuses to create orphans if the document or nudger was deleted while the model was working.
8. `RunManager` state is filtered to the active document in the UI, so a run in document A cannot show a Cancel button on document B. Deleting a document cancels its jobs; deleting a nudger cancels its job.

## Placeholder resolution

`resolveTemplateText` walks every `{{…}}` token in one pass:

- `before_cursor`, `before_last_word`, `current_paragraph`, `after_cursor`, `full_text`, `selection` read the text and caret snapshot.
- `document_title`, `nudger_name`, `date` are metadata. Scalar names are matched case-insensitively.
- `files` inserts all attached files; `file:NAME` inserts one, matched case-insensitively. A name that exists but is not attached is distinguished from a name that does not exist, and both are blocking.
- Unknown tokens stay literal and produce a warning.

`prepareRun` resolves system and user messages separately, gathers used files across both, and applies the auto-append rule only to the user message. If neither message contains a file placeholder, all attached files are appended under `REFERENCE FILES`; if either does, only the placeholders insert content and every attached file that was not used is reported. Every file is wrapped as reference data with begin/end markers.

Trimming is explicit: `trimPromptMiddle` keeps the start and end of an oversized user prompt, drops the middle with a visible marker, and the preview is recomputed so the user sees exactly what will be sent.

### Reply length and auto-run timing

Every nudge is capped by `REPLY_LENGTH_RULE`: at most two short sentences, no preamble, no lists, no headings, no restating the draft. It is appended to the resolved system prompt at run time rather than stored per nudger, so custom templates and older nudgers obey it without migration, and the rule is visible in the preview. The starter library's own system prompts are written to fit inside it too.

Auto-run is deliberately two-conditioned. `createAutoRunTrigger` starts a cooldown on every keystroke and listens for `pointermove`; the run fires only when the cooldown has passed **and** the pointer moved after that keystroke. Typing and then reading without touching the mouse therefore produces no recalculation; moving the mouse after the pause does.

### Fact clues

Fact clues are a per-nudger option, not a document-wide feature. The system-prompt protocol is fixed; only the focus sentence is stored per nudger (`factsPrompt`). The model returns one JSON object containing both the reply and the facts, so the reply and its clues come from one reading of one request. The protocol requires every clue to relate directly to the nudge in the reply field: a named project should yield its name, stack, release date or version when the material has it, and unrelated material is omitted. The protocol adds roughly 300 tokens; there is no second provider call.

The parser is deliberately layered: JSON object → fenced/prose-wrapped JSON → a reply/facts regex recovery → an old trailing `FACTS:` line fallback → plain prose as the reply with `factsError`. A response that starts like JSON and cannot be recovered fails the run rather than displaying JSON as prose. Facts are labeled model-generated and are never treated as verified. The starter library enables facts for the three fact-oriented roles; custom, style/continuation and Fact checker nudgers default off.

## Provider layer

`resolveProviderConfig` merges a nudger's optional provider/model override with global Settings. A nudger that changes provider but leaves the model empty gets that preset's default model, not the global model. The key is always global.

`callModel` supports two shapes:

- OpenAI-compatible: `POST <base>/chat/completions`, bearer auth, a `messages` array.
- Anthropic: `POST <base>/v1/messages`, `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access: true`, top-level `system` and a user message.

Provider presets contain only endpoints that were verified to answer browser CORS preflight (2026-10-22): DeepSeek, OpenAI, Anthropic, OpenRouter, Groq and Mistral. OpenAI-compatible/custom endpoints are allowed but must send CORS headers. There is no hidden relay: a failing preflight is surfaced as an actionable CORS/network error. Timeouts and user cancellation stay active until the response body is fully read, so a stalled body cannot hang a card.

Errors are typed (`auth`, `rate_limit`, `timeout`, `context`, `cors`, `bad_request`, `server`, `config`, `empty`, `storage`, `cancelled`, `unknown`) with retryability and optional `Retry-After`. The UI shows the provider's message, a Retry action, and a settings shortcut for actionable configuration/auth/CORS cases.

## Autosave and versions

Autosave is a debounced write of `currentText`. Versions are explicit snapshots. Restore is a transaction that snapshots the current text (if different), inserts a new version containing the restored text, and updates the document. Nothing is overwritten. Document duplication copies versions with new ids.

## Import/export

Exports are validated with `validateBundle` before import: schema version, required fields, file extensions, unique ids, per-document unique names, reply statuses, normalized numeric settings. Malformed items are dropped with warnings. The API key is never present in a bundle.

- Merge adds new ids, skips existing ones, and remaps imported file ids to an existing file with the same name in the same document so file placeholders keep resolving.
- Replace clears the seven tables and loads the bundle. It restores provider/model/generation preferences but **not** the exported base URL, custom headers or remember-key choice without explicit consent, because those could redirect the stored key. The import dialog shows the imported endpoint and an opt-in.

## Security and privacy

- No third-party scripts, fonts, analytics or telemetry. The production build injects a meta CSP with `script-src 'self'`; `connect-src https:` is broad only because custom provider endpoints are allowed, plus explicit `http://localhost:*` and `http://127.0.0.1:*` entries for local model servers. This is documented in the README as a deliberate tradeoff. The app itself refuses plain `http://` endpoints on other hosts when the page is served over HTTPS, before any request is made.
- All model output and stored prompts are rendered as text (`white-space: pre-wrap`), never as HTML.
- Keys are masked in UI, kept out of IndexedDB and exports, never logged, and sent only to the configured provider. Loading settings does not silently migrate or delete keys. On a shared origin such as a GitHub Pages project site, other pages under the same host can read localStorage and IndexedDB; the remember-key warning states this.
- Text leaves the browser only on an explicit run/test. The preview shows the resolved request and each saved reply stores it; auto-run sends the same request without opening the preview. Fact clues use the same single request; there is no separate extraction request.

## Testing

Vitest runs in Node with `fake-indexeddb`. Tests cover placeholder semantics, file insertion and auto-append, trimming (including files removed by a trim), version restore, document-bound nudgers and files with their cascades, the version 1 → 2 → 3 database migrations, nudger → template conversion and reuse, storage/CRUD/cascades, import/export safety (including version 1 bundles), provider request shapes, reserved headers, loopback http, response size limits and error classification, retry/cancel, hash routing, key storage, the starter library, the fact protocol/parsing (including malformed JSON and plain-text fallback), and a mocked end-to-end run. Browser checks were performed separately with a production preview and a real DeepSeek key; those scripts are not part of the shipped app.

## Deployment

`vite.config.ts` uses relative asset paths (`base: './'`) and injects the CSP meta only for builds, leaving dev HMR unrestricted. `.github/workflows/deploy.yml` runs install, tests and build, then deploys `dist/` with the official GitHub Pages actions. The repository is expected to be `nudger`, served at `https://bitbutter.github.io/nudger/`; because assets are relative and routing is hash-based, a differently named repository still works.
