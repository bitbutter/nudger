# nudger architecture

## Shape

nudger is a single-page static app: React 18 + TypeScript + Vite, Dexie for IndexedDB. There is no server, no API route, no proxy, and no runtime configuration from the environment. `npm run build` produces a `dist/` directory that can be hosted anywhere static. Hash routing (`#/doc/:id`, `#/files`, `#/templates`, `#/settings`) works from a GitHub Pages subpath without rewrites.

The local database is the source of truth. IndexedDB (`nudger`) holds seven tables: `documents`, `versions`, `files`, `nudgers`, `replies`, `templates`, `settings`. The API key is deliberately outside the database: `sessionStorage` by default, `localStorage` when the user opts in.

## Module map

| Area | Files |
| --- | --- |
| Types | `src/types.ts` |
| IndexedDB schema and store | `src/lib/db.ts`, `src/lib/storage.ts` |
| Defaults and starter library | `src/lib/defaults.ts`, `src/lib/starters.ts` |
| Placeholder resolution | `src/lib/placeholders.ts` |
| File wrappers, validation, upload names | `src/lib/referenceFiles.ts` |
| Provider adapters and errors | `src/lib/providers.ts`, `src/lib/errors.ts` |
| Run preparation, execution, retries | `src/lib/run.ts` |
| Concurrency and per-nudger run state | `src/lib/runManager.ts` |
| Export validation and filenames | `src/lib/exportImport.ts` |
| Key storage | `src/lib/keyStore.ts` |
| Hash routing | `src/lib/hashRoute.ts` |
| Autosave | `src/hooks/useDraft.ts` |
| App shell and orchestration | `src/App.tsx` |
| UI | `src/components/*.tsx`, `src/styles.css` |
| Tests | `src/test/*.test.ts` |

`storage.ts` is a store factory (`createStore(database)`) so tests can create an isolated fake-indexeddb database; the app uses a module-level singleton. UI components never talk to Dexie directly except through `useLiveQuery` against store methods.

## Data flow

1. `App` subscribes to documents, nudgers, files, templates, settings, version counts, and the active document's replies and versions with Dexie live queries. DB writes therefore update the UI without manual refetching.
2. The active draft text is local React state (`useDraft`). Every change schedules a 450 ms IndexedDB write. Changing documents flushes the previous draft first. A draft is also flushed before Save version, Restore, Duplicate, Export, Delete and Import, so operations never read a stale database copy.
3. A run snapshots the current in-memory text, the caret (`selectionStart`/`selectionEnd`), the document title, the full file library and the settings, then calls `prepareRun`. Resolution happens at that moment, not when the prompt was saved.
4. `prepareRun` resolves the system and user prompts, handles file insertion/auto-append, collects blocking/warning issues, computes characters and estimated tokens, and checks `maxContextChars`. It returns a `PreparedRun` containing the exact text, files to send, issues and the provider configuration.
5. Manual Run and Run all send eligible prepared jobs to `RunManager`. The manager guarantees one in-flight job per nudger and a configurable global concurrency limit; extras queue. It owns abort controllers and emits per-nudger state (queued/running/retrying/error) scoped by `documentId`.
6. `executeRun` calls the provider adapter, retries 429/5xx with backoff when the wait is short, then stores a `Reply` through `addReply`. The reply includes the exact `resolvedPrompt`, the sent file ids, provider and model; editing sources later cannot rewrite that record. `addReply` refuses to create orphans if the document or nudger was deleted while the model was working.
7. `RunManager` state is filtered to the active document in the UI, so a run in document A cannot show a Cancel button on document B. Deleting a document cancels its jobs; deleting a nudger cancels its job.

## Placeholder resolution

`resolveTemplateText` walks every `{{…}}` token in one pass:

- `before_cursor`, `before_last_word`, `current_paragraph`, `after_cursor`, `full_text`, `selection` read the text and caret snapshot.
- `document_title`, `nudger_name`, `date` are metadata. Scalar names are matched case-insensitively.
- `files` inserts all attached files; `file:NAME` inserts one, matched case-insensitively. A name that exists but is not attached is distinguished from a name that does not exist, and both are blocking.
- Unknown tokens stay literal and produce a warning.

`prepareRun` resolves system and user messages separately, gathers used files across both, and applies the auto-append rule only to the user message. If neither message contains a file placeholder, all attached files are appended under `REFERENCE FILES`; if either does, only the placeholders insert content and every attached file that was not used is reported. Every file is wrapped as reference data with begin/end markers.

Trimming is explicit: `trimPromptMiddle` keeps the start and end of an oversized user prompt, drops the middle with a visible marker, and the preview is recomputed so the user sees exactly what will be sent.

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

Exports are validated with `validateBundle` before import: schema version, required fields, file extensions, unique ids/names, reply statuses, normalized numeric settings. Malformed items are dropped with warnings. The API key is never present in a bundle.

- Merge adds new ids, skips existing ones, and remaps imported file ids to existing files with the same name so file placeholders keep resolving.
- Replace clears the seven tables and loads the bundle. It restores provider/model/generation preferences but **not** the exported base URL, custom headers or remember-key choice without explicit consent, because those could redirect the stored key. The import dialog shows the imported endpoint and an opt-in.

## Security and privacy

- No third-party scripts, fonts, analytics or telemetry. The production build injects a meta CSP with `script-src 'self'`; `connect-src https:` is broad only because custom provider endpoints are allowed. This is documented in the README as a deliberate tradeoff.
- All model output and stored prompts are rendered as text (`white-space: pre-wrap`), never as HTML.
- Keys are masked in UI, kept out of IndexedDB and exports, never logged, and sent only to the configured provider. Loading settings does not silently migrate or delete keys.
- Text leaves the browser only on an explicit run/test, and the preview shows the exact request.

## Testing

Vitest runs in Node with `fake-indexeddb`. Tests cover placeholder semantics, file insertion and auto-append, trimming, version restore, storage/CRUD/cascades, import/export safety, provider request shapes and error classification, retry/cancel, hash routing, key storage, the starter library and a mocked end-to-end run. Browser checks were performed separately with a production preview and a real DeepSeek key; those scripts are not part of the shipped app.

## Deployment

`vite.config.ts` uses relative asset paths (`base: './'`) and injects the CSP meta only for builds, leaving dev HMR unrestricted. `.github/workflows/deploy.yml` runs install, tests and build, then deploys `dist/` with the official GitHub Pages actions. The repository is expected to be `nudger`, served at `https://bitbutter.github.io/nudger/`; because assets are relative and routing is hash-based, a differently named repository still works.
