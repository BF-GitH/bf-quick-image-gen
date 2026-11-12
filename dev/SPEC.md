# BF Quick Image Gen: build spec (source of truth)

This file is the binding contract for the slim rewrite. Sections marked **BINDING** must be implemented
exactly (names, signatures, ids, strings). Everything else is guidance.

## 1. What we build

A small third-party extension for **TauriTavern v2.4.0** (Rust rewrite of SillyTavern, frontend compatible
with SillyTavern 1.19, used on Android) that also runs in plain SillyTavern 1.18+ (used for live tests).

1. A wand-menu entry "Senden + Bild". It sends the composer text like the normal send button, lets the LLM
   answer, **holds the answer back** until an image is generated and attached, then the answer appears
   with the image. A normal send is never affected.
2. The image prompt context **always contains message 0** of the chat plus the latest N messages.
3. Only two image providers: **NanoGPT** and **OpenRouter** (their dedicated image APIs).
4. Minimal German settings UI: provider, optional API key, model dropdown with favourites, prompt,
   an "Erweitert" block with five options, and a "Galerie" tab.

Out of scope: every other provider, inject mode, auto mode, slash commands, presets, world info,
reference images, batch generation, PNG metadata.

## 2. Facts about the hosts (verified in source, do not re-derive)

- `SillyTavern.getContext()` exists in both hosts and exposes: `chat` (full history, `chat[0]` is message 0,
  indices are absolute), `characters`, `characterId`, `groupId`, `groups`, `name1`, `name2`, `chatId`,
  `getCurrentChatId`, `mainApi`, `chatCompletionSettings` (live `oai_settings`), `extensionSettings` (live),
  `saveSettingsDebounced`, `eventSource`, `eventTypes`, `generateRaw`, `saveChat`, `appendMediaToMessage`,
  `ensureMessageMediaIsArray`, `getRequestHeaders`, `substituteParams`, `humanizedDateTime`,
  `callGenericPopup`, `POPUP_TYPE`, `scrollChatToBottom`.
- NOT on the context: `sendTextareaMessage`, `Generate`, `saveBase64AsFile`, `findSecret`. We do not import
  host modules. We click `#send_but` and call the same-origin routes directly.
- `eventSource.emit` awaits async listeners one after another. Non-streaming reply order:
  `chat.push(reply)` then awaited `MESSAGE_RECEIVED(index, type)` then the DOM render then the host saves the chat.
  So an async `MESSAGE_RECEIVED` listener that attaches media before returning makes text and image appear together.
- Streaming reply order: the message is in the DOM while tokens arrive, then `GENERATION_ENDED`, then
  `MESSAGE_RECEIVED`, then the host saves. Streaming is on when `mainApi === 'openai'` and
  `chatCompletionSettings.stream_openai === true`; both readers of that flag run before
  `CHAT_COMPLETION_SETTINGS_READY` is emitted.
- `document.body.dataset.generating === 'true'` while the host generates.
- Routes (same origin, JSON, headers from `getRequestHeaders()`):
  - `POST /api/secrets/find {key}` -> `{value}`; fails (403/404/500) unless the host setting
    "Allow Keys Exposure" is on. `POST /api/secrets/read` -> object keyed by secret name (array of masked
    entries, or `true`) telling whether a key is stored.
  - `POST /api/images/upload {image: <bare base64>, format, ch_name, filename}` -> `{path}` such as
    `user/images/<folder>/<file>.png` (usable as `<img src>`). `POST /api/images/delete {path}`.
- TauriTavern turns any `<a download>` click on a blob URL into the system save dialog (Android: one
  dialog per file). There is no silent write to the public Download folder.
- Message media contract: `message.extra.media = [{url, type:'image', title, source:'generated'}]`,
  `extra.media_index`, `extra.media_display`, `extra.inline_image = true` (false would hide the text).
  Never assign `extra.image` (read-only getter after migration).
- The chat DOM is a projection and may be virtualized: `#chat .mes[mesid="N"]` can be absent. Data in
  `chat[]` is the truth.

## 3. Rules (**BINDING**)

- Plain ES modules, no build step, no runtime dependencies. Modern syntax is fine (Chromium 110+).
- No static or dynamic import of host modules (nothing like `../../../../script.js`).
- UI texts German. Code, comments, identifiers English. Comments explain why, not what.
- No file over 300 lines (hard limit 400, guard-tested).
- No `alert`, `confirm`, `prompt`. Toasts and dialogs only through `src/host/st.js`.
- Never log, display or embed an API key. Error messages must not contain it.
- DOM ids/classes use the prefix `bfqig-` (wand ids use `bfqig_`).
- jQuery only where the host API demands a jQuery object.

### Layering (guard-tested in `tests/architecture.test.js`)

| Layer | Files | May import | Must not contain |
|---|---|---|---|
| PURE | `src/shared/**`, `src/providers/**`, `src/prompt/scene.js`, `src/flow/run-state.js`, `src/gallery/records.js`, `src/settings/defaults.js` | other PURE files | `document`, `window`, `localStorage`, `sessionStorage`, `SillyTavern`, `toastr`, `jQuery`, `$(`, any import from `src/host` |
| HOST | `src/host/**` | only files in `src/host` and `src/shared` | no import from any other `src` folder |
| WIRING/UI | everything else in `src`, plus `index.js` | PURE and HOST | `SillyTavern`, `__TAURITAVERN__`, `toastr`, a string starting with `/api/` |

The guard strips comments before matching, but do not use the forbidden identifiers in PURE code at all.
`fetch`, `AbortController`, `setTimeout`, `btoa`, `atob`, `URL`, `console` are fine in PURE code.

## 4. File map and ownership

| Lane | Owns |
|---|---|
| L1 providers | `src/providers/http.js`, `sizing.js`, `nanogpt.js`, `openrouter.js`, `index.js`; `tests/providers/*.test.js` |
| L2 pure core | `src/prompt/scene.js`, `src/flow/run-state.js`, `src/gallery/records.js`, `src/settings/defaults.js`; `tests/prompt/*.test.js`, `tests/flow/*.test.js`, `tests/gallery/*.test.js`, `tests/settings/*.test.js` |
| L3 host | `src/host/st.js`, `secrets.js`, `chat.js`, `images.js`, `llm.js`, `send.js` |
| L4 ui | `src/settings/store.js`, `keys.js`, `model-cache.js`, `model-picker.js`, `panel.js`; `src/gallery/store.js`, `view.js`; `src/wand/entry.js`; `src/flow/hold.js`; `style.css` |
| L5 composition | `index.js`, `src/prompt/build.js`, `src/flow/generate-image.js`, `src/flow/send-with-image.js`, `tests/architecture.test.js`, `tests/manifest.test.js`, `dev/mock-server.mjs`, `README.md` |

Already present (do not edit): `src/shared/constants.js`, `tests/fixtures/*.json` (real model-list samples),
`manifest.json`, `package.json`, `eslint.config.js`, `.github/workflows/ci.yml`, `LICENSE`, `.gitignore`.

## 5. Module contracts (**BINDING**)

### 5.1 `src/shared/constants.js` (exists)
`EXTENSION_ID`, `SETTINGS_KEY`, `LOG_PREFIX`, `PROVIDER_IDS`, `ASPECT_IDS`, `QUALITY_IDS`, `DEFAULT_MODELS`, `SECRET_KEYS`.

### 5.2 HOST: `src/host/st.js`
```js
export function getContext()                 // SillyTavern.getContext(); throws Error if unavailable
export async function whenHostReady()        // awaits window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__ if present; else resolves
export function getHostInfo()                // { isTauriTavern: boolean, platform: string } (window.__TAURITAVERN_HOST__?.platform ?? 'web')
export function onHostEvent(eventKey, handler)  // eventKey is a KEY of ctx.eventTypes, e.g. 'MESSAGE_RECEIVED'. Returns an unsubscribe function. Unknown key: no-op unsubscribe.
export function isGenerating()               // document.body.dataset.generating === 'true'
export function isChatOpen()                 // a character (characterId not undefined/null) or a group (groupId) is open
export function getChatId()                  // ctx.getCurrentChatId?.() ?? ctx.chatId ?? null
export function getExtensionSettingsRoot()   // ctx.extensionSettings (live object)
export function saveSettings()               // ctx.saveSettingsDebounced()
export function substituteMacros(text)       // ctx.substituteParams(text); on any error returns text unchanged
export function timestampName()              // ctx.humanizedDateTime?.() or an ISO-like fallback; result contains only [A-Za-z0-9@_-]
export const notify                          // { info, success, warning, error }: (message, { onClick, sticky } = {}) => void
export async function confirmDialog(message) // ctx.callGenericPopup(message, ctx.POPUP_TYPE.CONFIRM); resolves true only on confirm
```
`notify` wraps `toastr` with the title `BF Quick Image Gen`; `sticky` means no timeout; `onClick` maps to toastr `onclick`.

### 5.3 HOST: `src/host/secrets.js`
```js
export async function readStoredKey(secretKey)      // -> string | null. POST /api/secrets/find. Never throws.
export async function getStoredKeyState(secretKey)  // -> 'readable' | 'locked' | 'missing'. Never throws.
```
`locked` = `/api/secrets/read` reports a stored key (non-empty array or `true`) but `find` did not return it.

### 5.4 HOST: `src/host/chat.js`
```js
export function getChatLength()
export function getRawMessage(index)          // live message object or null
export function getMessageSnapshot(index)     // { index, name, isUser, isSystem, text } | null; text = extra.display_text ?? mes ?? '' (no cleaning here)
export function getParticipantNames()         // { user, character }
export function getImageFolderName()          // character name; group name for groups; fallback EXTENSION_ID
export function isMessageRendered(index)      // element #chat .mes[mesid="index"] exists
export function attachImageToMessage(index, { url, title })  // -> boolean (false if the message is gone). Mutates extra per section 2, re-renders media via ctx.appendMediaToMessage(message, $(element)) only if rendered. Does NOT save.
export async function saveChat()              // await ctx.saveChat(); logs and swallows errors
export function scrollChatToBottom()          // optional chaining on the context function
```
`attachImageToMessage` exact mutation: create `extra` if not an object; call `ctx.ensureMessageMediaIsArray?.(message)`;
ensure `extra.media` is an array; if it is empty and `extra.media_display` is unset, set `media_display = 'gallery'`;
push `{ url, type: 'image', title, source: 'generated' }`; `media_index = media.length - 1`; `inline_image = true`.

### 5.5 HOST: `src/host/images.js`
```js
export async function uploadImage({ base64, extension, folder, fileName })  // -> path string. Throws Error('Bild konnte nicht gespeichert werden (HTTP <status>)').
export async function deleteImage(path)                                      // -> boolean
export async function saveToDevice(url, fileName)                            // fetch(url) -> blob -> object URL -> temporary <a download> click; revoke after 60 s. Throws on fetch failure.
```
`fileName` for upload must not contain dots (the host derives the extension from `format`).

### 5.6 HOST: `src/host/llm.js`
```js
export async function generateText({ prompt, systemPrompt })   // -> string ('' if nothing). await ctx.generateRaw({ prompt, systemPrompt }). Propagates host errors.
```

### 5.7 HOST: `src/host/send.js`
```js
export function getComposerText()        // value of #send_textarea or ''
export function clickSend()              // clicks #send_but; false if it does not exist
export function disableStreamingOnce()   // -> restore function | null
export function repairStreamingFlag()    // called once at init
```
`disableStreamingOnce`: only when `ctx.mainApi === 'openai'` and `ctx.chatCompletionSettings.stream_openai === true`:
set it to `false`, write `localStorage['bfqig_stream_restore'] = '1'`, return an idempotent function that sets it
back to `true` and removes the marker. Otherwise return `null`. `repairStreamingFlag`: if the marker exists
(the app died inside the window), set `stream_openai = true`, call `saveSettingsDebounced`, remove the marker.
All `localStorage` access in try/catch.

### 5.8 PURE: `src/providers/http.js`
```js
export class ProviderError extends Error     // constructor(message, { status = 0, provider = '', code = '' } = {}); name = 'ProviderError'
export async function requestJson(url, { method = 'GET', headers, body, signal, timeoutMs = 180000, fetchImpl = fetch, provider = '' } = {})
export async function fetchImageAsBase64(url, { signal, timeoutMs = 60000, fetchImpl = fetch } = {})   // -> { base64, mime }
export function parseDataUrl(text)           // 'data:image/png;base64,AAAA' -> { base64, mime } | null
export function sniffImageMime(base64)       // magic bytes -> 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; default 'image/png'
export function extensionForMime(mime)       // 'png' | 'jpg' | 'webp' | 'gif' (default 'png')
export function arrayBufferToBase64(buffer)  // chunked String.fromCharCode + btoa
```
`requestJson`: `body` is an object and is JSON-stringified. Non-2xx: read the body, take the message from
`error.message`, then `error` (string), `message`, `detail`, else the first 200 characters of the text, and throw
`ProviderError("<provider>: <status> – <message>", { status, provider, code })` with `code = error.code ?? ''`.
A 2xx JSON body with an `error` member is treated the same way (status from the response).
Timeout: `ProviderError("<provider>: Zeitüberschreitung nach <n> s", { code: 'timeout' })`.
Caller abort: rethrow a `DOMException` named `AbortError`. Network failure:
`ProviderError("<provider>: Netzwerkfehler (<reason>)", { code: 'network' })`. Combine caller signal and
timeout with an internal `AbortController` (do not rely on `AbortSignal.any`).

### 5.9 PURE: `src/providers/sizing.js`
```js
export function parseRatio(text)             // '16:9' -> 1.777..., '1024x768' and '1024*768' -> 1.333..., '19.5:9' ok; else null
export function parsePixelSize(text)         // 'WxH' | 'W*H' -> { width, height } | null
export function nearestByRatio(candidates, targetRatio)  // verbatim candidate minimising |ln(ratio/target)|; null if none parse
export function pickTier(tiers, quality)     // verbatim tier string | null
export function selectNanoGptSize(supported, aspectId, quality)     // -> { resolution?, aspect_ratio? }
export function selectOpenRouterSize(supported, aspectId, quality)  // -> { resolution?, aspect_ratio? }
```
Tier value: `/^(\d+(?:\.\d+)?)k$/i` -> that number; `/^\d+$/` -> n/1000 (`'512'` -> 0.512).
`pickTier` standard: smallest tier >= 1, else the largest. High: largest tier <= 2, else smallest tier >= 1, else the largest.

`selectNanoGptSize(supported, aspectId, quality)`; `supported.resolutions` is an array of strings,
`supported.aspect_ratio` an optional array. Classify `resolutions` entries: pixel (`WxH`, `W*H`), ratio (`W:H`),
tier, named (`square_hd`, `square`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`), other (ignored).
1. Pixel entries exist: among entries whose ratio error is within 0.02 of the best error pick by area:
   standard = smallest area >= 900000, else the largest; high = largest area <= 4500000, else the smallest.
   Return `{ resolution: <verbatim> }`.
2. Else ratio entries exist: `{ resolution: nearestByRatio(ratioEntries) }`.
3. Else named entries exist: nearest by ratio using square=1, 4_3=4/3 or 3/4, 16_9=16/9 or 9/16; for 1:1 prefer
   `square_hd` over `square`. `{ resolution: <name> }`.
4. Else: `aspect_ratio` list present -> `aspect_ratio: nearestByRatio(list without 'auto')` (if only `auto`
   remains, send `'auto'`); tiers present -> `resolution: pickTier(tiers, quality)`. Both may be set.
5. Nothing usable: `{}`.

`selectOpenRouterSize`: `supported.aspect_ratio?.values` -> `aspect_ratio: nearestByRatio(values without 'auto')`;
`supported.resolution?.values` -> `resolution: pickTier(values, quality)`; missing members are omitted.

Required test cases (fixtures in `tests/fixtures`): NanoGPT `flux-schnell` + `2:3` -> `{resolution:'768x1024'}`;
`z-image-turbo` + `16:9` -> `{resolution:'1280*720'}`; `z-image-turbo` + `1:1` standard -> `'1024*1024'`, high -> `'1536*1536'`;
`qwen-image-3` + `9:16` standard -> `{aspect_ratio:'9:16', resolution:'1k'}`, high -> `'2k'`;
`grok-imagine-image` + `3:4` -> `{resolution:'3:4'}`; `seedream-v4.5` + `1:1` standard -> `'1920x1920'`;
`nano-banana-2` + `2:3` -> `{aspect_ratio:'2:3', resolution:'1k'}`; a model with only `['auto']` -> `{}`.
OpenRouter `google/gemini-2.5-flash-image` + `9:16` -> `{aspect_ratio:'9:16'}`;
`google/gemini-3.1-flash-image` + `1:1` standard -> `{aspect_ratio:'1:1', resolution:'1K'}`, high -> `'2K'`;
`openai/gpt-image-1` + `16:9` -> `{aspect_ratio:'3:2'}`; `meta/muse-image` -> `{}`.

### 5.10 PURE: `src/providers/nanogpt.js` and `src/providers/openrouter.js` (same shape)
```js
export const id, label, secretKey, defaultModel, MODELS_URL, GENERATE_URL
export function normalizeModels(json)                                   // -> ModelInfo[] sorted by name
export async function listModels({ signal, fetchImpl } = {})            // GET MODELS_URL without auth -> normalizeModels
export function buildRequest({ model, prompt, aspect, quality, modelInfo })   // -> { url, body } (pure)
export async function generateImage({ apiKey, model, prompt, aspect, quality, modelInfo, signal, fetchImpl })  // -> { base64, mime } | { remoteUrl }
```
`ModelInfo = { id, name, supported, maxPromptChars, pricePerImage, nsfw }` (`supported` = raw `supported_parameters`
or `{}`; `maxPromptChars` number or null; `pricePerImage` = smallest numeric USD price or null; `nsfw` boolean or null).

| | NanoGPT | OpenRouter |
|---|---|---|
| `id` / `label` | `nanogpt` / `NanoGPT` | `openrouter` / `OpenRouter` |
| `secretKey` | `SECRET_KEYS.nanogpt` | `SECRET_KEYS.openrouter` |
| `defaultModel` | `DEFAULT_MODELS.nanogpt` | `DEFAULT_MODELS.openrouter` |
| `MODELS_URL` | `https://nano-gpt.com/api/v1/images/models` | `https://openrouter.ai/api/v1/images/models` |
| `GENERATE_URL` | `https://nano-gpt.com/api/v1/images` | `https://openrouter.ai/api/v1/images` |
| keep model if | `architecture.input_modalities` includes `text`, `capabilities.image_generation !== false`, id does not match `/(^|[\/-])edit([\/-]|$)|upscal|eras|remov|inpaint/i` | `architecture.output_modalities` includes `image` and `(supported_parameters.input_references?.min ?? 0) < 1` |
| size fields | `selectNanoGptSize(modelInfo?.supported ?? {}, aspect, quality)` | `selectOpenRouterSize(...)` |
| body | `{ model, prompt, n: 1, ...size }` | `{ model, prompt, ...size }` |
| price | min of numeric `pricing.per_image` values | `null` |

`buildRequest` truncates `prompt` to `modelInfo?.maxPromptChars ?? 4000` characters. Headers:
`Authorization: Bearer <key>`, `Content-Type: application/json`. Timeout 180 s.
Response: first entry of `data[]`: `b64_json` -> `{ base64, mime: media_type ?? sniffImageMime(base64) }`;
`url` -> `parseDataUrl` if it is a data URL, else `fetchImageAsBase64`; if that download fails (for example CORS)
return `{ remoteUrl: url }`. NanoGPT also accepts a top-level `image` (bare base64). No image at all:
`ProviderError('<label>: Antwort enthält kein Bild')`. A missing `apiKey` throws `ProviderError('<label>: Kein API-Key')`.

Expected with the fixtures: NanoGPT keeps exactly `flux-schnell`, `z-image-turbo`, `qwen-image-3`, `nano-banana-2`,
`grok-imagine-image`, `seedream-v4.5`; OpenRouter drops exactly `krea/k3-edit`.

### 5.11 PURE: `src/providers/index.js`
```js
export const PROVIDERS            // { nanogpt, openrouter } (module namespace objects)
export function getProvider(id)   // throws Error(`Unbekannter Anbieter: ${id}`)
```

### 5.12 PURE: `src/prompt/scene.js`
```js
export const DEFAULT_INSTRUCTION
export const LIMITS = { firstMessageChars: 2500, messageChars: 1500 }
export function cleanMessageText(text)
export function truncateText(text, maxChars)          // cuts at a word boundary when one is near; no ellipsis
export function collectContext({ chatLength, replyIndex, recentCount, getSnapshot })  // -> { first: {name,text}|null, recent: [{name,text}] }
export function buildSceneBlock({ first, recent })    // -> string
export function buildLlmRequest({ instruction, sceneBlock })   // -> { systemPrompt, prompt }
export function buildDirectPrompt({ instruction, sceneBlock }) // -> string
export function cleanLlmOutput(text)
export function finalizePrompt(text, { styleSuffix = '', maxChars = 1800 } = {})
```
`DEFAULT_INSTRUCTION` (exact): `Depict the current moment of this roleplay as one image: the characters present with
their appearance (hair, eyes, build, clothing), their pose and expression, the location, lighting and mood. Take the
characters' looks and the setting from the first message and the current action from the latest messages.` (one line).

`cleanMessageText`: remove `<think>`, `<thinking>`, `<reasoning>` blocks, `<style>`/`<script>` blocks and HTML comments;
strip remaining tags; `![alt](url)` -> `alt`, `[text](url)` -> `text`; decode `&amp; &lt; &gt; &quot; &#39; &nbsp;`;
collapse spaces/tabs to one space and blank-line runs to one newline; trim.

`collectContext`: `first` = cleaned snapshot 0 (even if hidden) truncated to `LIMITS.firstMessageChars`, or null if the
chat is empty or the text is empty. `recent`: walk from `replyIndex` down to index 1, skip snapshots that are null,
`isSystem`, or empty after cleaning, stop at `recentCount` entries, return them oldest first, each truncated to
`LIMITS.messageChars`. Message 0 is never repeated in `recent`. If `replyIndex` is 0, `recent` is empty.

`buildSceneBlock` format (sections omitted when empty):
```
[First message of the chat]
<name>: <text>

[Latest messages, oldest first]
<name>: <text>

<name>: <text>
```
`buildLlmRequest`: `systemPrompt` = `You write prompts for an AI image generator. Do not continue the story and do not
answer in character. Output only the image prompt: English, one paragraph, at most 120 words, concrete visual details,
no dialogue, no explanations.`; `prompt` = `Task: <instruction>\n\n<sceneBlock>\n\nImage prompt:`.
`buildDirectPrompt` = `<instruction>\n\n<sceneBlock>`.
`cleanLlmOutput`: drop think blocks; if a fenced code block exists use its content; remove a leading
`Prompt:` / `Image prompt:` label; strip wrapping quotes, backticks and asterisks; collapse whitespace to single spaces.
`finalizePrompt`: suffix = ` Style: <styleSuffix>` when the trimmed suffix is non-empty; the text is truncated so that
text plus suffix fits `maxChars` (the suffix is never cut).

### 5.13 PURE: `src/flow/run-state.js`
```js
export const MESSAGES    // German user-facing strings used by the controller (see section 6)
export function createSendWithImageController({ host, precheck, processReply, hold, notify, onFailure, timers, config })
// -> { start(): Promise<boolean>, cancel(): void, isActive(): boolean, dispose(): void }
```
Dependencies: `host = { isChatOpen, isGenerating, getComposerText, clickSend, getChatLength, getRawMessage,
disableStreamingOnce, onEvent(eventKey, handler) -> unsubscribe }`; `precheck: async () => void` (throws Error with a
user-facing message); `processReply: async (messageIndex, signal) => void`; `hold = { engage(userIndex), release(),
setStatus(text | null, { onCancel } = {}) }`; `notify = { warning(msg), error(msg) }`;
`onFailure(messageIndex, error)` optional; `timers = { setTimeout, clearTimeout, setInterval, clearInterval }` default
`globalThis`; `config = { startTimeoutMs: 8000, endedGraceMs: 1500, watchdogMs: 2000 }` defaults.

`start()`:
1. Already active -> `notify.warning(MESSAGES.busy)`, false. No chat -> `MESSAGES.noChat`. Host generating ->
   `MESSAGES.generating`. Trimmed composer text empty -> `MESSAGES.emptyText`. Text starts with `/` -> `MESSAGES.slash`.
2. `await precheck()`; on throw `notify.error(error.message)`, false. Re-check "active" and "generating" afterwards.
3. Create the run: `phase = 'armed'`, `userIndex = host.getChatLength()`, `abort = new AbortController()`,
   `restoreStreaming = host.disableStreamingOnce()`. `hold.engage(userIndex)`; `hold.setStatus(MESSAGES.statusReply)`.
4. Start the start-timeout and the watchdog interval, then `host.clickSend()`. If it returns false:
   `notify.error(MESSAGES.noSendButton)`, finish, false. Else true.

Events (subscribed once at creation through `host.onEvent`, removed by `dispose()`):
- `GENERATION_STARTED (type, options, dryRun)`: ignore without a run, when `dryRun === true`, or `type === 'quiet'`.
  In phase `armed`: phase becomes `generating`, clear the start-timeout.
- `CHAT_COMPLETION_SETTINGS_READY`: when the phase is not `armed`, call and clear `restoreStreaming`.
- `MESSAGE_SENT (index)`: while `armed`/`generating` and index is an integer: `userIndex = index`, `hold.engage(index)`.
- `MESSAGE_RECEIVED (index, type)`: ignore without a run, when already handled, when `type === 'first_message'`,
  when `index <= userIndex`, or when the message is missing / `is_user` / `is_system`. Otherwise mark handled,
  phase `imaging`, clear timers, `hold.setStatus(MESSAGES.statusImage, { onCancel: cancel })`, then
  `await processReply(index, abort.signal)`. Errors: an abort (signal aborted or error name `AbortError`) is silent;
  anything else calls `onFailure(index, error)`. Always finish afterwards. **The listener must return the promise**
  so the host waits for it.
- `GENERATION_STOPPED`: abort; finish unless the phase is `imaging` (there the pending `processReply` finishes).
- `GENERATION_ENDED`: ignore without a run, when handled, or in phase `armed`. Otherwise (re)start a grace timer of
  `endedGraceMs`; when it fires and the run is still unhandled, finish. (Streaming emits ENDED before RECEIVED.)
- `CHAT_CHANGED`: abort and finish.
- Start-timeout fires in phase `armed`: `notify.warning(MESSAGES.notStarted)`, finish.
- Watchdog tick: in phase `generating`, unhandled: count consecutive ticks with `!host.isGenerating()`; at 2, finish.

`cancel()`: abort; finish unless `imaging`. `finish()`: only for the current run; clear all timers, call
`restoreStreaming` if still set, `hold.release()`, `hold.setStatus(null)`, clear the run.
A finish triggered by an older run must not end a newer one.

Required tests (fake host with a manual event bus, manual timers): happy path non-streaming; streaming order
(ENDED then RECEIVED inside the grace time); no reply (ENDED, grace expires); stop during the LLM phase; stop during
imaging (signal aborted, no `onFailure`); `processReply` failure -> `onFailure`; precheck failure (no click);
each early-exit warning; start-timeout; chat change during imaging; ignored MESSAGE_RECEIVED variants; dry-run and
quiet GENERATION_STARTED ignored; second `start()` while active; watchdog finish; streaming restored exactly once.

### 5.14 PURE: `src/gallery/records.js`
```js
export const GALLERY_LIMIT = 200
export function addRecord(list, record)     // -> new array, newest first, capped at GALLERY_LIMIT. record = { url, prompt, provider, model, character, timestamp }; prompt stored truncated to 400 chars; an existing record with the same url is replaced
export function removeRecord(list, url)     // -> new array
```

### 5.15 PURE: `src/settings/defaults.js`
```js
export const DEFAULT_SETTINGS   // frozen template, see below
export function normalizeSettings(saved)                 // -> fresh plain object with every key valid; never throws
export function toggleFavorite(list, modelId)            // -> new array
```
```js
{ provider: 'nanogpt', keys: { nanogpt: '', openrouter: '' }, models: { ...DEFAULT_MODELS },
  favorites: { nanogpt: [], openrouter: [] }, instruction: DEFAULT_INSTRUCTION, aspect: '1:1', quality: 'standard',
  contextMessages: 4, styleSuffix: '', useLlm: true, autoSaveDialog: false, gallery: [] }
```
Validation: `provider` in `PROVIDER_IDS`; `aspect` in `ASPECT_IDS`; `quality` in `QUALITY_IDS`; `contextMessages`
integer clamped to 1..20; strings coerced; `favorites.*` arrays of unique strings; `gallery` array of objects with a
string `url` (others dropped), capped at `GALLERY_LIMIT`; an empty `instruction` becomes `DEFAULT_INSTRUCTION`;
empty `models.<id>` becomes the default model.

### 5.16 UI: `src/settings/store.js`, `keys.js`, `model-cache.js`
```js
// store.js
export function getSettings()            // live object at extensionSettings[SETTINGS_KEY]; the first call normalizes the saved value and installs it (same object afterwards)
export function updateSettings(patch)    // Object.assign onto the live object, then saveSettings()
// keys.js
export async function resolveApiKey(provider)     // own key (settings.keys[provider.id], trimmed) -> readStoredKey(provider.secretKey) -> throws Error(MESSAGE for the state)
export async function describeKeyState(provider)  // -> { state: 'own' | 'readable' | 'locked' | 'missing', message }
// model-cache.js
export async function getModels(providerId, { force = false } = {})  // memory, then localStorage 'bfqig_models_<id>' ({ timestamp, models }) if younger than 7 days, else provider.listModels(); on fetch failure return a stale cache if there is one, else throw
export async function getModelInfo(providerId, modelId)              // -> ModelInfo | null, never throws
```

### 5.17 UI: `src/settings/model-picker.js`, `panel.js`
```js
export function createModelPicker({ onChange })   // -> { element, refresh(providerId, { force } = {}) }
export async function mountSettingsPanel({ onTestImage })   // onTestImage: async () => ({ url, prompt })
```
The panel is an ST `inline-drawer` appended to `#extensions_settings2` (fallback `#extensions_settings`).
Use host classes for a native look (`menu_button`, `text_pole`, `checkbox_label`, `flex-container`).
Ids (**BINDING**, used by the live test):

| Element | Id |
|---|---|
| root | `bfqig-settings` |
| tab buttons / panes | `bfqig-tab-settings`, `bfqig-tab-gallery` / `bfqig-pane-settings`, `bfqig-pane-gallery` |
| provider select | `bfqig-provider` |
| key input (type password) / status | `bfqig-key` / `bfqig-key-status` |
| model filter / select / favourite / refresh / info | `bfqig-model-filter`, `bfqig-model`, `bfqig-model-fav`, `bfqig-model-refresh`, `bfqig-model-info` |
| prompt textarea / reset | `bfqig-instruction` / `bfqig-instruction-reset` |
| advanced `<details>` | `bfqig-advanced` |
| aspect, quality, context count, style, LLM checkbox | `bfqig-aspect`, `bfqig-quality`, `bfqig-context`, `bfqig-style`, `bfqig-use-llm` |
| test button | `bfqig-test` |
| gallery: auto-save checkbox, grid, empty note | `bfqig-auto-save`, `bfqig-gallery-grid`, `bfqig-gallery-empty` |
| gallery item | class `bfqig-gallery-item` |
| viewer overlay, save, delete, close | `bfqig-viewer`, `bfqig-viewer-save`, `bfqig-viewer-delete`, `bfqig-viewer-close` |

Model select: `<optgroup label="★ Favoriten">` first (only if any), then `<optgroup label="Alle Modelle">`. A stored
model that is not in the list stays selectable as `"<id> (nicht in der Liste)"`. The filter input narrows the
options by substring. The star toggles the selected model in `favorites[provider]`. Info line: price for NanoGPT
(`ca. 0,0085 $ pro Bild`), else empty. Model list load failure: show the message in the info line, keep the stored model.
Every input writes through `updateSettings` on `change`/`input`. Switching the provider refreshes key status and models.
The viewer overlay carries `data-tt-mobile-surface="fullscreen-window"` and respects `env(safe-area-inset-*)`.

### 5.18 UI: `src/gallery/store.js`, `view.js`
```js
// store.js
export function listRecords()
export function addGalleryRecord(record)       // addRecord + updateSettings + notify listeners
export function removeGalleryRecord(url)
export function onGalleryChange(listener)      // -> unsubscribe
// view.js
export function createGalleryView()            // -> { element, refresh() }; subscribes to onGalleryChange
export function openImageViewer(record)
```
Grid of lazy-loaded thumbnails (`<img loading="lazy">`), newest first. Viewer: image, prompt, model, date, buttons
"Auf Gerät speichern" (`saveToDevice(url, 'tauri_<timestampName()>.<ext>')`), "Löschen" (after `confirmDialog`:
`deleteImage` then `removeGalleryRecord`), "Schließen". Tap on the backdrop closes.

### 5.19 UI: `src/wand/entry.js`, `src/flow/hold.js`
```js
export async function addWandEntry({ onClick })   // -> boolean. Waits up to 30 s for #extensionsMenu, idempotent
export function createHold()                      // -> { engage(userIndex), release(), setStatus(text | null, { onCancel } = {}) }
```
Wand markup (**BINDING**): `<div id="bfqig_wand_container" class="extension_container"><div id="bfqig_send_with_image"
class="list-group-item flex-container flexGap5" role="button" tabindex="0" title="Text senden und Antwort mit Bild
erhalten"><div class="fa-fw fa-solid fa-image extensionsMenuExtensionButton"></div><span>Senden + Bild</span></div></div>`
appended to `#extensionsMenu`. The host closes the menu itself.
`engage(userIndex)`: one `<style id="bfqig-hold-style">` with the rule
`#chat .mes[mesid="<userIndex>"] ~ .mes { display: none !important; }` (replace the rule on repeated calls).
`release()` removes it. `setStatus(text, { onCancel })`: a bar `#bfqig-status` (spinner icon, text, and a button
`#bfqig-status-cancel` labelled "Text sofort zeigen" only when `onCancel` is given) inserted directly before
`#send_form` (fallback: appended to `document.body`); `null` removes it.

### 5.20 WIRING: `src/prompt/build.js`
```js
export async function buildImagePrompt({ replyIndex, settings, maxPromptChars })   // -> { prompt, usedLlm }
```
`collectContext` (snapshots from `host/chat.js`) -> `buildSceneBlock` -> instruction through `substituteMacros`.
With `settings.useLlm`: `generateText(buildLlmRequest(...))` -> `cleanLlmOutput`; if that throws or is empty, log a
warning and fall back to `buildDirectPrompt`. Always finish with `finalizePrompt`.

### 5.21 WIRING: `src/flow/generate-image.js`
```js
export async function checkConfiguration()                                   // throws Error (German) when no key can be resolved
export async function generateImageForMessage(messageIndex, { signal, saveBefore = false, saveAfterAttach = false } = {})  // -> { url, prompt }
export async function generateTestImage({ signal } = {})                     // -> { url, prompt }
```
`generateImageForMessage` steps, checking `signal.aborted` after every await (throw a `DOMException` `AbortError`):
settings -> provider -> model (`settings.models[id] || provider.defaultModel`) -> `resolveApiKey` ->
`saveBefore ? saveChat()` -> `getModelInfo` -> `buildImagePrompt` (`maxPromptChars = min(modelInfo?.maxPromptChars ?? 1800, 4000)`)
-> `provider.generateImage` -> if `remoteUrl`: use it as url and `notify.warning(...)`; else `uploadImage` with
`extensionForMime(mime)`, `folder: getImageFolderName()`, `fileName: 'bfqig_' + timestampName()` ->
`attachImageToMessage` (false -> `Error('Die Nachricht ist nicht mehr vorhanden.')`) -> `addGalleryRecord` ->
`saveAfterAttach ? saveChat()` -> if `settings.autoSaveDialog` and not remote: `saveToDevice(url, 'tauri_<ts>.<ext>')`
without awaiting (log failures).
`generateTestImage`: fixed prompt `A cozy fantasy tavern interior at night, warm lantern light, wooden beams, detailed
illustration` through `finalizePrompt`, upload into the folder `EXTENSION_ID`, gallery record with character `Test`.

### 5.22 WIRING: `src/flow/send-with-image.js`, `index.js`
```js
export function initSendWithImage()   // -> { start(): Promise<boolean>, retry(messageIndex): Promise<void> }
```
Builds the controller with: host functions from `src/host`, `precheck = checkConfiguration`,
`processReply = (index, signal) => generateImageForMessage(index, { signal, saveBefore: true })`,
`hold = createHold()`, and `onFailure` showing a sticky error toast
`Bild fehlgeschlagen: <message> – Tippen zum Wiederholen.` whose click calls `retry(index)`.
`retry`: refuse while the controller is active or the host generates, or when the chat id or the message object
changed since the failure; otherwise show the status bar and run
`generateImageForMessage(index, { signal, saveAfterAttach: true })`; failures show the same toast again.
`index.js`: `whenHostReady()` -> `repairStreamingFlag()` -> `getSettings()` -> `initSendWithImage()` ->
`mountSettingsPanel({ onTestImage: generateTestImage })` -> `addWandEntry({ onClick: () => flow.start() })`;
a failing init is logged with `LOG_PREFIX` and never throws.

## 6. UI copy (**BINDING**, German)

| Key / place | Text |
|---|---|
| drawer title | `BF Quick Image Gen` |
| tabs | `Einstellungen`, `Galerie` |
| labels | `Anbieter`, `API-Key`, `Modell`, `Prompt`, `Erweitert`, `Seitenverhältnis`, `Qualität`, `Kontext-Nachrichten`, `Stil-Zusatz` |
| key placeholder | `leer = gespeicherten Key der App verwenden` |
| key state own | `Eigener Key wird verwendet.` |
| key state readable | `Der in der App gespeicherte Key wird verwendet.` |
| key state locked | `In der App ist ein Key gespeichert, aber für Erweiterungen gesperrt. Entweder in TauriTavern unter Einstellungen → Misc „Allow Keys Exposure“ einschalten und die App neu starten, oder den Key hier eintragen.` |
| key state missing | `Kein Key gefunden. Key hier eintragen oder in der App bei den API-Verbindungen speichern.` |
| model filter placeholder | `Modell suchen …` |
| prompt reset | `Standard` |
| aspect options | `Quadrat 1:1`, `Hochformat 2:3`, `Hochformat 3:4`, `Hochformat 9:16`, `Querformat 3:2`, `Querformat 4:3`, `Querformat 16:9` |
| quality options | `Standard (1K)`, `Hoch (2K, teurer)` |
| context hint | `Zusätzlich zur ersten Nachricht des Chats, die immer dabei ist.` |
| style placeholder | `z. B. anime style, soft lighting` |
| LLM checkbox | `Bildprompt vom Chat-Modell schreiben lassen (empfohlen)` |
| test button | `Testbild generieren` |
| gallery auto-save | `Nach jedem Bild den Speichern-Dialog öffnen` |
| gallery hint | `Bilder liegen im Datenordner der App (user/images). Android lässt Erweiterungen nicht still in den Download-Ordner schreiben: „Auf Gerät speichern“ öffnet den System-Dialog, dort z. B. Download/tauri wählen.` |
| gallery empty | `Noch keine Bilder.` |
| viewer buttons | `Auf Gerät speichern`, `Löschen`, `Schließen` |
| delete confirm | `Bild endgültig löschen? Es verschwindet auch aus der Chat-Nachricht.` |
| `MESSAGES.busy` | `Es läuft bereits ein Bild-Auftrag.` |
| `MESSAGES.noChat` | `Kein Chat geöffnet.` |
| `MESSAGES.generating` | `Es läuft bereits eine Generierung.` |
| `MESSAGES.emptyText` | `Bitte zuerst Text ins Nachrichtenfeld schreiben.` |
| `MESSAGES.slash` | `Slash-Befehle bitte normal senden.` |
| `MESSAGES.noSendButton` | `Senden-Knopf nicht gefunden.` |
| `MESSAGES.notStarted` | `Senden wurde nicht gestartet.` |
| `MESSAGES.statusReply` | `Antwort wird erstellt …` |
| `MESSAGES.statusImage` | `Bild wird generiert …` |
| remote-only warning | `Bild konnte nicht lokal gespeichert werden, es ist nur verlinkt.` |

## 7. Verification

- Unit tests: `node --test` (Node built-in runner, `node:assert/strict`). No DOM library. Tests must exercise real
  logic with the real fixtures; a test that only asserts a mocked fetch was called is not acceptable.
- `tests/architecture.test.js` (L5) scans `index.js` and `src/**/*.js` statically and fails on: a layering violation
  (table in section 3), an import of a host module (specifier containing `script.js`, `/scripts/` or starting with
  `../../../`), a file over 400 lines, a relative import whose target file does not exist, or an imported name the
  target does not export. `tests/manifest.test.js` checks that `manifest.json` points at existing `js`/`css` files,
  has `requires: []`, and that its version equals the `package.json` version.
- Lane commands: `node --test "tests/<area>/*.test.js"` and `npx eslint <own paths>`. Never run the whole suite
  from a lane (parallel agents collide); the integrator runs `npm run verify`.
- `dev/mock-server.mjs` (L5, no dependencies, port from `PORT`, default 8124, CORS `*` incl. `OPTIONS`):
  `GET /health`; `GET /v1/models`; `POST /v1/chat/completions` (JSON, or SSE when `stream: true`; if the system
  message contains `image generator` it answers `a cozy tavern at night, warm lantern light`, else a short German
  roleplay line); `POST /nanogpt/api/v1/images` -> `{ data: [{ b64_json }] }` (`?mode=url` -> `{ data: [{ url }] }`
  pointing at `GET /static/image.png`); `POST /openrouter/api/v1/images` -> `{ created, data: [{ b64_json, media_type }] }`.
  Image routes require a non-empty Bearer token (else 401 with a provider-style error body), wait `MOCK_IMAGE_DELAY_MS`
  (default 2500), answer 500 `{ error: { message: 'mock failure' } }` when the prompt contains `FAIL`, and log one
  line per request. The PNG is generated in code (valid 256x256 image, own CRC32).
- Live test (orchestrator): real SillyTavern 1.18 instance with this extension and the mock server.
- Cannot be verified here and must be stated as unverified: real provider responses, TauriTavern on Android.
