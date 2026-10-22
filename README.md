# nudger

**nudger** is a local-first, static writer's board for LLM virtual repliers. Each document carries its own row of named nudgers and its own `.txt`/`.md` reference files, so the material a nudger reads belongs to that draft. Prompt templates are how a nudger travels to another document.

A nudger never writes into your document. It returns plain text. You copy what helps.

- Static site, no backend, no accounts, no analytics, no third-party scripts.
- Documents, versions, nudger-owned files, nudgers, replies and settings live in IndexedDB.
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
2. Click **+ Add nudger** and pick a starter (Skeptical reviewer, Completeness coach, Hiring manager, …). Or create a blank one. The nudger belongs to this document.
3. To send reference material, open **Files (n)** in the document toolbar and create or upload a `.txt`/`.md` file in the panel that opens under the draft, then attach it in the nudger editor. The attachment is part of this document's nudger, not a global setting.
4. Open **Settings**, choose a provider, paste a key, and use **Test connection**.
5. Click **Run** on a card, or **Preview** to see the exact resolved prompt first. A blocked or oversized prompt opens the preview instead of sending.
6. Save named snapshots with **Save version** (Ctrl+S); restore from **Versions**. **Copy text** and **Export .txt** sit in the document header, next to the title. Drag the divider between the draft and the nudger board to change how wide the text column is; double-click it to reset.
7. To reuse a configured nudger in another document, open its menu and choose **Save as template**, then add it from **Prompt templates** in the other document and attach that document's files.

Keyboard shortcuts: Ctrl/Cmd+Alt+N new document, Ctrl/Cmd+S save version, Ctrl/Cmd+Shift+Enter run all, Ctrl/Cmd+Enter run the focused (or first enabled) nudger, Ctrl/Cmd+B toggle the sidebar, Ctrl/Cmd+, open settings.

---

## What a nudger is

A nudger is an independent virtual replier owned by one document, with:

- id, `documentId`, name, optional description, accent color
- system prompt and user prompt (resolved at run time)
- selected reference files, in order, for that document
- optional provider/model override (the API key always comes from Settings)
- temperature, max tokens, max context characters
- auto-run on/off, enabled/disabled, done
- a reply allowance (budget) for that document, order, timestamps
- an optional “Facts to check” list and the focus for that list
- its own reply history

Nudgers in the same document share only the document's reference files and the global API key. They do not share prompts, files, reply state or budgets. There is no cross-nudger dedupe or similarity check. Neither a nudger nor a reference file belongs to any other document, so prompts, files and auto-run stay with the draft they were set up for.

Replies are plain text with preserved line breaks. They are never inserted into the editor. Each saved reply stores the exact resolved prompt that produced it, so editing a file or prompt later does not rewrite history.

A nudge is a short interruption, not an essay. Every run appends one fixed rule to the system prompt (`REPLY_LENGTH_RULE` in `src/lib/run.ts`): at most two short sentences, no preamble, no lists, no headings, no restating the draft. It applies to custom nudgers too, and the resolved-prompt preview shows it.

Reply statuses: `new`, `pinned`, `dismissed`, `archived`. The newest `new` or `pinned` reply is prominent; all older/dismissed/archived replies are in **History**. Actions: copy, pin/unpin, dismiss/undismiss, archive/unarchive, retry, clear history.

### Facts to check

A nudger can return a short list of concrete specifics beneath its reply: names, dates, numbers, examples, claims or links the writer should verify or might need to look up. The list is a **memory and verification aid**, not a claim that anything was checked.

- **Per nudger, selectively on.** Completeness coach, Hiring manager and Skeptical reviewer start with fact clues on; the structural, style, continuation, research-planner, definition and Fact checker nudgers start with them off. Every nudger has a toggle, and custom nudgers start off. This is deliberate: a fact list is useful when the role is about specifics, and noise when it is about structure or voice.
- **One request, one JSON object.** When fact clues are on, the model is asked to return `{"reply":"...","facts":["..."]}`. The reply and the facts come from the same reading of the same material; there is no second request and no doubled input cost.
- **The facts are tied to the nudge.** The prompt requires every clue to support, sharpen or challenge the specific question or critique in the reply field. A nudge about a named project should yield that project's exact name, language/stack, release date or version when the material contains them; unrelated material is omitted. If no clue relates to the nudge, the list is empty rather than padded.
- **The prompt is fact-specific.** The nudger editor has an editable “What should the facts relate to?” field. The fixed JSON protocol and the source-bound rules (at most five, only the supplied material, no invention, filename in parentheses when relevant, prefer exact values, most relevant first) are appended to the system prompt at run time. The resolved-prompt preview shows the whole thing.
- **Per reply, immutable.** The reply text and facts are stored together with the resolved prompt. Older replies keep the facts from their own run. History and exports preserve them.
- **Failure handling is explicit.** The parser tolerates code fences and surrounding prose. If the model returns plain prose instead of JSON, the prose is kept as the reply and the card says the structured fact list is missing. If the response is JSON-shaped but malformed, the run fails with a clear error and a Retry action instead of rendering the broken blob as a nudge. A malformed-JSON reply is not saved.
- **Provider-agnostic.** This does not rely on any provider's JSON mode or tool-calling support; it is a prompt protocol validated locally, so it works through the same OpenAI-compatible and Anthropic adapters as everything else.
- **Not verified facts.** The prompt forbids invention and asks for specifics tied to the nudge, but the model can still be wrong. The UI labels the list “behind this nudge; model-generated; verify”. For a deeper, dedicated pass, add a Fact checker nudger with no fact-clue list; its whole reply is the research/verification work.

The fact protocol adds roughly 300 tokens to the system prompt. Turning it off restores a plain-text reply with no protocol and no list.

### Budget, done, auto-run

- **Done** stops all generation for that nudger until reopened.
- **Budget** is the reply allowance (default 3) inside this document. The card counts saved replies for that nudger; when the count reaches the budget, running stops until **More +3** adds allowance. Clearing history frees the count. Each document has its own nudgers, so **More +3** raises the allowance only for the nudger you clicked.
- **Auto-run** fires once after the typing cooldown (about 1.5 s, configurable in Settings) **and** a mouse or pointer movement after the last keystroke — a mouse resting on the page never triggers a run. It only considers the current document's nudgers, and never runs while the document is empty, while the nudger is done/disabled/out of budget, or while a modal is open. If the nudger is busy when it should fire, nudger waits for it to finish and then runs the latest draft once.
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

`.txt` and `.md` files that belong to one nudger, stored in IndexedDB. A nudger reads only the files it owns, so material for one replier is never sent to another. There is no document-wide file page: the **n files** chip on a nudger card opens that nudger's file panel underneath the draft.

- Create a blank file, paste text into a new file, or upload one or more `.txt`/`.md` files from disk. Uploads copy the contents; no path link is kept.
- Only `.txt` and `.md` are accepted. Binary content and other formats (PDF, DOCX, HTML) are rejected. Uploaded files are capped at 2 MB each.
- Names are unique case-insensitively inside a nudger. Uploads that collide are saved with ` (2)`, ` (3)`, … rather than overwriting. Two nudgers can each own a file called `notes.md` with different contents.
- Rename, edit, reorder, search, download, delete. Reordering sets the order `{{files}}` inserts them in. Editing is a plain-text textarea; the file's char count, word count, kind and updated time are shown.
- Duplicating a nudger copies its files, so the copy is independent. Deleting a nudger deletes its files. Deleting a document removes its nudgers and their files.
- Files a nudger no longer owns (left over from older versions of the app, or imported from an older export) appear in an **Unassigned files** section on the document, where each can be attached to a nudger or deleted. Unassigned files are never sent.
- Old replies still hold their resolved prompt after a file is edited or deleted.

Files are part of exports. They are never committed to the repository.

---

## Documents and versions

- A document has an id, title, current draft text and timestamps; each has its own versions and reply histories.
- Draft edits autosave to IndexedDB after ~450 ms. Autosave does **not** create permanent versions.
- **Copy text** in the document header puts the draft on the clipboard; **Export .txt** saves it as `<title>.txt`. Both are the text exactly as typed, with no metadata or wrappers.
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

A nudger keeps its own copy of the system and user prompts. Editing one nudger never edits another, and the editor writes changes to that document's nudger row as you make them: the footer shows **Last saved …** and there is no Save button to forget. A new nudger is only stored when you press **Create nudger**. In the nudger editor you can load a template, reset to the template it came from, save the current prompt as a custom template, or duplicate the nudger as a new one. **Save as template** is also in each card's menu.

A saved template copies the name, description, system prompt, user prompt, fact settings and generation settings verbatim, including placeholders such as `{{before_cursor}}`, `{{files}}` and `{{file:notes.md}}`. Files are not carried: they describe one document's context. Add the template in another document, attach that document's files, and the same role works there against the right material. Custom templates live on **Prompt templates**, where they can be created, edited (autosaved, with a **Last saved …** line), duplicated, deleted and used as a new nudger. Starter templates cannot be edited or deleted; duplicate one to customize it.

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
- theme, layout (nudgers beside or below the editor; the draft column width is a per-device drag preference in localStorage, not a setting)
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
- **Remember on:** the key is kept in `localStorage` and persists across restarts. The UI warns that any script on the page could read it, and that a hosted project site shares one browser origin with every other page under that host — those pages can read the same localStorage and IndexedDB. Only remember a key if you control every page on the origin, or use a dedicated domain/browser profile.
- **Shared origin:** `bitbutter.github.io` is one origin for every project page on the account. A different repository page, a collaborator's page or an XSS on any of them can read this app's remembered key and local data. The default (sessionStorage) limits persistence but not same-origin access while the tab is open.
- Keys are never written to IndexedDB, never included in exports, never logged, and only sent to the selected provider.
- **Clear key** removes both stores. **Clear all data** lets you remove the key too.
- Settings have no Save button: every field is written shortly after you change it, and the header shows **Last saved …** or the error that blocked the write. An invalid custom-headers JSON block pauses saving instead of storing a broken value.
- Changing the remember setting moves the key between stores as soon as that change is saved. Loading or importing settings never silently moves or deletes a key.
- No browser storage is secure against a compromised page, extension or device. Keep third-party scripts out, use a dedicated key with a spending limit, and rotate it if you suspect exposure.

---

## Privacy

- Static page. No accounts, servers, analytics, telemetry, third-party fonts, third-party scripts or service workers.
- Documents, versions, reference files, nudgers, replies, custom templates and settings are stored in IndexedDB in this browser.
- The only network calls are the provider requests triggered by **Run**, **Run all**, auto-run, or **Test connection**. Each request contains the exact resolved system + user prompt (including any attached reference files). The resolved prompt is shown in Preview and stored with the reply; auto-run sends it without opening the preview. Nothing else is sent.
- Provider-side retention and training policies are governed by the provider's terms, not by nudger.
- Exports contain every document, version, reference file, nudger, reply, custom template and setting (without the API key). Treat exports as sensitive, because they include your files and custom headers.
- Browser storage can be cleared by the browser, by private-mode exit, or by clearing site data. Export regularly if the material matters.

There is a visible privacy note in the sidebar and a fuller privacy section in Settings.

---

## Export, import and storage

**Export** downloads a JSON bundle (`nudger-export-YYYY-MM-DD-HHMM.json`) with schema version 4: documents, versions, nudger-owned reference files, document-bound nudgers, replies, custom templates and settings. API keys are excluded, and the export is written only after any pending autosave is flushed.

**Import** validates the file and lets you choose:

- **Merge:** add items whose ids are not already present. Existing documents, files, nudgers and settings are untouched. A file whose name already exists on the same nudger is reused, so `{{file:name}}` keeps resolving. Duplicate ids are skipped. Settings are not changed.
- **Replace:** delete all current app data and settings, then load the export (with the endpoint safeguards below). Reference files in the export replace everything. The API key is never imported or deleted.

Safety on replace: the exported **base URL and custom headers are ignored by default** (a hostile export must not be able to point your key at another host). Import shows the imported host and offers an explicit checkbox to restore those network settings. The local **remember key** preference is also kept, so an import cannot move your key between storage modes. Imported nudgers always start with **auto-run off** and use your current provider; per-nudger provider overrides are not imported, so a shared nudger pack cannot silently redirect the key to another preset host.

Validation drops malformed items with visible warnings rather than importing partial garbage. Older exports are still accepted and migrated the same way the browser database migrates itself: version 1 and 2 bundles get their global nudgers and shared files copied into every document, version 3 bundles have each document file copied per nudger that attaches it, and a file no nudger attaches is imported as an unassigned file of its document. Unsupported schema versions are rejected. Import does not validate the semantics of prompts; it does validate types, file extensions and references.

**Storage usage** is read from `navigator.storage.estimate()` and shown in the sidebar and Settings. The app warns at 80% and surfaces quota errors instead of silently losing a write. IndexedDB stores the whole document text, so very large documents and many reference files consume real space.

---

## Publishing to GitHub Pages

The expected repository is `nudger` and the site is `https://bitbutter.github.io/nudger/`.

The build uses Vite `base: './'` (relative assets) and hash routing (`#/doc/:id`, `#/doc/:id/files`, `#/templates`, `#/settings`), so it works from a repository subpath with no 404 fallback and no server rewrites. A repository named differently will still work with relative assets; only the public URL changes.

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
img-src 'self' data:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*;
base-uri 'none'; form-action 'none'; object-src 'none'
```

`connect-src https:` is broad **because custom provider endpoints are allowed**. This is the deliberate tradeoff: no third-party scripts are loaded, and `script-src 'self'` blocks injected script, but the page can send data to any HTTPS origin the user configures. The resolved prompt preview and the explicit provider setting are what keep that intentional. The two loopback entries let an HTTPS page talk to a local model server (for example Ollama at `http://localhost:11434`) over plain http; browsers treat loopback as a potentially trustworthy origin, and the app blocks plain `http://` to any other host when the page itself is served over HTTPS. A meta CSP cannot set `frame-ancestors`; there is no other backend defense.

---

## Data model

```ts
Document   { id, title, currentText, createdAt, updatedAt }
Version    { id, documentId, text, label?, createdAt, wordCount }
ReferenceFile { id, documentId, nudgerId: string | null, name, kind: "txt" | "md", content,
                createdAt, updatedAt, wordCount }
Nudger     { id, documentId, name, description?, color, system, prompt, fileIds[], providerId?, model?,
             temperature, maxTokens, maxContextChars, autoRun, enabled, done, budget,
             facts, factsPrompt, order, templateId?, createdAt, updatedAt }
Reply      { id, documentId, nudgerId, text, resolvedPrompt, fileIds[], model, provider,
             createdAt, status: "new" | "pinned" | "dismissed" | "archived", usage?,
             facts?: string[], factsError? }
Template   { id, name, description, system, prompt, facts?, factsPrompt?, temperature?, maxTokens?,
             maxContextChars?, builtin, createdAt, updatedAt }
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
8. **Each nudger has one budget, inside its own document.** The count is the saved replies for that nudger, **More +3** raises only that nudger's allowance, and clearing its history frees the count. There is no shared allowance between documents because nudgers are not shared.
9. **Failed runs are not saved as replies.** They appear in the card with the provider message, a Retry button and, where useful, an Open settings link. This keeps reply history meaningful and avoids failures consuming budget.
10. **Duplicating a document copies its versions and its nudger setup** (prompts, files, budget and generation settings) but not replies, and the copied nudgers start with auto-run off, so opening the duplicate does not immediately double model calls. Duplicating a nudger keeps prompts/files/color/model but resets auto-run, done and budget.
11. **Deleting a reference file detaches it from nudgers.** Old replies keep their resolved prompts. Renaming a referenced file warns that `{{file:oldname}}` placeholders need updating.
12. **Missing or unselected `{{file:name}}` blocks the run.** Unknown placeholders are warnings and are sent literally. A template with selected files but no file placeholder auto-appends them (as required) rather than warning.
13. **Import replace protects the API key path.** It ignores the exported base URL and custom headers unless the user explicitly opts in; it keeps the local remember-key choice; and it never touches the key itself. Merge preserves local settings and remaps duplicate file names.
14. **No stop-topics list, similarity warning, version diff, markdown rendering, or replace-selection action** in this version. The first three were optional; the last is a non-goal, and automatic insertion is explicitly out of scope.
15. **Per-nudger provider overrides share the global key**, because storing multiple keys was not requested, and a per-nudger key would complicate key export/privacy. Use a separate profile if you need two keys at once.
16. **Auto-run is per nudger with one global delay**, not a separate delay per nudger. It waits for a busy nudger to finish and then runs once, so the latest draft is not skipped.
17. **Reference uploads are capped at 2 MB per file** and validated as text (NUL/control-character check) to protect IndexedDB quota and reject binary files. The cap is a local implementation choice, not a product limit.
18. **The app uses hash routing.** It requires no server rewrites, works from a subpath, and makes every view reloadable.
19. **Exports include replies** even though the requirement only listed documents, versions, files, nudgers, templates and settings, because reply history is the audit trail for prompts. Keys remain excluded.
20. **The theme is dark by default.** The layout is beside-by-default: the draft on the left with a draggable divider, nudgers to the right in as many columns as fit, left to right. The divider width is stored in localStorage (`nudger.editorWidth`) because it is a per-device display preference, not document data; upgrading from the old stacked default moves stored settings once (database version 4).
21. **Fact clues are per nudger and selectively on**, not a document-wide panel. The three fact-oriented starters enable them; the rest and custom nudgers start off, and every nudger can toggle them. A document-wide list would be generic, duplicate work, and ignore each nudger's reference files.
22. **Fact clues share the nudge response** as one JSON object (`reply` + `facts`), not a second extraction request. The prompt protocol is validated locally, tolerates fences/prose, falls back to the plain reply, and refuses malformed JSON rather than showing raw data. This keeps cost and latency at one call while giving structured facts. The tradeoff is that a model can ignore the JSON protocol; the reply is then kept and the missing list is reported.
23. **Facts are clues, not verified facts.** They are stored per reply, labeled “model-generated; verify”, and never inserted into the draft. A dedicated Fact checker nudger remains the route for a deeper verification pass.

---

## Testing

`npm test` runs 153 tests in 16 files:

- placeholder resolution (`before_cursor`, `before_last_word`, paragraph, selection, case-insensitivity, unknown placeholders)
- reference-file insertion, wrappers, auto-append, missing/unselected files, unreferenced warnings, oversized trim, files dropped by trimming
- non-destructive version restore and autosave behavior
- document-bound nudgers: per-document listing and order, document duplication/deletion cascades, cross-document reply rejection, version 1 → 2 database migration, legacy export migration
- the reference-file panel rendering inside the document page (files listed, empty state)
- the auto-run trigger (cooldown plus pointer movement, resting mouse, single fire, cancel) and the two-sentence rule appended to every system prompt
- the draft column width preference (clamping, localStorage round-trip, unusable storage) and the version 4 upgrade that moves a leftover stacked layout beside the editor
- nudger-owned files: per-nudger listing and ordering, same names on different nudgers, adoption of unassigned files, duplication and deletion cascades, the version 5 upgrade (shared file copied per nudger, replies rewired, unattached files kept as unassigned), and older exports migrated to the same shape
- nudger → template conversion (placeholders and generation settings kept, files and document left behind) and template reuse in another document
- IndexedDB storage, CRUD, cascades, budgets, settings key stripping, export/import, merge remapping, import network safety
- provider request shapes for OpenAI-compatible and Anthropic, URL joining, model override fallback, reserved custom headers, loopback http, response size limits, auth/rate-limit/context/CORS/timeout errors
- a mocked end-to-end run (create document + file + nudger, resolve prompt, call model, save reply), structured reply/facts parsing, malformed JSON, plain-text fallback, retry and cancel
- starter library (including which starters enable fact clues), export validation, hash routing, API-key storage

The production app was also exercised in a real browser (Brave via Playwright) on 2026-10-22: document creation, cursor placeholders, versions and restore, reference uploads, nudger add/duplicate/reorder/disable/delete, prompt preview, a **live DeepSeek `deepseek-flash` run** including attached notes (one request, four fact clues tied to the nudge), a project-note run where the nudge asked about Helios and the facts returned Rust, version 2.1, the 2024-03-12 release date and the maintainer, a facts-off plain-text run, auto-run after typing, a 401 invalid-key error state, export → clear → import, custom template create/use/delete, and a 390 px mobile layout. The browser test scripts were development-only and are not part of the app.

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
