# nudger

**nudger** is a local-first, static writer's board for LLM virtual repliers. One large document, a shared library of `.txt`/`.md` reference files, and any number of named nudgers that read your draft and answer with a question, critique or next step.

A nudger never writes into your document. It returns plain text. You copy what helps.

- Static site, no backend, no accounts, no analytics, no third-party scripts.
- Documents, versions, files, nudgers, replies and settings live in IndexedDB.
- Your API key stays in this browser. Keys are never stored in IndexedDB, exported, or logged.
- Text leaves the browser only when you run a nudger, and the resolved-prompt preview shows exactly what will be sent.
- Default provider: **DeepSeek** pay-as-you-go (`deepseek-flash`), which allows direct browser requests. OpenAI, Anthropic, OpenRouter, Groq, Mistral and custom OpenAI-compatible endpoints are also supported.

Published at: **https://bitbutter.github.io/nudger/** (GitHub Pages).

---

## Quick start

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev        # local development, usually http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
npm test           # unit + integration tests (Vitest)
```

First run:

1. Click **Start a document** and write something. The editor autosaves locally.
2. Click **+ Add nudger** and pick a starter (Skeptical reviewer, Completeness coach, Hiring manager, …). Or create a blank one.
3. To send reference material, create or upload a `.txt`/`.md` file under **Reference files**, then attach it in the nudger editor.
4. Open **Settings**, choose a provider, paste a key, and use **Test connection**.
5. Click **Run** on a card, or **Preview** to see the exact resolved prompt first. A blocked or oversized prompt opens the preview instead of sending.
6. Save named snapshots with **Save version** (Ctrl+S); restore from **Versions**.

Keyboard shortcuts: Ctrl/Cmd+Alt+N new document, Ctrl/Cmd+S save version, Ctrl/Cmd+Shift+Enter run all, Ctrl/Cmd+Enter run the focused (or first enabled) nudger, Ctrl/Cmd+B toggle the sidebar, Ctrl/Cmd+, open settings.

---

## What a nudger is

A nudger is an independent virtual replier with:

- id, name, optional description, accent color
- system prompt and user prompt (resolved at run time)
- selected reference files, in order
- optional provider/model override (the API key always comes from Settings)
- temperature, max tokens, max context characters
- auto-run on/off, enabled/disabled, done
- a reply allowance (budget), order, timestamps
- an optional “Facts to check” list and the focus for that list
- its own reply history per document

Nudgers share the global reference-file library and the global API key. They do not share prompts, files, reply state or budgets. There is no cross-nudger dedupe or similarity check.

Replies are plain text with preserved line breaks. They are never inserted into the editor. Each saved reply stores the exact resolved prompt that produced it, so editing a file or prompt later does not rewrite history.

Reply statuses: `new`, `pinned`, `dismissed`, `archived`. The newest `new` or `pinned` reply is prominent; all older/dismissed/archived replies are in **History**. Actions: copy, pin/unpin, dismiss/undismiss, archive/unarchive, retry, clear history.

### Facts to check

A nudger can return a short list of concrete specifics beneath its reply: names, dates, numbers, examples, claims or links the writer should verify or might need to look up. The list is a **memory and verification aid**, not a claim that anything was checked.

- **Per nudger, selectively on.** Completeness coach, Hiring manager, Skeptical reviewer and Fact checker start with fact clues on; the structural, style, continuation, research-planner and definition nudgers start with them off. Every nudger has a toggle, and custom nudgers start off. This is deliberate: a fact list is useful when the role is about specifics, and noise when it is about structure or voice.
- **One request, one JSON object.** When fact clues are on, the model is asked to return `{"reply":"...","facts":["..."]}`. The reply and the facts come from the same reading of the same material; there is no second request and no doubled input cost.
- **The prompt is fact-specific.** The nudger editor has an editable “What should the list focus on?” field. The fixed JSON protocol and the source-bound rules (at most five, only the supplied material, no invention, filename in parentheses when relevant, prefer exact values) are appended to the system prompt at run time. The resolved-prompt preview shows the whole thing.
- **Per reply, immutable.** The reply text and facts are stored together with the resolved prompt. Older replies keep the facts from their own run. History and exports preserve them.
- **Failure handling is explicit.** The parser tolerates code fences and surrounding prose. If the model returns plain prose instead of JSON, the prose is kept as the reply and the card says the structured fact list is missing. If the response is JSON-shaped but malformed, the run fails with a clear error and a Retry action instead of rendering the broken blob as a nudge. A malformed-JSON reply is not saved.
- **Provider-agnostic.** This does not rely on any provider's JSON mode or tool-calling support; it is a prompt protocol validated locally, so it works through the same OpenAI-compatible and Anthropic adapters as everything else.
- **Not verified facts.** The prompt forbids invention and asks for specifics from the material, but the model can still be wrong. The UI labels the list “model-generated; verify”. For a deeper, dedicated pass, add a Fact checker nudger with no fact-clue list; its whole reply is the research/verification work.

The fact protocol adds roughly 100 tokens to the system prompt. Turning it off restores a plain-text reply with no protocol and no list.

### Budget, done, auto-run

- **Done** stops all generation for that nudger until reopened.
- **Budget** is the reply allowance (default 3). The card counts saved replies for the **current document**; when the count reaches the budget, running stops until **More +3** adds allowance. Clearing history frees the count. There is one `budget` value per nudger, so **More +3** raises the allowance for every document.
- **Auto-run** fires once about 1.5 s after typing stops (configurable in Settings). It never runs while the document is empty, while the nudger is done/disabled/out of budget, or while a modal is open. If the nudger is busy when the timer fires, nudger waits for it to finish and then runs the latest draft once.
- At most one request per nudger is in flight. A global queue limits concurrent calls (default 2, configurable 1–8). Over-limit jobs wait.
- Rate-limit (429) and 5xx responses are retried automatically up to two times with backoff when the provider's wait is 15 s or less. Longer waits are surfaced with the provider's message instead of hanging the card.
- Failed attempts are shown in the card with the provider's message and an actionable hint. They are not saved as replies and do not consume budget.

---

## Placeholder syntax

Placeholders resolve **when you run the nudger**, not when the prompt is saved. They also resolve in the system prompt. Scalar placeholder names are case-insensitive.

| Placeholder | Value |
| --- | --- |
| `{{before_cursor}}` | Everything from the start of the document to `selectionStart` (the exact cursor position). |
| `{{before_last_word}}` | Everything up to the start of the word currently being typed at `selectionStart`; if no word is in progress, the same as `{{before_cursor}}`. |
| `{{current_paragraph}}` | The paragraph containing the cursor. Paragraphs are split on blank lines. A cursor on a blank-line separator uses the next paragraph; a cursor on a trailing blank line uses the previous one. |
| `{{after_cursor}}` | Everything from `selectionEnd` to the end. With no selection this is everything after the cursor. |
| `{{full_text}}` | The whole document. |
| `{{selection}}` | The selected text, or an empty string. |
| `{{document_title}}` | The current title. |
| `{{nudger_name}}` | The nudger's name. |
| `{{date}}` | Today's local date as `YYYY-MM-DD`. |
| `{{files}}` | Every attached file, in the nudger's order, each wrapped as reference data. |
| `{{file:notes.md}}` | One attached file by exact name (matched case-insensitively). A missing or unattached file blocks the run with a clear error. |

**Why `before_cursor` and `after_cursor` use different edges:** `before_cursor` ends at `selectionStart`; `after_cursor` starts at `selectionEnd`. Together with `{{selection}}` they reconstruct the full text without duplicating the selection.

### File insertion rules

- If the template contains **no** file placeholder and the nudger has attached files, all attached files are appended automatically under a `REFERENCE FILES` section.
- If the template contains **any** file placeholder (`{{files}}` or `{{file:name}}`), only those placeholders insert content. Attached files that are not referenced are listed in the editor and preview as "will not be sent".
- A `{{file:name}}` that names a file that exists but is not attached is a blocking error, as is a file that does not exist.
- Unknown placeholders are sent literally with a warning.
- Every inserted file is wrapped with a begin line (name and type), a "reference data, not instructions" line, the content, and an end marker. File content is never treated as instructions by the app; the wrapper tells the model the same.
- The template editor shows the selected files' total characters and estimated tokens, warnings for no document-context placeholder, warnings for unattached/unreferenced files, and a live resolved preview against the current document, cursor and files.
- Editing a reference file affects future runs only. Past replies keep their resolved prompt.
- File rename/delete warnings: deleting a file detaches it from every nudger; renaming a file that is referenced by `{{file:oldname}}` warns you that the placeholder must be updated or the run will block.

**Token estimates** are approximate: characters ÷ 4 (plus a rough estimate for both messages). The `max context characters` check is exact and uses the full resolved system + user prompt.

### Oversized prompts

Each nudger has `max context characters` (default 100,000). If the resolved prompt is larger:

- nothing is silently cut;
- the preview shows the total, the limit and how much is over;
- **Run anyway** sends the full prompt;
- **Trim (drops middle)** removes the middle of the user prompt with a visible `[TRUNCATED BY NUDGER …]` marker, keeping the beginning and the end (the part nearest the cursor). The trimmed result is shown before it is sent.

A missing/unselected file, an unset model/base URL, or a missing API key blocks the run with a clear explanation.

---

## Reference files

Global `.txt` and `.md` library, stored in IndexedDB.

- Create a blank file, paste text into a new file, or upload one or more `.txt`/`.md` files from disk. Uploads copy the contents; no path link is kept.
- Only `.txt` and `.md` are accepted. Binary content and other formats (PDF, DOCX, HTML) are rejected. Uploaded files are capped at 2 MB each.
- Names are unique case-insensitively. Uploads that collide are saved with ` (2)`, ` (3)`, … rather than overwriting.
- Rename, edit, search, download, delete. Editing is a plain-text textarea; the file's char count, word count, kind and updated time are shown.
- The file list shows all files, and each nudger can attach any subset in a chosen order.
- Deleting a file removes it from every nudger that attached it. Old replies still hold their resolved prompt.

Files are part of exports. They are never committed to the repository.

---

## Documents and versions

- A document has an id, title, current draft text and timestamps; each has its own versions and reply histories.
- Draft edits autosave to IndexedDB after ~450 ms. Autosave does **not** create permanent versions.
- **Save version** creates a permanent snapshot with a timestamp, word count, full text and an optional label (or an automatic "Snapshot N" label).
- **Versions** shows the list, a preview and the word count. **Restore** is non-destructive:
  1. the current text is saved as a `Before restore of …` version (unless it is identical);
  2. the restored text is saved as a new `Restored from …` version;
  3. the editor text is replaced and autosaved.
- **Duplicate document** copies the current text and its version history. **Delete document** removes its versions and reply histories after confirmation.
- Search in the sidebar matches titles and document text.
- A line/word diff between versions is not included in this first version.

---

## Templates

The starter library is read-only and ships with ten short templates:

Completeness coach (attach notes), Hiring manager (attach the job posting), Skeptical reviewer, Structural editor (attach an outline/style guide if you have one), Fact checker (attach sources if you have one), Devil's advocate, Audience check, Continuation prompter, Research planner, Definition explainer.

A nudger keeps its own copy of the system and user prompts. Editing one nudger never edits another. In the nudger editor you can load a template, reset to the template it came from, save the current prompt as a custom template, or duplicate the nudger as a new one. Custom templates live on **Prompt templates**, where they can be created, edited, duplicated, deleted and used as a new nudger. Starter templates cannot be edited or deleted; duplicate one to customize it.

---

## Providers, keys and CORS

**BYOK.** The app has no backend and no proxy. Browser requests go directly from the page to the provider's API.

Settings:

- provider preset (DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Mistral, OpenAI-compatible, custom OpenAI-compatible)
- API key
- model
- base URL (editable, especially for compatible/custom endpoints)
- optional custom headers as JSON (sent with every provider request; stored in settings and included in exports — do not put a key here)
- temperature, max tokens, default max context characters
- auto-run delay, max concurrent runs, request timeout
- theme, layout (nudgers below or beside the editor)
- Test connection
- remember key on this device, clear key, export/import, clear all data

### CORS behavior (verified 2026-10-22)

A static page can only call an endpoint that answers the browser's CORS preflight. CORS behavior is controlled by the provider and can change without notice. These were checked with preflight requests from a GitHub Pages-style origin:

| Provider | Default API root | Browser requests |
| --- | --- | --- |
| DeepSeek (pay-as-you-go) | `https://api.deepseek.com` | Allowed; echoed `Access-Control-Allow-Origin` |
| OpenAI | `https://api.openai.com/v1` | Allowed |
| Anthropic | `https://api.anthropic.com` | Allowed when `anthropic-dangerous-direct-browser-access: true` is sent (the app sends it) |
| OpenRouter | `https://openrouter.ai/api/v1` | Allowed (`*`) |
| Groq | `https://api.groq.com/openai/v1` | Allowed (`*`) |
| Mistral | `https://api.mistral.ai/v1` | Allowed (`*`) |
| OpenAI-compatible / custom | your URL | Must allow browser CORS; only use endpoints you trust |

If a provider blocks preflight, the request never reaches it. The app shows a network/CORS error explaining that the endpoint must allow browser requests, or that you should choose a CORS-friendly provider. It does not use a hidden server, a public CORS proxy, or a third-party relay. (If you control an endpoint or a proxy, point the custom/OpenAI-compatible base URL at it.)

### DeepSeek

Use provider **DeepSeek**, base URL `https://api.deepseek.com`, model `deepseek-flash` (or another model available on your account). The adapter sends `POST /chat/completions` with `Authorization: Bearer <key>`. This is the default preset and was verified end-to-end from the built app on 2026-10-22.

### Anthropic

Base URL `https://api.anthropic.com`; the adapter sends `POST /v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true`, plus `system` and `messages`.

### OpenAI-compatible and custom

The adapter sends `POST <base>/chat/completions` with a bearer token and a standard `messages` array, `temperature`, `max_tokens`, and `stream: false`. If the base URL already ends in `/chat/completions`, it is used as-is. Custom headers are merged into the request.

### Per-nudger overrides

A nudger can choose its own provider and model. It still uses the one API key in Settings, so a nudger pointed at a different provider needs that provider's key in Settings at run time (or use a separate browser profile). When a nudger overrides the provider without specifying a model, that provider's preset default model is used, not the global model.

### Key handling

- **Remember off (default):** the key is kept in `sessionStorage`. It survives a reload in the same tab and disappears when the tab is closed.
- **Remember on:** the key is kept in `localStorage` and persists across restarts. The UI warns that any script on the page could read it.
- Keys are never written to IndexedDB, never included in exports, never logged, and only sent to the selected provider.
- **Clear key** removes both stores. **Clear all data** lets you remove the key too.
- Changing the remember setting and clicking Save settings (or Save key) moves the key between stores deliberately. Loading or importing settings never silently moves or deletes a key.
- No browser storage is secure against a compromised page, extension or device. Keep third-party scripts out, use a dedicated key with a spending limit, and rotate it if you suspect exposure.

---

## Privacy

- Static page. No accounts, servers, analytics, telemetry, third-party fonts, third-party scripts or service workers.
- Documents, versions, reference files, nudgers, replies, custom templates and settings are stored in IndexedDB in this browser.
- The only network calls are the provider requests triggered by **Run**, **Run all**, auto-run, or **Test connection**. Each request contains the exact resolved system + user prompt (including any attached reference files) shown in the preview. Nothing else is sent.
- Provider-side retention and training policies are governed by the provider's terms, not by nudger.
- Exports contain every document, version, reference file, nudger, reply, custom template and setting (without the API key). Treat exports as sensitive, because they include your files and custom headers.
- Browser storage can be cleared by the browser, by private-mode exit, or by clearing site data. Export regularly if the material matters.

There is a visible privacy note in the sidebar and a fuller privacy section in Settings.

---

## Export, import and storage

**Export** downloads a JSON bundle (`nudger-export-YYYY-MM-DD-HHMM.json`) with schema version 1: documents, versions, reference files, nudgers, replies, custom templates and settings. API keys are excluded, and the export is written only after any pending autosave is flushed.

**Import** validates the file and lets you choose:

- **Merge:** add items whose ids are not already present. Existing documents, files, nudgers and settings are untouched. A file whose name already exists is reused for imported nudgers that reference it, so `{{file:name}}` keeps resolving. Duplicate ids are skipped. Settings are not changed.
- **Replace:** delete all current app data and settings, then load the export (with the endpoint safeguards below). Reference files in the export replace the library. The API key is never imported or deleted.

Safety on replace: the exported **base URL and custom headers are ignored by default** (a hostile export must not be able to point your key at another host). Import shows the imported host and offers an explicit checkbox to restore those network settings. The local **remember key** preference is also kept, so an import cannot move your key between storage modes.

Validation drops malformed items with visible warnings rather than importing partial garbage. Unsupported schema versions are rejected. Import does not validate the semantics of prompts; it does validate types, file extensions and references.

**Storage usage** is read from `navigator.storage.estimate()` and shown in the sidebar and Settings. The app warns at 80% and surfaces quota errors instead of silently losing a write. IndexedDB stores the whole document text, so very large documents and many reference files consume real space.

---

## Publishing to GitHub Pages

The expected repository is `nudger` and the site is `https://bitbutter.github.io/nudger/`.

The build uses Vite `base: './'` (relative assets) and hash routing (`#/doc/:id`, `#/files`, `#/templates`, `#/settings`), so it works from a repository subpath with no 404 fallback and no server rewrites. A repository named differently will still work with relative assets; only the public URL changes.

`.github/workflows/deploy.yml` builds, tests and deploys on pushes to `main` (and manual dispatch) using GitHub's official Pages actions. In the repository, set **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow also asks GitHub to enable Pages if needed.

```bash
npm ci
npm test
npm run build
```

`dist/` is the deployable artifact. There are no secrets or API-key environment variables in the repository or workflow.

### CSP

The production build injects this meta CSP (development intentionally omits it so Vite's HMR inline script and websocket can work):

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self' https:;
base-uri 'none'; form-action 'none'; object-src 'none'
```

`connect-src https:` is broad **because custom provider endpoints are allowed**. This is the deliberate tradeoff: no third-party scripts are loaded, and `script-src 'self'` blocks injected script, but the page can send data to any HTTPS origin the user configures. The resolved prompt preview and the explicit provider setting are what keep that intentional. A meta CSP cannot set `frame-ancestors`; there is no other backend defense.

---

## Data model

```ts
Document   { id, title, currentText, createdAt, updatedAt }
Version    { id, documentId, text, label?, createdAt, wordCount }
ReferenceFile { id, name, kind: "txt" | "md", content, createdAt, updatedAt, wordCount }
Nudger     { id, name, description?, color, system, prompt, fileIds[], providerId?, model?,
             temperature, maxTokens, maxContextChars, autoRun, enabled, done, budget,
             facts, factsPrompt, order, templateId?, createdAt, updatedAt }
Reply      { id, documentId, nudgerId, text, resolvedPrompt, fileIds[], model, provider,
             createdAt, status: "new" | "pinned" | "dismissed" | "archived", usage?,
             facts?: string[], factsError? }
Template   { id, name, description, system, prompt, facts?, factsPrompt?, builtin, createdAt, updatedAt }
Settings   { providerId, model, baseUrl, customHeaders?, rememberKey, temperature, maxTokens,
             maxContextChars, autoRunDelayMs, maxConcurrentRuns, requestTimeoutMs, theme, layout }
```

The API key is not part of persisted `Settings`. IndexedDB tables: `documents`, `versions`, `files`, `nudgers`, `replies`, `templates`, `settings`. The database name is `nudger`. See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries and the run pipeline.

---

## Decisions made where the requirements were ambiguous

1. **Default provider is DeepSeek** (`deepseek-flash`, `https://api.deepseek.com`) because it is CORS-friendly, widely used with a pay-as-you-go key, and is the target provider for this build. It is still a normal preset; nothing depends on it.
2. **Remember off uses `sessionStorage`**, as specified. That survives a reload in the same tab but not closing the tab. The acceptance text mentions "reload" for both states; sessionStorage semantics were chosen because the explicit requirement names sessionStorage.
3. **Replies render as plain text** with preserved line breaks, not Markdown. This avoids a sanitizer dependency and any HTML injection. (Markdown preview is likewise not implemented for files.)
4. **`before_cursor` ends at `selectionStart`; `after_cursor` starts at `selectionEnd`.** With a selection this avoids duplicating the selected text and lets before + selection + after reconstruct the document.
5. **`current_paragraph`** splits on blank lines, picks the next paragraph when the cursor is on a separator, and the previous one on a trailing blank line.
6. **Trimming an oversized prompt drops the middle**, visibly, keeping the start (instructions/files) and end (text nearest the cursor). It is never silent and the exact result is previewed. Run anyway is always available.
7. **Manual runs never open the prompt preview automatically** except when the run is blocked or over the limit. The resolved prompt is always available from **Preview** and from each stored reply.
8. **Budget counts saved replies per document** because reply histories are per document, while the nudger data model has one `budget` field. **More +3** raises the nudger's allowance for all documents. Clearing a document's history resets that document's count.
9. **Failed runs are not saved as replies.** They appear in the card with the provider message, a Retry button and, where useful, an Open settings link. This keeps reply history meaningful and avoids failures consuming budget.
10. **Duplicating a document copies its versions.** Duplicating a nudger keeps prompts/files/color/model but resets auto-run, done and budget, so a copy does not immediately double model calls.
11. **Deleting a reference file detaches it from nudgers.** Old replies keep their resolved prompts. Renaming a referenced file warns that `{{file:oldname}}` placeholders need updating.
12. **Missing or unselected `{{file:name}}` blocks the run.** Unknown placeholders are warnings and are sent literally. A template with selected files but no file placeholder auto-appends them (as required) rather than warning.
13. **Import replace protects the API key path.** It ignores the exported base URL and custom headers unless the user explicitly opts in; it keeps the local remember-key choice; and it never touches the key itself. Merge preserves local settings and remaps duplicate file names.
14. **No stop-topics list, similarity warning, version diff, markdown rendering, or replace-selection action** in this version. The first three were optional; the last is a non-goal, and automatic insertion is explicitly out of scope.
15. **Per-nudger provider overrides share the global key**, because storing multiple keys was not requested, and a per-nudger key would complicate key export/privacy. Use a separate profile if you need two keys at once.
16. **Auto-run is per nudger with one global delay**, not a separate delay per nudger. It waits for a busy nudger to finish and then runs once, so the latest draft is not skipped.
17. **Reference uploads are capped at 2 MB per file** and validated as text (NUL/control-character check) to protect IndexedDB quota and reject binary files. The cap is a local implementation choice, not a product limit.
18. **The app uses hash routing.** It requires no server rewrites, works from a subpath, and makes every view reloadable.
19. **Exports include replies** even though the requirement only listed documents, versions, files, nudgers, templates and settings, because reply history is the audit trail for prompts. Keys remain excluded.
20. **The theme is dark by default**, with a light theme and a stacked/beside layout preference in Settings.
21. **Fact clues are per nudger and selectively on**, not a document-wide panel. The four fact-oriented starters enable them; the rest and custom nudgers start off, and every nudger can toggle them. A document-wide list would be generic, duplicate work, and ignore each nudger's reference files.
22. **Fact clues share the nudge response** as one JSON object (`reply` + `facts`), not a second extraction request. The prompt protocol is validated locally, tolerates fences/prose, falls back to the plain reply, and refuses malformed JSON rather than showing raw data. This keeps cost and latency at one call while giving structured facts. The tradeoff is that a model can ignore the JSON protocol; the reply is then kept and the missing list is reported.
23. **Facts are clues, not verified facts.** They are stored per reply, labeled “model-generated; verify”, and never inserted into the draft. A dedicated Fact checker nudger remains the route for a deeper verification pass.

---

## Testing

`npm test` runs 96 tests in 11 files:

- placeholder resolution (`before_cursor`, `before_last_word`, paragraph, selection, case-insensitivity, unknown placeholders)
- reference-file insertion, wrappers, auto-append, missing/unselected files, unreferenced warnings, oversized trim
- non-destructive version restore and autosave behavior
- IndexedDB storage, CRUD, cascades, budgets, settings key stripping, export/import, merge remapping, import network safety
- provider request shapes for OpenAI-compatible and Anthropic, URL joining, model override fallback, auth/rate-limit/context/CORS/timeout errors
- a mocked end-to-end run (create document + file + nudger, resolve prompt, call model, save reply), structured reply/facts parsing, malformed JSON, plain-text fallback, retry and cancel
- starter library (including which starters enable fact clues), export validation, hash routing, API-key storage

The production app was also exercised in a real browser (Brave via Playwright) on 2026-10-22: document creation, cursor placeholders, versions and restore, reference uploads, nudger add/duplicate/reorder/disable/delete, prompt preview, a **live DeepSeek `deepseek-flash` run** including attached notes (one request, four fact clues), a facts-off plain-text run, auto-run after typing, a 401 invalid-key error state, export → clear → import, custom template create/use/delete, and a 390 px mobile layout. The browser test scripts were development-only and are not part of the app.

---

## Limitations and non-goals

- No backend, accounts, cloud sync, collaboration or database.
- No automatic insertion of model text into the document.
- No PDF/DOCX/HTML import, web scraping, or retrieval.
- No analytics, telemetry, third-party fonts or third-party scripts.
- No guarantee that any provider will keep CORS enabled; the error path explains when it does not.
- Fact clues are model-generated and can be wrong or incomplete; they are not a source of truth. A model may ignore the JSON protocol (the reply is kept and the missing list is reported) or return malformed JSON (the run fails with Retry).
- Token estimates are approximate. The character limit is the enforceable one.
- Browser storage is not a backup. Export.

---

## License

MIT © 2026 bitbutter. See [LICENSE](LICENSE).
