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
export function adoptToasts(dialog)          // moves (or creates) #toast-container into an open dialog of ours, as the hosts do for their popups
export function releaseToasts(dialog)        // moves a filled #toast-container back to body, removes an empty one
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
export function detachImageFromChat(url)      // -> number of messages changed. Removes media entries with that url from every message of the open chat. Does NOT save.
export async function saveChat()              // await ctx.saveChat(); logs and swallows errors
export function scrollChatToBottom()          // optional chaining on the context function
```
`attachImageToMessage` exact mutation: create `extra` if not an object; call `ctx.ensureMessageMediaIsArray?.(message)`;
ensure `extra.media` is an array; if it is empty and `extra.media_display` is unset, set `media_display = 'gallery'`;
push `{ url, type: 'image', title, source: 'generated' }`; `media_index = media.length - 1`; `inline_image = true`.

`detachImageFromChat` mirrors the host's own "delete one" media handler (`deleteMessageMedia` in
`public/scripts/chats.js`, same code in both hosts): urls match after stripping leading slashes; per matching
entry (highest position first) `media.splice(position, 1)`, and if `media_index === position` it becomes
`clamp(position > 0 ? position - 1 : 0, 0, media.length - 1)`. The last image leaves `media = []` (the host
renders that as no media). A mounted message is re-rendered with `ctx.appendMediaToMessage(message, $(element), 'keep')`.

### 5.5 HOST: `src/host/images.js`
```js
export async function uploadImage({ base64, extension, folder, fileName })  // -> path string. Throws Error('Bild konnte nicht gespeichert werden (HTTP <status>)').
export async function deleteImage(path)                                      // -> boolean
export async function saveToDevice(url, fileName)                            // fetch(url) -> blob -> object URL -> temporary <a download> click; revoke after 60 s. Throws on fetch failure.
```
`fileName` for upload must not contain dots (the host derives the extension from `format`). `uploadImage` replaces
`#`, `%`, `?` and `&` in the folder name with `_` before sending it as `ch_name` (the host keeps them and returns the
path unencoded, so a URL would be cut at them).

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
export function sniffImageMime(base64)       // magic bytes -> 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml' (bytes start with "<svg" or "<?xml" after optional whitespace); default 'image/png'
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
`ModelInfo = { id, name, supported, maxPromptChars, pricePerImage, prices, nsfw }` (`supported` = raw `supported_parameters`
or `{}`; `maxPromptChars` number or null; `prices` = the numeric entries of `pricing.per_image` keyed like the
request's `resolution`, or null; `pricePerImage` = smallest value of `prices` or null; `nsfw` boolean or null).

| | NanoGPT | OpenRouter |
|---|---|---|
| `id` / `label` | `nanogpt` / `NanoGPT` | `openrouter` / `OpenRouter` |
| `secretKey` | `SECRET_KEYS.nanogpt` | `SECRET_KEYS.openrouter` |
| `defaultModel` | `DEFAULT_MODELS.nanogpt` | `DEFAULT_MODELS.openrouter` |
| `MODELS_URL` | `https://nano-gpt.com/api/v1/images/models` | `https://openrouter.ai/api/v1/images/models` |
| `GENERATE_URL` | `https://nano-gpt.com/api/v1/images` | `https://openrouter.ai/api/v1/images` |
| keep model if | `architecture.input_modalities` includes `text`, `capabilities.image_generation !== false`, id does not match `/(^|[\/-])edit([\/-]|$)|upscal|eras|remov|inpaint|image-to-image|(^|[\/-])vto([\/-]|$)|reference|layeriz|layer-decomposition|sam3/i`; not a vector model (`tags` contain `svg`, `vector` or `text-to-vector`, or id matches `/vector/i`); not an input-image model (`tags` contain any of `image-edit`, `image-to-image`, `img2img`, `segmentation`, `virtual-try-on`, `upscale`, `background-removal`, `depth-estimation`, `inpainting`, `outpainting`, `object-removal` and do not contain `text-to-image`) | `architecture.output_modalities` includes `image`, `(supported_parameters.input_references?.min ?? 0) < 1`, and `supported_parameters.output_format.values` is not a non-empty array consisting only of `svg` |
| size fields | `selectNanoGptSize(modelInfo?.supported ?? {}, aspect, quality)` | `selectOpenRouterSize(...)` |
| body | `{ model, prompt, n: 1, ...size }` | `{ model, prompt, ...size }` |
| price | `prices` = numeric `pricing.per_image` entries, `pricePerImage` = their min | both `null` |

`buildRequest` truncates `prompt` to `modelInfo?.maxPromptChars ?? 4000` characters. Headers:
`Authorization: Bearer <key>`, `Content-Type: application/json`. Timeout 180 s.
Response: first entry of `data[]`: `b64_json` -> `{ base64, mime: media_type ?? sniffImageMime(base64) }`;
`url` -> `parseDataUrl` if it is a data URL, else `fetchImageAsBase64`; if that download fails (for example CORS)
return `{ remoteUrl: url }`. NanoGPT also accepts a top-level `image` (bare base64). No image at all:
`ProviderError('<label>: Antwort enthält kein Bild')`. Every `{ base64, mime }` result must be raster: a mime other
than `image/png`, `image/jpeg` (alias `image/jpg`), `image/webp` or `image/gif`, or bytes that sniff as
`image/svg+xml`, throws `ProviderError('<label>: Bildformat wird nicht unterstützt (<mime>)')` with code
`unsupported_format` (also after a successful download; the `remoteUrl` fallback is unchanged). A missing `apiKey` throws `ProviderError('<label>: Kein API-Key')`.

Expected with the fixtures: NanoGPT keeps exactly `flux-schnell`, `z-image-turbo`, `qwen-image-3`, `nano-banana-2`,
`grok-imagine-image`, `seedream-v4.5`, `bytedance/seedream-v5.5`, `p-h3-image`; OpenRouter drops exactly
`krea/k3-edit` and `recraft/recraft-v4.1-vector`.

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
export function fitContext({ first, recent }, budgetChars)  // -> { first, recent } whose scene block fits budgetChars
export function directSceneBudget({ instruction, styleSuffix, maxChars = 1800 })  // -> chars left for the scene block of the direct prompt
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
`fitContext` trims the context so that `buildSceneBlock(result).length <= budgetChars` (headings and separators
counted). Budget below 80 -> `{ first: null, recent: [] }`. The latest messages come first, newest first: the newest
entry is always kept (cut to the room left if needed); older entries are added while they fit; an entry that does not
fit completely is cut if at least 80 characters of text room remain, else it and everything older is dropped. With a
first message the latest-messages section takes at most 60 % of the budget and the first message gets the rest (cut
with `truncateText`); a first message that does not fit and would get fewer than 80 characters is dropped, and the
latest messages are then fitted into the whole budget. Entries stay oldest first.
`directSceneBudget` = `maxChars` minus the style suffix `finalizePrompt` appends, minus the instruction, minus `\n\n`.
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
setStatus(text | null, { onCancel, cancelLabel } = {}) }`; `notify = { warning(msg), error(msg) }`;
`onFailure(messageIndex, error)` optional; `timers = { setTimeout, clearTimeout, setInterval, clearInterval }` default
`globalThis`; `config = { startTimeoutMs: 8000, endedGraceMs: 1500, watchdogMs: 2000, imagingTimeoutMs: 240000,
preRequestTimeoutMs: 30000 }` defaults.

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
  In phase `armed`: phase becomes `generating`, clear the start-timeout. In phase `imaging` (streaming leaves the
  host UI unlocked): only `hold.release()`; the image job keeps running and the status bar stays. In phase
  `generating` (a follow-up generation of the same send, e.g. after a tool call): clear a pending grace timer and
  reset the idle count.
- `CHAT_COMPLETION_SETTINGS_READY`: when the phase is not `armed`, call and clear `restoreStreaming`.
- `MESSAGE_SENT (index)`: while `armed`/`generating` and index is an integer: `userIndex = index`, `hold.engage(index)`,
  and the run counts as having reached the request phase (see watchdog).
- `MESSAGE_RECEIVED (index, type)`: ignore without a run, when already handled, when `type === 'first_message'`,
  when `index <= userIndex`, when the message is missing / `is_user` / `is_system`, or when its trimmed `mes` is
  empty or `...` (an empty tool-call turn; the run stays unhandled and waits for the real answer). Otherwise mark handled,
  phase `imaging`, clear timers, `hold.setStatus(MESSAGES.statusImage, { onCancel: cancel })`, then
  `processReply(index, abort.signal)`, raced against the abort signal and an imaging timeout of `imagingTimeoutMs`
  (set through `timers`, always cleared): the chat-model call inside `processReply` ignores the signal, so the
  listener settles as soon as the signal aborts. Timeout: `onFailure(index, new Error(MESSAGES.imageTimeout))`, then
  abort. Errors: an abort (signal aborted or error name `AbortError`) is silent; anything else calls
  `onFailure(index, error)`. A `processReply` that settles after the race is ignored (no unhandled rejection, no
  `onFailure`). Always finish afterwards. **The listener must return the promise** so the host waits for it.
- `GENERATION_STOPPED`: abort; finish unless the phase is `imaging` (there the aborted race finishes).
- `GENERATION_ENDED`: ignore without a run, when handled, or in phase `armed`. Otherwise (re)start a grace timer of
  `endedGraceMs`; when it fires and the run is still unhandled, finish. (Streaming emits ENDED before RECEIVED.)
- `CHAT_CHANGED`: abort and finish.
- Start-timeout fires in phase `armed`: `notify.warning(MESSAGES.notStarted)`, finish.
- Watchdog tick: in phase `generating`, unhandled. `host.isGenerating()` true: the request phase is reached, reset the
  idle count. Before the request phase was reached (generating flag never seen and no `MESSAGE_SENT` yet; the host
  awaits listeners, a server ping and group setup before it sets the flag): add `watchdogMs` to the waited time; at
  `preRequestTimeoutMs` `notify.warning(MESSAGES.notStarted)`, finish. Afterwards: count consecutive ticks with
  `!host.isGenerating()`; at 2, finish.

`cancel()`: abort; finish unless `imaging`. `finish()`: only for the current run; clear all timers, call
`restoreStreaming` if still set, `hold.release()`, `hold.setStatus(null)`, clear the run.
A finish triggered by an older run must not end a newer one.

Required tests (fake host with a manual event bus, manual timers): happy path non-streaming; streaming order
(ENDED then RECEIVED inside the grace time); no reply (ENDED, grace expires); stop during the LLM phase; stop during
imaging (signal aborted, no `onFailure`); `processReply` failure -> `onFailure`; precheck failure (no click);
each early-exit warning; start-timeout; chat change during imaging; ignored MESSAGE_RECEIVED variants; dry-run and
quiet GENERATION_STARTED ignored; second `start()` while active; watchdog finish; streaming restored exactly once;
cancel / CHAT_CHANGED / GENERATION_STOPPED during imaging with a `processReply` that never settles; imaging timeout;
`processReply` rejecting after a cancel is silent; normal resolve clears the imaging timeout; a new generation during
imaging only releases the hold; slow pre-request work (10 s without the generating flag) still yields the image;
pre-request timeout; empty tool-call reply then real answer (job runs once, for the real answer); follow-up
GENERATION_STARTED inside the grace time keeps the run; empty reply with nothing after ends through the grace path.

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
export async function getModels(providerId, { force = false } = {})  // memory, then localStorage 'bfqig_models_v<CACHE_VERSION>_<id>' ({ timestamp, models }) if younger than 7 days, else provider.listModels(); on fetch failure return a stale cache if there is one, else throw. CACHE_VERSION is bumped whenever the list filters or the ModelInfo shape change (the cache stores the normalized list); the unversioned key of version 1 is removed on write
export async function getModelInfo(providerId, modelId)              // -> ModelInfo | null, never throws
```

### 5.17 UI: `src/settings/model-picker.js`, `panel.js`
```js
export function createModelPicker({ onChange })   // -> { element, refresh(providerId, { force } = {}), update() }  (update re-renders the info line; the panel calls it on aspect/quality change)
export async function mountSettingsPanel({ onTestImage })   // onTestImage: async () => ({ url, prompt })
```
The panel is an ST `inline-drawer` appended to `#extensions_settings2` (fallback `#extensions_settings`).
All content of `.inline-drawer-content` sits in one wrapper `<div class="bfqig-body">` that carries the flex column
layout; `.inline-drawer-content` itself is never styled, because the host toggles its `display`.
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
| viewer dialog, save, delete, close | `bfqig-viewer`, `bfqig-viewer-save`, `bfqig-viewer-delete`, `bfqig-viewer-close` |

Model select: `<optgroup label="★ Favoriten">` first (only if any), then `<optgroup label="Alle Modelle">`. A stored
model that is not in the list stays selectable as `"<id> (nicht in der Liste)"`. The filter input narrows the
options by substring. The star toggles the selected model in `favorites[provider]`. Info line: the price of the size the request
would send: `prices[buildRequest(current aspect, quality).body.resolution]` as `ca. 0,0085 $ pro Bild`; if that is
not a number but `pricePerImage` is, `ab <min> $ pro Bild`; else empty. Model list load failure: show the message in the info line, keep the stored model.
Every input writes through `updateSettings` on `change`/`input`. Switching the provider refreshes key status and models.
The viewer is a native `<dialog id="bfqig-viewer">` opened with `showModal()` (fallback `show()`). Every closing path
(close button, backdrop tap, Escape, the host's Android back handling, which closes the topmost `dialog[open]`) goes
through `close()`. Cleanup (give the toast container back with `releaseToasts`, remove the node) runs once: at once
for our own close paths, and from the `close` event for Escape and the host's `close()` (the browser fires that event
only with the next animation frame, so it must not be the only trigger). After opening, `adoptToasts(dialog)` puts the
toast container into the dialog, because a modal dialog covers toasts that stay in `body`. Opening a second viewer
closes the first. It stops propagation of `mousedown` and `touchstart` so the host's html-level handler does not
collapse the Extensions drawer behind it, and respects `env(safe-area-inset-*)`.

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
`deleteImage` then `removeGalleryRecord` then `detachImageFromChat(url)`; if that changed a message, `await saveChat()`),
"Schließen". Tap on the backdrop closes.

### 5.19 UI: `src/wand/entry.js`, `src/flow/hold.js`
```js
export async function addWandEntry({ onClick })   // -> boolean. Waits up to 30 s for #extensionsMenu, idempotent
export function createHold()                      // -> { engage(userIndex), release(), setStatus(text | null, { onCancel, cancelLabel } = {}) }
```
Wand markup (**BINDING**): `<div id="bfqig_wand_container" class="extension_container"><div id="bfqig_send_with_image"
class="list-group-item flex-container flexGap5" role="button" tabindex="0" title="Text senden und Antwort mit Bild
erhalten"><div class="fa-fw fa-solid fa-image extensionsMenuExtensionButton"></div><span>Senden + Bild</span></div></div>`
appended to `#extensionsMenu`. The host closes the menu itself.
`engage(userIndex)`: one `<style id="bfqig-hold-style">` with the rule
`#chat .mes[mesid="<userIndex>"] ~ .mes { display: none !important; }` (replace the rule on repeated calls).
`release()` removes it. `setStatus(text, { onCancel, cancelLabel })`: a bar `#bfqig-status` (spinner icon, text, and a
button `#bfqig-status-cancel` labelled `cancelLabel`, default "Text sofort zeigen", only when `onCancel` is given) inserted directly before
`#send_form` (fallback: appended to `document.body`); `null` removes it. The bar sets `white-space: normal` (its parent
`#form_sheld` uses `nowrap`); the cancel button keeps `nowrap`.

### 5.20 WIRING: `src/prompt/build.js`
```js
export async function buildImagePrompt({ replyIndex, settings, maxPromptChars })   // -> { prompt, usedLlm }
```
`collectContext` (snapshots from `host/chat.js`) -> `buildSceneBlock` -> instruction through `substituteMacros`.
With `settings.useLlm`: `generateText(buildLlmRequest(...))` -> `cleanLlmOutput`; if that throws or is empty, log a
warning and fall back to `buildDirectPrompt`. The chat-model request uses the untrimmed context; the direct prompt
uses `buildSceneBlock(fitContext(context, directSceneBudget({ instruction, styleSuffix, maxChars: maxPromptChars })))`,
because `finalizePrompt` cuts from the end and a long first message would otherwise push out the latest messages.
Always finish with `finalizePrompt` (last guard).

### 5.21 WIRING: `src/flow/generate-image.js`
```js
export async function checkConfiguration()                                   // throws Error (German) when no key can be resolved
export async function generateImageForMessage(messageIndex, { signal, saveBefore = false, saveAfterAttach = false } = {})  // -> { url, prompt }
export async function generateTestImage({ signal } = {})                     // -> { url, prompt }
```
`generateImageForMessage` steps, checking `signal.aborted` after every await (throw a `DOMException` `AbortError`):
capture the live message object (`getRawMessage`; missing -> `Error('Die Nachricht ist nicht mehr vorhanden.')`), its
`swipe_id` and `getChatId()` -> settings -> provider -> model (`settings.models[id] || provider.defaultModel`) -> `resolveApiKey` ->
`saveBefore ? saveChat()` -> `getModelInfo` -> `buildImagePrompt` (`maxPromptChars = min(modelInfo?.maxPromptChars ?? 1800, 4000)`)
-> `provider.generateImage` -> if `remoteUrl`: use it as url and `notify.warning(...)`; else `uploadImage` with
`extensionForMime(mime)`, `folder: getImageFolderName()`, `fileName: 'bfqig_' + timestampName()` (aborted right after
the upload: `deleteImage(url)` without awaiting, then the `AbortError`, so no orphaned file stays) ->
verify that `getRawMessage(index)` is still the captured object with the same `swipe_id` and that `getChatId()` is
unchanged (the host UI can be unlocked during retry and streaming); on mismatch `deleteImage(url)` without awaiting
(uploaded files only, not a remote url), no gallery record, `Error('Die Nachricht ist nicht mehr vorhanden.')` ->
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
Exception: an error with `code === MESSAGE_GONE_CODE` (`'MESSAGE_GONE'`, exported by `generate-image.js` and set on
every "message gone" error there) only shows `notify.warning(<message>)`, not sticky, without a click handler, and
stores no failure entry: the index may already hold another message, which a retry would give the image.
`retry`: refuse while the controller is active or the host generates, or when the chat id or the message object
changed since the failure; otherwise show the status bar (cancel button labelled `Abbrechen`, the text is already
visible) and run
`generateImageForMessage(index, { signal, saveAfterAttach: true })`; failures show the same toast again. Changes
to the message while the retry runs are caught by the identity check in `generateImageForMessage` (section 5.21).
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
| delete confirm | `Bild endgültig löschen? Es fehlt dann auch in der Chat-Nachricht.` |
| status cancel button | `Text sofort zeigen` (default), `Abbrechen` (retry) |
| `MESSAGES.busy` | `Es läuft bereits ein Bild-Auftrag.` |
| `MESSAGES.noChat` | `Kein Chat geöffnet.` |
| `MESSAGES.generating` | `Es läuft bereits eine Generierung.` |
| `MESSAGES.emptyText` | `Bitte zuerst Text ins Nachrichtenfeld schreiben.` |
| `MESSAGES.slash` | `Slash-Befehle bitte normal senden.` |
| `MESSAGES.noSendButton` | `Senden-Knopf nicht gefunden.` |
| `MESSAGES.notStarted` | `Senden wurde nicht gestartet.` (start-timeout and pre-request timeout) |
| `MESSAGES.statusReply` | `Antwort wird erstellt …` |
| `MESSAGES.statusImage` | `Bild wird generiert …` |
| `MESSAGES.imageTimeout` | `Zeitüberschreitung bei der Bilderstellung.` |
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

## 8. Parallel mode (version 1.1.0, **BINDING**)

A second way to run "Senden + Bild", chosen with the setting `parallelImage` (default `false` = the hold mode of
sections 5.13 and 5.22, unchanged). With `parallelImage: true` two lanes run at the same time:

- Text lane: the message is sent and the reply streams and renders exactly like a normal send. No CSS hold, no
  streaming change (`disableStreamingOnce` is not called).
- Image lane: starts as soon as the user's message is in the chat (`MESSAGE_SENT`). Its prompt context is message 0
  plus the latest messages **up to and including the user's message** (the reply does not exist yet). The finished
  image is attached below the reply text as soon as both the reply is complete and the image is ready.

Host facts this relies on (verified in source): `generateRaw` keeps no global state (own `AbortController`, aborts
itself on `GENERATION_STOPPED`), so it can run while the main generation streams; `MESSAGE_RECEIVED` fires when the
reply is complete (streaming: after the last token, with the message already rendered; non-streaming: before the
render) and the host saves the chat after its listeners returned.

### 8.1 PURE: `src/flow/messages.js`, `src/flow/preflight.js` (extracted from `run-state.js`, behaviour unchanged)
```js
// messages.js
export const MESSAGES                               // the object that lived in run-state.js; run-state.js re-exports it
// preflight.js
export function earlyExitMessage(host, isBusy)      // -> MESSAGES text | null, same checks and order as before: busy, noChat, generating, emptyText, slash
```
`run-state.js` uses both and keeps `export { MESSAGES }`. Its existing tests stay untouched and green (same count).

### 8.2 PURE: `src/flow/parallel-run.js`
```js
export function createParallelImageController({ host, precheck, prepareImage, captureReply, attachImage, discardImage, status, notify, onFailure, timers, config })
// -> { start(): Promise<boolean>, cancel(): void, isActive(): boolean, dispose(): void }
```
Dependencies: `host = { isChatOpen, isGenerating, getComposerText, clickSend, getRawMessage, onEvent }`;
`precheck: async () => void`; `prepareImage: async (lastIndex, signal) => prepared` (opaque: prompt built from the
chat up to `lastIndex`, image generated and stored; rejects on failure or abort); `captureReply: (index) => token`
(opaque identity of the reply at arrival); `attachImage: (index, prepared, { token, save }) => Promise<void>` (it
attaches synchronously before its first await and removes the stored image itself when it refuses, see 8.3);
`discardImage: (prepared) => void` (removes a prepared image that will never be attached);
`status = { setStatus(text | null, { onCancel, cancelLabel } = {}) }`; `notify = { warning, error }`;
`onFailure(messageIndex, error)`; `timers` as in 5.13;
`config = { startTimeoutMs: 8000, endedGraceMs: 1500, watchdogMs: 2000, imagingTimeoutMs: 240000 }`.

`start()`: `earlyExitMessage(host, run active)` -> warning, false. `await precheck()` -> on throw `notify.error`,
false; re-check active and generating. Create the run (`phase: 'armed'`, `abort`, image state `idle`, no reply),
`status.setStatus(MESSAGES.statusImage, { onCancel: cancel, cancelLabel: 'Abbrechen' })`, start the start-timeout and
the watchdog, `host.clickSend()` (false -> `MESSAGES.noSendButton` error, finish, false). Else true.

Events (subscribed once at creation, removed by `dispose()`), all ignored without a run:
- `MESSAGE_SENT (index)`, phase `armed`, integer index: `userIndex = index`, phase `running`, clear the start-timeout,
  start the image job: image state `pending`, an imaging timer of `imagingTimeoutMs`, then
  `prepareImage(index, abort.signal)`.
  - It resolves: run no longer current -> `discardImage(prepared)`. Else clear the imaging timer, image state `ready`;
    if the reply is already known, attach with `save: true`; otherwise wait for the reply.
  - It rejects: ignore when the run is no longer current or the signal is aborted or the error is an `AbortError`.
    Else clear the imaging timer, image state `failed` with the error; if the reply is known ->
    `onFailure(reply.index, error)` and finish; otherwise wait for the reply.
  - Imaging timer fires while `pending`: abort the signal and treat it as a failure with
    `new Error(MESSAGES.imageTimeout)` (same two branches).
- `MESSAGE_RECEIVED (index, type)`, phase `running`, no reply yet: ignore `type === 'first_message'`,
  `index <= userIndex`, a missing / `is_user` / `is_system` message, and a message whose trimmed `mes` is empty or
  `...` (tool-call turn). Otherwise `reply = { index, token: captureReply(index) }` and:
  - image `ready` -> attach with `save: false` and **return that promise** (the attach itself is synchronous, so the
    host renders and saves text and image together);
  - image `failed` -> `onFailure(index, error)`, finish;
  - image `pending` -> return `undefined` so the reply renders at once; the run continues.
- Attach: call `attachImage(reply.index, prepared, { token: reply.token, save })` exactly once per run; a rejection
  -> `onFailure(reply.index, error)`; always finish afterwards. The controller never discards an image it handed to
  `attachImage`.
- `GENERATION_STARTED (type, options, dryRun)`, not a dry run and not `quiet`: clear a pending grace timer and
  reset the idle counter (a tool-call follow-up generation).
- `GENERATION_STOPPED` while no reply is known: cancel. Once the reply is known it is ignored: the stop belongs to a
  later, unrelated generation (the chat-model prompt request aborts itself on that event and `buildImagePrompt` falls
  back to the direct prompt, so the image job continues).
- `GENERATION_ENDED` while no reply is known: (re)start a grace timer of `endedGraceMs`; when it fires and there is
  still no reply, cancel silently (the generation ended without a reply).
- `CHAT_CHANGED`: cancel.
- Start-timeout fires in phase `armed`: `notify.warning(MESSAGES.notStarted)`, finish.
- Watchdog tick, phase `running`, no reply: count consecutive ticks with `!host.isGenerating()`; at 2, cancel.
  Once the reply is known the imaging timer bounds the run.

`cancel()`: abort the signal and finish. `finish()`: only for the current run; clear every timer,
`status.setStatus(null)`, `discardImage(prepared)` when an image is `ready` and was not handed to `attachImage`,
clear the run. A `prepareImage` that settles after the run ended follows the "no longer current" rules above.

Required tests (fake host, manual event bus and timers, like `tests/flow`): reply first then image (listener returns
`undefined`, later attach with `save: true`); image first then reply (attach with `save: false`, the listener's
promise settles after the attach); image fails before the reply (`onFailure` at reply time with the reply index);
image fails after the reply; stop before the reply (abort, a later resolving `prepareImage` is discarded, no
`onFailure`); stop after the reply with the image pending (ignored, the image is attached later); `GENERATION_ENDED` without a reply (grace, cancel, a ready image is discarded); `cancel()` during the
image job while the reply continues; `CHAT_CHANGED`; start-timeout; every early exit and a precheck failure (no
click); empty tool-call message skipped and the real reply used; follow-up `GENERATION_STARTED` inside the grace
time keeps the run; imaging timeout before and after the reply; watchdog cancel; the attach is called at most once;
`attachImage` rejecting -> `onFailure`; status bar set at start with the cancel label `Abbrechen` and cleared at the end.

### 8.3 WIRING: `src/flow/generate-image.js` (split, hold-mode behaviour unchanged)
```js
export async function prepareImage(lastIndex, { signal } = {})    // -> prepared = { url, prompt, extension, providerId, model, folder, ts }
export function captureMessage(messageIndex)                     // -> token { message, swipeId, chatId }; throws the "message gone" error when missing
export async function attachPreparedImage(messageIndex, prepared, { token, save = false } = {})
export function discardPreparedImage(prepared)                   // deleteImage(url) for an uploaded image (extension set); nothing for a remote url
```
`prepareImage`: settings -> provider -> model -> `resolveApiKey` -> `getModelInfo` -> `buildImagePrompt({ lastIndex, ... })`
-> `provider.generateImage` -> upload (or remote url with the warning), with the abort checks of section 5.21. No
attach, no gallery record.
`attachPreparedImage`: verify `token` against `getRawMessage(messageIndex)` (same object, same `swipe_id`, same
`getChatId()`); on mismatch `discardPreparedImage(prepared)` and throw the "message gone" error. Then
`attachImageToMessage` (false -> same error after discarding), `addGalleryRecord`, and only after that the first
await: `save ? await saveChat()`. Finally the auto-save dialog as in 5.21.
`generateImageForMessage(messageIndex, { signal, saveBefore, saveAfterAttach })` keeps its contract and is now
`captureMessage` -> `saveBefore ? saveChat()` -> `prepareImage(messageIndex, { signal })` ->
`attachPreparedImage(messageIndex, prepared, { token, save: saveAfterAttach })`.
`src/prompt/build.js`: the parameter `replyIndex` of `buildImagePrompt` is renamed `lastIndex` (the newest message
that belongs to the context).

### 8.4 WIRING: `src/flow/send-with-image.js`
Creates both controllers. `start()` reads `getSettings().parallelImage` at call time and starts the matching one.
Each controller's `precheck` first refuses with `MESSAGES.busy` while the other controller is active or a retry
runs, then calls `checkConfiguration()`. The retry refuses while either controller is active.
Parallel controller deps: `prepareImage: (lastIndex, signal) => prepareImage(lastIndex, { signal })`,
`captureReply: captureMessage`, `attachImage: attachPreparedImage`, `discardImage: discardPreparedImage`,
`status: hold` (only its `setStatus` is used), `onFailure`: the same retry toast as in hold mode (the retry then
runs `generateImageForMessage` for the reply, whose context includes the reply).

### 8.5 Settings and UI
- `DEFAULT_SETTINGS.parallelImage = false`; `normalizeSettings` coerces it to a boolean.
- Checkbox `bfqig-parallel` (same markup pattern as `bfqig-use-llm`) in the settings pane directly after the prompt
  reset row and before the advanced block, followed by a note. It writes `parallelImage` through `updateSettings`.
- Layering table: `src/flow/messages.js`, `src/flow/preflight.js` and `src/flow/parallel-run.js` are PURE.

| Key / place | Text |
|---|---|
| parallel checkbox | `Text sofort zeigen, Bild parallel erzeugen` |
| parallel note | `Aus: Die Antwort erscheint erst zusammen mit dem Bild. An: Die Antwort wird normal gestreamt; das Bild entsteht gleichzeitig aus dem Stand bis zu deiner Nachricht und wird darunter eingefügt.` |
| key state locked (replaces the text in section 6) | `In der App ist ein Key gespeichert, aber für Erweiterungen gesperrt. Entweder in TauriTavern freigeben (User Settings → „TauriTavern Settings“ → Misc → „Allow Keys Exposure“, danach App neu starten) oder den Key hier eintragen.` |

## 9. Prompt focus: the current moment, message 0 as background only (version 1.1.0, **BINDING**)

Field report: the images followed message 0 too much. Message 0 is background information (what the characters and
the world look like) and nothing more; the image must show the current moment. This section replaces the
corresponding texts and rules of section 5.12 and 5.20.

### 9.1 `src/prompt/scene.js`
- `DEFAULT_INSTRUCTION` (exact, one line): `Depict the current moment of this roleplay as one image: what happens in the latest message. Show the characters who are present with their appearance (hair, eyes, build, clothing), their pose and expression, the place where they are now, the lighting and the mood.`
- `export const LEGACY_DEFAULT_INSTRUCTIONS`: an array holding the version 1.0 default text exactly (the one that
  ends with `...and the current action from the latest messages.`). Used only to migrate stored settings.
- Section headings (exact):
  - background: `[Background, reference only: looks and world]`
  - earlier: `[Earlier messages, context only]`
  - current: `[Current moment, depict this]`
- `collectContext` is unchanged (`{ first, recent }`, `recent` oldest first). The **current** entry is the last
  element of `recent`; the **earlier** entries are the ones before it; the **background** is `first`.
- `buildSceneBlock({ first, recent }, { currentFirst = false } = {})`: three sections with the headings above, each
  omitted when empty, entries as `<name>: <text>` separated by a blank line, sections separated by a blank line.
  Order with `currentFirst: false` (request to the chat model, which weighs the end most): background, earlier,
  current. Order with `currentFirst: true` (direct prompt for an image model, which weighs the start most): current,
  earlier, background.
- `buildLlmRequest`: `prompt` keeps the shape `Task: <instruction>\n\n<sceneBlock>\n\nImage prompt:`. `systemPrompt`
  (exact): `You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The background information is a reference for what the characters and the world look like: take appearance details from it, never depict its events, and use its location only when the messages give no other place. Output only the image prompt: English, one paragraph, at most 120 words, concrete visual details, no dialogue, no explanations.`
- `fitContext({ first, recent }, budgetChars)` priorities: (1) the current entry is always kept, truncated to the
  budget if necessary; (2) earlier entries are added newest first while they fit (an entry that does not fit
  completely may be truncated if at least 80 characters of its text remain, else it and everything older is
  dropped); (3) the background gets what is left, but at most 30 percent of the budget when at least one recent
  entry exists; it is dropped when fewer than 80 characters of its text would remain. With no recent entries the
  background may use the whole budget. A budget below 80 returns `{ first: null, recent: [] }`. The result keeps
  `recent` oldest first and satisfies `buildSceneBlock(result, { currentFirst: true }).length <= budgetChars`.

### 9.2 `src/prompt/build.js`
Chat-model path: `buildLlmRequest({ instruction, sceneBlock: buildSceneBlock(context) })`. Direct path:
`buildDirectPrompt({ instruction, sceneBlock: buildSceneBlock(fitContext(context, budget), { currentFirst: true }) })`.

### 9.3 `src/settings/defaults.js`
`normalizeSettings`: an `instruction` that is empty or equals an entry of `LEGACY_DEFAULT_INSTRUCTIONS` becomes
`DEFAULT_INSTRUCTION`, so existing installs get the new default; a text the user changed is kept.

Required tests: both section orders with the exact headings; a single recent entry is the current moment and there is
no earlier section; no background; `fitContext` keeps the current entry in full when a 2600-character background and
a small budget compete, caps the background at 30 percent, and never exceeds the budget; the system prompt and the
default instruction are single lines; the legacy instruction is migrated and a customised one is kept.

## 10. Long-press on a generated image in the chat (version 1.1.0, **BINDING**)

Field report from Android: the host shows its image controls (trash can) only on hover. A long-press does not reveal
them; it opens TauriTavern's "save image" confirmation, which is the host's default action for `contextmenu` on an
`<img>` and is cancelled only by `preventDefault()` (the host checks `event.defaultPrevented` in a task after the
dispatch). So deleting a generated image from the chat is hardly possible on a phone.

- New UI module `src/gallery/chat-image-menu.js`: `export function installChatImageMenu()` (idempotent). It adds one
  capture-phase `contextmenu` listener on `document`. The listener acts only when all of this holds:
  - the event target is an `<img>` inside `#chat`;
  - the event came from touch: `event.pointerType` is a non-empty string other than `mouse`, or, when `pointerType`
    is missing, `matchMedia('(hover: none)').matches`. A mouse right-click keeps the browser menu;
  - the image is one of ours: its `src` attribute, compared after stripping leading slashes, equals the `url` of a
    gallery record, or its file name starts with `bfqig_`.
  Then it calls `event.preventDefault()` and opens `openImageViewer(record)`: the gallery record, or
  `{ url: <src attribute>, prompt: <title attribute or ''> }` when there is none. Every other image is left to the host.
- `index.js` calls `installChatImageMenu()` after the settings panel is mounted.
- The viewer's "Löschen" removes the file, the gallery record and the media entry in the open chat (section 5.18),
  "Auf Gerät speichern" replaces the host's save confirmation.

## 11. Character fidelity and key status refresh (version 1.2.0, **BINDING**)

Field report: in a chat with a known character (Hermione Granger) the image showed "nonsense", and the key status
of an empty key field never changed. Measured with real models (NanoGPT, 2026-11-12):

- The prompt context held only chat messages. The character card was missing, so the chat model had no looks to
  work from and nothing told it to name a known character.
- SDXL-family models (`wai-illustrious-sdxl` and the other anime models) read only about the first 75 tokens:
  a red umbrella named after ~65 tokens is drawn, after ~93 tokens it is not. A 120-word paragraph loses its
  second half, and a style appended at the end is lost as well.
- A reasoning chat model spent up to 1774 tokens on thinking for this request. With the reply length of a usual
  roleplay preset the image prompt came back cut in the middle of a sentence.
- The key status was computed at mount, on provider change and on key input only. A key stored in the app
  afterwards kept showing "Kein Key gefunden" although `/api/secrets/find` returned it.

This section replaces the corresponding texts and rules of sections 5.6, 5.12, 5.20, 6 and 9.

### 11.1 HOST: `src/host/chat.js`, `src/host/llm.js`
```js
// chat.js
export function getCharacterNotes()   // -> [{ name, description }], raw strings; [] when no chat is open
// llm.js
export async function generateText({ prompt, systemPrompt, minResponseTokens })   // -> string
```
`getCharacterNotes`: solo chat -> one entry for `ctx.characters[ctx.characterId]` (`description` =
`character.description ?? character.data?.description ?? ''`). Group chat -> one entry per avatar in
`group.members` that is not in `group.disabled_members`, resolved with `ctx.characters.find(c => c.avatar === avatar)`;
unknown avatars are skipped. Entries without a name are skipped. No cleaning and no macro substitution here.

`generateText`: when `minResponseTokens` is a positive number, `ctx.mainApi === 'openai'` and
`ctx.chatCompletionSettings.openai_max_tokens` is a number below it, pass `responseLength: minResponseTokens` to
`ctx.generateRaw` (both hosts restore the preset value themselves afterwards). In every other case call
`generateRaw({ prompt, systemPrompt })` as before: text-completion backends count the reply length against their
context size, so it is never raised there.

### 11.2 PURE: `src/prompt/scene.js`
```js
export const LIMITS = { firstMessageChars: 2500, messageChars: 1500, characterChars: 1200, characterCount: 4 }
export function collectCharacters(notes)                       // -> [{ name, text }]
export function buildCharacterBlock({ characters, userName })  // -> string ('' when there are no characters)
export function buildLlmRequest({ instruction, sceneBlock, characterBlock = '' })
export function finalizePrompt(text, { styleSuffix = '', maxChars = 1800 } = {})
```
- `collectCharacters(notes)`: for each `{ name, description }` (non-arrays -> `[]`): `name` trimmed, entries without
  a name dropped; `text` = `truncateText(cleanMessageText(description), LIMITS.characterChars)` (may be empty);
  at most `LIMITS.characterCount` entries, in order.
- `buildCharacterBlock`: heading (exact) `[Characters, reference only: who they are and what they look like]`, then
  one entry per character, `<name> (character): <text>` or `<name> (character)` when the text is empty, then
  `<userName> (user)` when the trimmed user name is not empty. Entries are separated by a blank line. No characters
  -> `''` (the user alone is no block).
- `buildLlmRequest`: `prompt` = `Task: <instruction>\n\n<characterBlock>\n\n<sceneBlock>\n\nImage prompt:`; an empty
  `characterBlock` and its separator are left out.
- `SYSTEM_PROMPT` (exact, one line):
  `You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The character notes and the background information are a reference for what the characters and the world look like: take appearance details from them, never depict their events, and use their location only when the messages give no other place. Write one short description in plain English, at most 45 words. Start with how many people are in the picture, for example "One girl, solo:" or "One girl and one boy:". Then, in this order: who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light. Name a character from a published work (anime, game, book, film, series) with the full canonical name and the title of the work, for example "Hermione Granger from Harry Potter"; use no other names. Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen. No dialogue, no explanations. Output only the image prompt.`
  The output is a short plain description, not a tag list (owner's decision, 2026-11-12: the chat model should say
  in a few words what is to be drawn). Two things in it are measured and must stay: the 45-word cap (the
  75-token window above) and the head count in front. Without the count `wai-illustrious-sdxl` drew the named
  character twice in 2 of 2 runs ("Kyouko Hori from Horimiya, ..." and "Hermione Granger from Harry Potter, ...");
  with "One girl, solo:" in front it drew her once in 4 of 4.
- `DEFAULT_INSTRUCTION` (exact, one line):
  `Depict the current moment of this roleplay as one image: what happens in the latest message. The picture shows {{char}}, seen through the eyes of {{user}}. {{user}} is not in the picture.`
  (`{{char}}` and `{{user}}` are host macros; `build.js` already resolves the instruction with `substituteMacros`.)
- `LEGACY_DEFAULT_INSTRUCTIONS` additionally holds the version 1.1 default exactly (`...the place where they are now,
  the lighting and the mood.`), so untouched installs get the new default.
- `finalizePrompt`: the style goes first, because the end of a prompt is the part image models drop. With a
  non-empty trimmed style the result is `<style>, <text>`; the text is truncated so that the whole fits `maxChars`
  (the style is never cut). Without a style the result is the truncated text. `directSceneBudget` subtracts that
  prefix instead of the old suffix. The setting key stays `styleSuffix`.

### 11.3 WIRING: `src/prompt/build.js`
```js
export const IMAGE_PROMPT_MIN_TOKENS = 2000
```
Chat-model path: `characterBlock = buildCharacterBlock({ characters: collectCharacters(<notes>), userName })` with
`<notes>` = `getCharacterNotes()` whose descriptions went through `substituteMacros`, `userName` =
`getParticipantNames().user`; request = `buildLlmRequest({ instruction, sceneBlock, characterBlock })`;
`generateText({ ...request, minResponseTokens: IMAGE_PROMPT_MIN_TOKENS })`. The direct path is unchanged (no
character block: it has no chat model to condense it).

### 11.4 UI: key status refresh (`src/settings/panel.js`, `style.css`)
- The key input sits in a `<div class="bfqig-row">` together with a button
  `<button type="button" id="bfqig-key-refresh" class="menu_button bfqig-icon-button">` that carries the same
  rotate icon as `bfqig-model-refresh`, with `title` and `aria-label` `Key-Status neu prüfen`. The input fills the
  row (same behaviour as the model select in its row).
- A refresh sets the status text `Key wird geprüft …` with `data-state="checking"` and disables the button until
  the result (or error) of that run is shown; a run superseded by a newer one leaves text and button to the newer.
- The button calls the refresh. The panel also refreshes on the host events `SECRET_WRITTEN`, `SECRET_DELETED`,
  `SECRET_ROTATED` and `SECRET_EDITED` (through `onHostEvent`; both hosts emit them when a key is saved, removed
  or switched in the API connections), so the status follows the app without a reload.

| Key / place | Text |
|---|---|
| key refresh button (`title`, `aria-label`) | `Key-Status neu prüfen` |
| key status while checking | `Key wird geprüft …` |

### 11.5 Tests and version
- `tests/prompt`: the system prompt and the default instruction are single lines and equal the texts above;
  `collectCharacters` (cleaning, truncation, missing names, count limit, non-array input); `buildCharacterBlock`
  (heading, entry with and without text, user line, empty result); `buildLlmRequest` with and without a character
  block; `finalizePrompt` puts the style first, never cuts it and respects `maxChars`; the direct prompt still
  fits its budget with a style set.
- `tests/settings`: both legacy default instructions (1.0 and 1.1) are migrated, a customised text is kept.
- No existing test is deleted; assertions on replaced texts are updated. The test count does not drop (182 before).
- Version `1.2.0` in `manifest.json`, `package.json` and `package-lock.json`.
- Live test (orchestrator): SillyTavern test instance, NanoGPT chat model and `wai-illustrious-sdxl`, a card of a
  published character (`dev/cards/*.json`, importable character cards), "Senden + Bild" with an empty key field.

## 12. Reference pictures (version 1.3.0, **BINDING**)

Field report: no anime model drew Kyouko Hori (Horimiya) recognisably from text alone; the research in
`dev/research/anime-character-likeness.md` shows why (165 training pictures, missing in WAI's character list).
Measured with real NanoGPT calls on 2026-11-12:

- With one reference picture and a model built for it (`seedream-v4.5`, `seedream-v5.0-lite`, `qwen-image-3`,
  `gpt-image-2`, `hidream-o1-image-dev`) the character is right in a new scene. The anime SDXL models only
  copy the framing of the reference (img2img).
- A face-only reference leaves the clothes to chance; a second, full-body picture fixed the uniform in 4 of 4.
- Two characters with one picture each stayed separate in 6 of 6. A generated picture that shows two characters
  worked as the reference for both in 8 of 8. A character without any reference came out wrong (wore another
  character's glasses in 2 of 2). `seedream-v4.5` kept six characters apart in 4 of 4.
- Request field: `input_references: [<data URL>, ...]` in the body of `POST /api/v1/images`. `seedream-v4.5`
  cost 0.04 USD with one reference and with six; it took 18 s and 47 s.
- The per-model limit is `supported_parameters.max_input_images` in NanoGPT's model list.
- Three chat models wrote the two-line answer of 12.3 in 30 of 30 tries; weaker ones write
  `Kyouko Hori from Horimiya` where the list says `Kyouko`, which `matchName` absorbs.

This section replaces the corresponding texts and rules of sections 5.10, 5.12, 5.14, 5.15, 5.20, 5.21, 5.22, 9 and 11.

### 12.1 Concept (owner's decisions)

1. Reference pictures are one list for all chats. Each has names (who is on it), a checkbox and a source
   (`upload` or `generated`). Only checked pictures are used.
2. Every generated picture becomes a reference by itself: tagged with the people the chat model reported as
   visible, checked. The owner deletes or unchecks what does not fit.
3. The chat model says who is in the picture (first line `Shown:`). Without a chat model the names are searched
   in the newest message.
4. The user is shown only when a checked reference carries the persona name; otherwise the picture stays in the
   user's view. No picture is taken from a character card.
5. Selection: first the picture that shows the most people still missing, then single pictures for the rest, then
   more pictures in turn; at most two pictures per person, never more than the model accepts, never a picture
   with someone who is not in the scene.
6. A model that accepts no reference draws without one; the panel says so.
7. A button on every chat message generates a new picture for that message (it adds one, it deletes nothing).

### 12.2 PURE: `src/references/select.js` (new)
```js
export const PER_NAME_LIMIT = 2
export const NAME_LIMIT = 8                           // names per picture
export const REFERENCE_LIMIT = 100                    // uploaded pictures
export function normalizeNames(value)                 // 'a, b' or array -> unique trimmed names
export function toCandidates({ uploads, gallery })    // -> [{ url, names, enabled, source, timestamp }]
export function knownNames(candidates)                // -> names of enabled candidates
export function matchName(name, known)                // -> entry of `known` or null
export function resolveShownNames(names, known)       // -> unique names
export function findNamesInText(text, known)          // -> known names found in the text
export function selectReferences({ candidates, sceneNames, maxImages, perNameLimit = PER_NAME_LIMIT })  // -> [{ url, names }]
export function buildReferencePreamble(selected)      // -> string
```
- `normalizeNames`: a string is split at commas; entries are trimmed, empty ones dropped, each cut to 60
  characters; unique without regard to case (the first spelling wins); at most `NAME_LIMIT`. Anything else -> `[]`.
- `toCandidates`: uploads first in list order, then gallery records in list order (newest first) whose `names` is
  a non-empty array. `enabled` = `entry.enabled !== false`, `source` = `'upload'` or `'generated'`, `timestamp` a
  finite number or 0, `names` through `normalizeNames`. Entries without a non-empty string `url` are dropped.
- `knownNames`: names of the enabled candidates, unique without regard to case, in candidate order.
- `matchName`: cut the name at the first ` from ` (any case) and trim. Comparison ignores case. An equal entry
  wins. Otherwise an entry matches when all of its words stand as whole words in the name, or all words of the
  name stand in the entry; of several the one with the most words, then the first in `known`. Words are split at
  whitespace. Nothing matches, or the name is empty -> `null`.
- `resolveShownNames`: each name becomes `matchName(name, known)` or, without a match, the trimmed name itself
  (cut at ` from ` as above); empty results are dropped; unique without regard to case; order kept.
- `findNamesInText`: the known names that occur in the text as whole words (ignoring case; a name of several
  words must occur as that phrase), ordered by first position.
- `selectReferences`: `scene` = `sceneNames`, unique without regard to case. Empty scene or `maxImages < 1` -> `[]`.
  *Eligible*: candidates that are enabled, have at least one name, and whose names are all in the scene. A
  candidate is *allowed* while it is not chosen and each of its names has fewer than `perNameLimit` pictures.
  - Cover: while fewer than `maxImages` are chosen and some allowed candidate shows a scene name that has no
    picture yet, take the allowed candidate that shows the most such names. Ties: if that number is 1, an upload
    before a generated picture; then fewer names; then the earlier candidate.
  - Fill: go through the scene names in order, again and again, until a round adds nothing or `maxImages` is
    reached. For a name with fewer than `perNameLimit` pictures take the allowed candidate that shows it: an
    upload before a generated picture, then fewer names, then the earlier candidate.
  - "Earlier candidate" is the order of `toCandidates`: uploads oldest first (the first picture of a person is
    the anchor), generated pictures newest first. No timestamp is compared: it would put the latest upload first.
  - Result: `{ url, names }` in the order chosen.
- `buildReferencePreamble`: `''` for an empty list. Otherwise exactly this shape:
  `Reference images: image 1 shows Kyouko and Yuki; image 2 shows Tooru. Draw these people exactly as in their reference images: same face, eyes, hair and drawing style. Where the description differs from a reference image, the reference image wins. Scene: `
  (names joined with `, ` and with ` and ` before the last; one trailing space; the caller appends the description).

### 12.3 PURE: `src/prompt/scene.js`, `src/gallery/records.js`, `src/settings/defaults.js`, providers
`scene.js`:
```js
export const POV_SENTENCE         // ' The picture is seen through the eyes of {{user}}: {{user}} is not in the picture.'
export const USER_SHOWN_SENTENCE  // ' {{user}} has a reference picture and is shown in the picture when {{user}} takes part in the moment.'
export function splitShownLine(text)   // -> { names: string[], text: string }
export function buildLlmRequest({ instruction, sceneBlock, characterBlock = '', knownNames = [] })
```
- `SYSTEM_PROMPT` (exact, one line):
  `You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The character notes and the background information are a reference for what the characters and the world look like: take appearance details from them, never depict their events, and use their location only when the messages give no other place. Answer in exactly two lines. Line 1: the word "Shown:" followed by the names of the people who are visible in this picture and nobody else, separated by commas, the most important first. The list of known names only fixes the spelling: when a visible person is on it, copy the name from the list, otherwise write the name the chat uses. Most people on that list are usually not in the picture. Line 2: one short description in plain English, at most 45 words. Start with how many people are in the picture, for example "One girl, solo:" or "One girl and one boy:". Then, in this order: who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light. Refer to each person by the name from line 1; for a character from a published work (anime, game, book, film, series) write the full canonical name and the title of the work instead at the first mention, for example "Hermione Granger from Harry Potter". Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen. No dialogue, no explanations. Output only these two lines.`
- `DEFAULT_INSTRUCTION` (exact, one line):
  `Depict the current moment of this roleplay as one image: what happens in the latest message. Show {{char}} and everyone else who is present in that moment.`
  The sentence about the user's view is no longer part of it: `build.js` appends `POV_SENTENCE` or
  `USER_SHOWN_SENTENCE` (both exact as in the comment above, each starting with one space).
- `LEGACY_DEFAULT_INSTRUCTIONS` additionally holds the version 1.2 default exactly (`...seen through the eyes of
  {{user}}. {{user}} is not in the picture.`).
- `splitShownLine`: remove think blocks as `cleanLlmOutput` does (closed blocks, and an unclosed block in front).
  Take the first line that matches `/^[ \t>*_`"']*shown\s*:(.*)$/im`. Its names: split at commas, strip
  surrounding whitespace, quotes, backticks, asterisks and a trailing period, drop empty entries and `none`,
  `nobody`, `no one`, `-` (any case), at most `NAME_LIMIT`. `text` is the input without that line. No such
  line -> `{ names: [], text: <input without think blocks> }`. `cleanLlmOutput` itself is unchanged.
- `buildLlmRequest`: `prompt` =
  `Task: <instruction>\n\n[Known names, for spelling only]\n<names joined with ", ">\n\n<characterBlock>\n\n<sceneBlock>\n\nImage prompt:`;
  an empty names list and an empty character block are left out together with their separators.

`records.js`:
```js
export function addRecord(list, record)        // as before; keeps `names` (normalizeNames) and `enabled` (boolean, default true)
export function updateRecord(list, url, patch) // -> new list; only `names` and `enabled` of the patch are applied
```
`defaults.js`: `DEFAULT_SETTINGS.references = []`. `normalizeSettings`: `references` is an array of
`{ url, names, enabled, timestamp }` (url a non-empty string, else dropped; `names` through `normalizeNames`;
`enabled` a boolean, default true; `timestamp` a finite number or 0), capped at `REFERENCE_LIMIT`. Gallery entries
keep working as before; a `names` member is normalised and an `enabled` member coerced to boolean when present.

Providers (`nanogpt.js`, `openrouter.js`, same shape):
```js
export function maxReferenceImages(modelInfo)   // integer >= 0
export function buildRequest({ model, prompt, aspect, quality, modelInfo, references })
export async function generateImage({ apiKey, model, prompt, aspect, quality, modelInfo, references, signal, fetchImpl })
```
`maxReferenceImages`: NanoGPT `modelInfo.supported.max_input_images`, OpenRouter
`modelInfo.supported.input_references.max`; anything that is not a positive finite number -> 0; floored.
NanoGPT only: a floored value below 2 counts as 0. A model with exactly one input image uses it as the start of
the picture (img2img): all nine tested (the six anime SDXL models, Anima, Z Image Base, Krea 2 Turbo) copied the
framing of the reference, so sending one would turn every picture into a variation of the reference. The panel
note reads `Dieses Modell nimmt 1 Referenzbild.` for a limit of 1 (possible on OpenRouter).
`buildRequest`: with a non-empty `references` array the body gets
`input_references: references.slice(0, maxReferenceImages(modelInfo))`; an empty slice omits the field.
OpenRouter's field is taken from its docs and is unverified.

### 12.4 HOST: `src/host/images.js`, `src/host/message-buttons.js` (new)
```js
// images.js
export async function toJpegDataUrl(source, { maxSide = 1024, quality = 0.9 } = {})   // url string, Blob or File -> 'data:image/jpeg;base64,...'
// message-buttons.js
export function installMessageButton({ className, iconClass, title, onClick })       // onClick(messageIndex); idempotent per className
```
- `toJpegDataUrl`: a string is fetched (not ok -> `Error('Bild konnte nicht geladen werden (HTTP <status>)')`).
  `createImageBitmap`, scale so that the longer side is at most `maxSide` (never enlarge), draw on a canvas over a
  white fill (so a transparent PNG does not turn black), `toDataURL('image/jpeg', quality)`, close the bitmap.
  Every failure throws.
- `installMessageButton`: markup
  `<div class="mes_button <className> <iconClass>" title="<title>" tabindex="0" role="button"></div>`, appended to
  `.extraMesButtons` of `#message_template` and of every `.mes` in `#chat` that has none yet. A `MutationObserver`
  on `#chat` (`childList`, `subtree`) adds it to messages that appear later (both hosts clone the template;
  TauriTavern may mount messages late). One delegated `click` listener on `document` for `.<className>`:
  `Number(closest('.mes')?.getAttribute('mesid'))`, ignored unless it is an integer >= 0. If `#chat` or the
  template is missing at call time, retry every 500 ms for up to 30 s. Verified in both hosts' `index.html`:
  the message template has `.mes_buttons > .extraMesButtons` filled with `.mes_button` entries.

### 12.5 UI and WIRING
`src/gallery/store.js`: `export function updateGalleryRecord(url, patch)` (through `updateRecord`, then the
listeners). New `src/gallery/actions.js`:
```js
export async function deleteGeneratedImage(url)   // deleteImage (a false result is only logged), removeGalleryRecord, detachImageFromChat; saveChat when a message changed
```
The viewer's delete button calls it; its behaviour is unchanged.

New `src/references/store.js`:
```js
export const REFERENCE_FOLDER = 'bfqig-references'
export function listUploads()
export function listCandidates()                  // toCandidates({ uploads: settings.references, gallery: settings.gallery })
export async function addUpload(file, names)      // -> the new record
export function setReferenceNames(url, names)     // an upload or a generated picture
export function setReferenceEnabled(url, enabled)
export async function removeUpload(url)           // deleteImage, then the record
export function onReferencesChange(listener)      // -> unsubscribe; also fires when the gallery changes
```
`addUpload`: `normalizeNames(names)` empty -> `Error('Bitte zuerst einen Namen eintragen.')`; no file ->
`Error('Bitte zuerst ein Bild auswählen.')`; `REFERENCE_LIMIT` reached ->
`Error('Es sind höchstens 100 Referenzbilder möglich.')`. Then `toJpegDataUrl(file)`,
`uploadImage({ base64, extension: 'jpg', folder: REFERENCE_FOLDER, fileName: 'ref_' + timestampName() })` and the
record `{ url, names, enabled: true, timestamp: Date.now() }` appended at the END of `settings.references`
(the first upload of a person stays first).

New `src/references/view.js`: `export function createReferencesView()` -> `{ element, refresh() }`.

| Element | Id or class |
|---|---|
| hint | class `bfqig-note` |
| file input (`type="file" accept="image/*"`, hidden: both hosts hide file inputs with their own CSS) | `bfqig-ref-file` |
| visible label that opens the picker (`for="bfqig-ref-file"`, text `Bild auswählen`), name of the chosen file (`Kein Bild gewählt` when none) | `bfqig-ref-pick`, `bfqig-ref-file-name` |
| names input for the upload | `bfqig-ref-names` |
| upload button | `bfqig-ref-upload` |
| filter input (`type="search"`) | `bfqig-ref-filter` |
| list | `bfqig-ref-list` |
| empty note | `bfqig-ref-empty` |
| row (`data-url`) | class `bfqig-ref-item` |
| thumbnail button, names input, checkbox, delete button of a row | classes `bfqig-ref-thumb`, `bfqig-ref-item-names`, `bfqig-ref-enabled`, `bfqig-ref-delete` |

Two sections with the headings `Hochgeladen` and `Erzeugt`; a section without rows is left out. `Erzeugt` lists
the gallery records that have at least one name, newest first. The thumbnail (lazy) opens `openImageViewer`
with the gallery record, or with `{ url, prompt: <names joined with ", "> }` for an upload. For an upload the
viewer gets a second argument `{ confirmText: 'Referenzbild endgültig löschen?', onDelete: () => removeUpload(url) }`:
`openImageViewer(record, { confirmText, onDelete } = {})` then asks with that text and awaits `onDelete()`
instead of `deleteGeneratedImage(record.url)`, so no entry without a file stays in the list. Without the
second argument the viewer behaves as before. The names input
writes on `change` through `setReferenceNames`, the checkbox through `setReferenceEnabled`. Delete: an upload
after `confirmDialog('Referenzbild endgültig löschen?')` through `removeUpload`; a generated picture after
`confirmDialog('Bild endgültig löschen? Es fehlt dann auch in der Chat-Nachricht.')` through
`deleteGeneratedImage`. The filter hides rows whose names do not contain the text (ignoring case). The view
re-renders on `onReferencesChange`. Errors of `addUpload` go to `notify.error`; after a successful upload the
file input and the names input are cleared.

`src/settings/panel.js`: third tab `bfqig-tab-references` (label `Referenzen`) between the two existing ones,
pane `bfqig-pane-references`. Directly under the model slot a note `<div id="bfqig-model-ref-note"
class="bfqig-note"></div>`: empty when no reference is checked; otherwise, with
`n = provider.maxReferenceImages(await getModelInfo(providerId, modelId))`, `Dieses Modell nimmt keine
Referenzbilder.` for 0 and `Dieses Modell nimmt bis zu <n> Referenzbilder.` otherwise. It is refreshed after the
model list has loaded, on a model or provider change and on `onReferencesChange`.

`src/prompt/build.js`:
```js
export async function buildImagePrompt({ lastIndex, settings, maxPromptChars, candidates = [], maxReferences = 0 })
// -> { prompt, usedLlm, shownNames, references, failedReferences }     references: [{ url, names, dataUrl }]
```
1. `known = knownNames(candidates)`, `userName = getParticipantNames().user`,
   `userShown = Boolean(userName) && matchName(userName, known) !== null`.
2. `instruction = substituteMacros(settings.instruction + (userShown ? USER_SHOWN_SENTENCE : POV_SENTENCE))`.
3. Chat-model path: `buildLlmRequest({ instruction, sceneBlock, characterBlock, knownNames: known })`;
   `splitShownLine(answer)`; `description = cleanLlmOutput(text)`; `shownNames = resolveShownNames(names, known)`.
   An answer without the line, an empty description or a failed request: `shownNames =
   findNamesInText(<text of the current moment>, known)`; the direct prompt is used only when the description is
   empty or the request failed, as before.
4. Without `userShown`, the user's name (by `matchName` against `[userName]`) is removed from `shownNames`.
5. `selectReferences({ candidates, sceneNames: shownNames, maxImages: maxReferences })`, then
   `toJpegDataUrl(url)` for each; a picture that cannot be loaded is dropped and counted in `failedReferences`.
6. Text = `buildReferencePreamble(<loaded references>)` + description (or + direct prompt), then
   `finalizePrompt` as before.

`src/flow/generate-image.js`: `prepareImage` passes `candidates: listCandidates()` and
`maxReferences: target.provider.maxReferenceImages(modelInfo)`, shows
`notify.warning('Referenzbilder konnten nicht geladen werden, das Bild entsteht ohne sie.')` when
`failedReferences > 0`, hands `references: <data URLs>` to `provider.generateImage`, and returns `names:
shownNames` in `prepared`. `attachPreparedImage` stores `names` and `enabled: true` in the gallery record. The
test image is unchanged (no names, no references).

`src/flow/send-with-image.js`: the returned object gets `imageForMessage(messageIndex)`. It refuses with
`MESSAGES.busy` while a retry or a controller runs, with `MESSAGES.generating` while the host generates, and with
`Die Nachricht ist nicht mehr vorhanden.` when the message does not exist. Otherwise it runs exactly what a
retry runs (status bar with `Abbrechen`, `CHAT_CHANGED` aborts, `generateImageForMessage(index, { signal,
saveAfterAttach: true })`, failures through the retry toast). `retry` and `imageForMessage` share that code.

`index.js`: after the panel is mounted, `installMessageButton({ className: 'bfqig_mes_image', iconClass:
'fa-solid fa-image', title: 'Bild für diese Nachricht erzeugen', onClick: (index) => flow.imageForMessage(index) })`.

### 12.6 UI copy (German)

| Key / place | Text |
|---|---|
| tab | `Referenzen` |
| hint | `Referenzbilder zeigen dem Bildmodell, wie eine Figur aussieht. Sind mehrere Figuren auf einem Bild, die Namen mit Komma trennen. Verwendet werden nur angehakte Bilder, höchstens zwei pro Figur. Jedes erzeugte Bild wird von selbst Referenz für die Figuren darauf.` |
| names placeholder (upload and rows) | `Name der Figur, z. B. Kyouko` |
| upload button | `Bild hochladen` |
| filter placeholder | `Name suchen …` |
| section headings | `Hochgeladen`, `Erzeugt` |
| empty note | `Noch keine Referenzbilder.` |
| checkbox title | `Als Referenz verwenden` |
| delete title | `Löschen` |
| message button title | `Bild für diese Nachricht erzeugen` |

### 12.7 Tests and version
- New `tests/references/select.test.js`: every function of 12.2, including these cases from the owner's
  examples: scene Kyouko + Yuki with uploads `Kyouko`, `Yuki` and a generated `Kyouko, Yuki` picture ->
  group, Kyouko, Yuki; four people with `maxImages` 3 -> group picture plus the two singles; the library
  `[Yuki+Tooru, Kyouko, Yuki, Yuki+Tooru+Kyouko, Miyamura, Sengoku]` with all five in the scene -> for 3: trio,
  Miyamura, Sengoku; for 10: trio, Miyamura, Sengoku, Kyouko, Yuki (the duo stays out, Yuki has two); three
  people with two uploads each and `maxImages` 4 -> one each, then the first person's second; a picture with a
  person outside the scene, a disabled picture and `maxImages` 0 are never chosen. `matchName` with the measured
  answers `Kyouko Hori from Horimiya` -> `Kyouko`, `Yuki Yoshikawa` -> `Yuki`, `Izumi Miyamura` -> `null` for
  the list `[Kyouko, Yuki]`. The preamble string exactly.
- `tests/prompt`: the new system prompt and default instruction (single lines, exact), the two sentences,
  `splitShownLine` (plain, trailing spaces, behind a think block, `Shown: none`, no line), `buildLlmRequest`
  with and without names; the legacy defaults 1.0, 1.1 and 1.2 are migrated.
- `tests/providers`: `maxReferenceImages` and `buildRequest` with references for both providers.
- `tests/gallery`, `tests/settings`: `names`/`enabled` on records, `updateRecord`, `references` in the settings.
- `tests/architecture.test.js`: `src/references/select.js` joins the PURE list.
- No existing test is deleted; the count does not drop (194 before). Version `1.3.0`.
- Live test (orchestrator): SillyTavern test instance, `hidream-o1-image-dev` and `seedream-v4.5`, an uploaded
  reference, "Senden + Bild", the message button, the Referenzen tab.
