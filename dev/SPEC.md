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

## 13. Key lookup without host errors (version 1.3.1, **BINDING**)

Field report from the phone (TauriTavern, 2026-11-12): a red toast `Backend Error: Failed to find secret
api_key_nanogpt: Permission denied: Keys exposure not allowed` at every start. Cause, read in the TauriTavern
v2.4.0 source: every command that fails is published as a backend error and shown as a toast
(`src/script.js`, `showBackendErrorToast`), and `find_secret` fails both when keys exposure is off and when no
key is stored. The extension called `/api/secrets/find` on every key check. The switch itself is read once when
the app starts (`composition/services/mod.rs`), so turning it on needs "Save" and a full restart of the app.

`src/host/secrets.js` (replaces the request order of section 5.3; the two exports and their results stay):
1. In parallel `POST /api/secrets/settings` -> `allowKeysExposure` (boolean, else unknown) and
   `POST /api/secrets/read` -> whether the key is stored (unknown when the route fails).
2. Not stored -> `missing`, no further request. Exposure off -> `locked`, no further request.
3. Otherwise `POST /api/secrets/find`: a value -> `readable`; none -> `locked` when the key is stored, else `missing`.

`/api/secrets/settings` and `/api/secrets/read` never fail in TauriTavern for these states, so no toast appears.
Live check in SillyTavern 1.18 with the two answers simulated: exposure off and key not stored each caused no
`find` request. On the phone itself this is unverified.

## 14. Reference groups, name picker and manual order (version 1.4.0, **BINDING**)

Owner's request: when uploading, existing characters are ticked in a multi-select instead of typed again; the
list below is grouped by who is on the pictures (one group per character, one per combination such as Kyouko +
Yuki); the pictures of a group can be put in order by hand. This section replaces the list layout, the upload
form and the tie-breaks of section 12; everything else of section 12 stays.

### 14.1 Rules
1. A **group** is the set of pictures with exactly the same names (ignoring case and order of the names).
   Uploaded and generated pictures of the same people share one group.
2. The order inside a group is the order of use: the first picture of a group is taken first.
3. Default order of a group nobody sorted: uploads in upload order, then generated pictures newest first
   (what section 12 did). As soon as the owner moves a picture, the group keeps exactly that order and new
   pictures of that group go to the end. So a picture pinned to the top stays there.

### 14.2 PURE: `src/references/select.js`
```js
export function groupKey(names)                              // -> string
export function groupCandidates({ uploads, gallery, order }) // -> [{ key, names, items: [{ url, names, enabled, source, timestamp }] }]
export function toCandidates({ uploads, gallery, order })    // -> flat list, as before
export function allNames(groups)                             // -> string[]
export function moveInList(list, value, direction)           // -> new array
```
- `groupKey`: `normalizeNames`, lower-cased, sorted (`localeCompare`), joined with `|`. `''` for no names.
- `groupCandidates`: the candidates of section 12.2 (same filters and item fields; pictures without a name are
  left out) collected by `groupKey`. A group's `names` are those of its first item in default order. Default
  item order: uploads in list order, then gallery records in list order (newest first). `order` is a plain object
  `{ [groupKey]: string[] }`: when it holds a non-empty array for the group, the items whose url is in that
  array come first in that order (urls that no longer exist are ignored) and all other items follow in default
  order. Anything else for `order` or for an entry means "not sorted". Groups are returned sorted by the number
  of names, then by `key`.
- `toCandidates`: the items of `groupCandidates` in group order, flattened. `knownNames` and
  `selectReferences` keep working on that list.
- `allNames`: every name that occurs in the groups (enabled or not), unique without regard to case (first
  spelling wins), sorted with `localeCompare`.
- `moveInList(list, value, direction)`: `direction` is `-1` (one place towards the front) or `1`; a copy with
  `value` swapped with its neighbour; unchanged copy when `value` is missing or already at that end.
- `selectReferences` ties, replacing 12.2: fewer names, then the earlier candidate. The rule "an upload before a
  generated picture" is gone as a rule of its own: the default group order already puts uploads first, and a
  manual order must be able to put a generated picture in front.

### 14.3 PURE: `src/settings/defaults.js`
`DEFAULT_SETTINGS.referenceOrder = {}`. `normalizeSettings`: a plain object whose values are arrays; each array
keeps its unique non-empty strings, at most 300; keys with an empty result and non-array values are dropped;
anything else becomes `{}`.

### 14.4 UI: `src/references/store.js`
```js
export function listGroups()                    // groupCandidates({ uploads, gallery, order: settings.referenceOrder })
export function listCandidates()                // toCandidates with the same three inputs
export function listNames()                     // allNames(listGroups())
export function moveReference(url, direction)   // -1 | 1
```
`moveReference`: find the group that holds `url`, take the urls of its items in the order shown, apply
`moveInList`, store that full list under the group's key in `settings.referenceOrder` (other keys untouched),
then notify the listeners. Nothing happens when the url is unknown or the list did not change.

### 14.5 UI: `src/references/view.js`, `style.css`
Upload form, top to bottom:

| Element | Id or class |
|---|---|
| name picker: `<details>` with a `<summary>` and one `<label class="checkbox_label">` per known name | `bfqig-ref-names-select`, summary `bfqig-ref-names-summary`, checkboxes class `bfqig-ref-name-option` (`value` = the name) |
| text input for a new name | `bfqig-ref-names` (as before) |
| pick label, hidden file input, file name, upload button | as in section 12 |

- The picker lists `listNames()`. Its summary reads `Figuren auswählen` while nothing is ticked, else the ticked
  names joined with `, `. With no known names the picker is hidden.
- The upload sends the ticked names followed by the names typed in the text input (commas separate several),
  through `addUpload(file, <array>)`. After a successful upload the ticks, the text and the file are cleared.
  A re-render must not lose ticks, typed text or the chosen file: the form is built once and only the option
  list is refreshed (ticks of names that still exist are kept).
- The list shows one block per group of `listGroups()`: `<section class="bfqig-ref-group" data-key="<key>">`
  with a heading (class `bfqig-ref-group-title`): the names joined with ` + `, then ` (<number of pictures>)`.
  The headings `Hochgeladen` and `Erzeugt` are gone.
- A row (`.bfqig-ref-item`, `data-url`) holds, in this order: thumbnail button, names input, checkbox, button
  up (class `bfqig-ref-up`, icon `fa-solid fa-arrow-up`, title `Nach oben`), button down (class
  `bfqig-ref-down`, icon `fa-solid fa-arrow-down`, title `Nach unten`), delete button. Up is disabled on the
  first row of a group, down on the last. They call `moveReference(url, -1 | 1)`.
- A generated picture carries a small label `erzeugt` (class `bfqig-ref-badge`) next to its names input.
- On a narrow list (container query, 480 px) the row wraps: thumbnail and names input on the first line, the
  four controls on the second, the badge at the end of the second line.
- The upload form lives in `src/references/upload-form.js` (`createUploadForm()` -> `{ element, setNames(names) }`),
  built once; the picker's summary shows a caret so it reads as a dropdown.
- Viewer, delete, names editing, checkbox and filter behave as in section 12; the filter hides rows and whole
  groups without a visible row. Changing the names of a picture moves it to the matching group on re-render.

| Key / place | Text |
|---|---|
| hint (replaces 12.6) | `Referenzbilder zeigen dem Bildmodell, wie eine Figur aussieht. Bilder mit denselben Figuren bilden eine Gruppe. Die Reihenfolge in der Gruppe ist die Reihenfolge, in der sie verwendet werden: höchstens zwei Bilder pro Figur, nur angehakte. Jedes erzeugte Bild wird von selbst Referenz für die Figuren darauf.` |
| picker summary, nothing ticked | `Figuren auswählen` |
| new-name placeholder | `Neue Figur, z. B. Kyouko` |
| error without any name (replaces the text of 12.5) | `Bitte eine Figur auswählen oder einen Namen eintragen.` |
| badge | `erzeugt` |
| move buttons | `Nach oben`, `Nach unten` |

### 14.6 Tests and version
- `tests/references/select.test.js`: `groupKey` (case, order, empty); `groupCandidates` (grouping of uploads and
  generated pictures with the same people, default order, a stored order, a new picture after a stored order
  goes to the end, stale urls ignored, group sorting); `toCandidates` with `order`; `allNames`; `moveInList`
  (both directions, both ends, missing value); `selectReferences`: all examples of section 12.7 still hold, and a
  generated picture moved in front of an upload by a stored order is chosen first.
- `tests/settings/defaults.test.js`: `referenceOrder` normalisation.
- No existing test is deleted; assertions on the removed tie-break are updated. The count does not drop (229
  before). Version `1.4.0`.
- Live test (orchestrator): SillyTavern test instance: tick an existing name and upload a second picture, upload
  a group picture with two ticked names, move a picture and check the request order.

## 15. Editable picture description (version 1.5.0, **BINDING**)

Owner's request: the text under "Prompt" is only the task for the chat model. What the chat model then writes
about the picture (hair, clothes, action, place, light, at most 45 words) was fixed in the system prompt, so
emotions, bodies, movement and the reason for a moment could not be asked for. That part becomes a setting. The
frame stays fixed: who is shown (line `Shown:`), the head count in front, the naming rule, and the reference
preamble the extension adds itself.

### 15.1 PURE: `src/prompt/scene.js`
```js
export const DEFAULT_DESCRIPTION    // 'who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light'
export const DESCRIPTION_WORDS = { min: 20, max: 200, fallback: 45 }
export function buildSystemPrompt({ description, maxWords } = {})   // -> string, one line
export function buildLlmRequest({ instruction, sceneBlock, characterBlock = '', knownNames = [], description, maxWords })
```
- `buildSystemPrompt`: `description` is cleaned (whitespace runs to one space, trimmed, trailing periods removed);
  not a string or empty -> `DEFAULT_DESCRIPTION`. `maxWords` is rounded and clamped to `DESCRIPTION_WORDS.min`..
  `max`; not a finite number -> `fallback`.
- The text is the system prompt of section 12.3 with three variable places:
  1. `Line 2: one short description in plain English, at most <maxWords> words.` For more than 50 words the
     sentence reads `Line 2: one description in plain English, at most <maxWords> words.`
  2. `Then, in this order: <description>.`
  3. Up to 50 words: `Many image generators ignore everything after about 50 words, so the most important things
     come first and nothing is mentioned that cannot be seen.` Above 50: `The most important things come first
     and nothing is mentioned that cannot be seen.`
  Everything else is character for character the text of 12.3. With the defaults the result equals the 12.3
  text exactly (the existing test keeps asserting that).
- `buildLlmRequest`: `systemPrompt = buildSystemPrompt({ description, maxWords })`; the rest is unchanged.

### 15.2 PURE: `src/settings/defaults.js`
`DEFAULT_SETTINGS.description = DEFAULT_DESCRIPTION`, `DEFAULT_SETTINGS.descriptionWords = 45`.
`normalizeSettings`: `description` a string, empty or whitespace only -> `DEFAULT_DESCRIPTION`; `descriptionWords`
an integer clamped to 20..200, anything else -> 45.

### 15.3 WIRING: `src/prompt/build.js`
The chat-model request passes `description: settings.description` and `maxWords: settings.descriptionWords`.
The direct path is unchanged.

### 15.4 UI: `src/settings/panel.js`
Directly after the row with the `Standard` button of the prompt, before the parallel checkbox:

| Element | Id |
|---|---|
| note under the prompt row | class `bfqig-note` |
| label + textarea (`rows="4"`, class `text_pole`) | `bfqig-description` |
| reset button (`menu_button`, text `Standard`) in a `flex-container` | `bfqig-description-reset` |
| note | class `bfqig-note` |
| label + number input (`min="20" max="200" step="5" inputmode="numeric"`, class `text_pole`) | `bfqig-description-words` |
| note | class `bfqig-note` |

The textarea writes `description` on `input`; the reset button restores `DEFAULT_DESCRIPTION`. The number input
writes on `change`, clamps like the context-count input does and shows the clamped value.

| Key / place | Text |
|---|---|
| note under the prompt row | `Das ist die Aufgabe an das Textmodell: was das Bild zeigen soll.` |
| label of the textarea | `Bildbeschreibung` |
| note under the description | `Was das Textmodell beschreibt, in dieser Reihenfolge (auf Englisch). Immer fest dabei: wer im Bild ist, die Zahl der Personen vorne und die Zuordnung der Referenzbilder.` |
| label of the number input | `Wörter höchstens` |
| note under the number input | `Anime-Modelle (SDXL) lesen nur etwa 50 Wörter. Modelle mit Referenzbildern vertragen 80 bis 120.` |

### 15.5 Tests and version
- `tests/prompt`: `buildSystemPrompt()` and `buildLlmRequest` without the two parameters still give the exact
  12.3 text; a custom description and word count appear in the right places; trailing period, line breaks and
  empty text in the description; clamping and garbage for `maxWords`; the two sentence variants above 50 words;
  the result is always one line.
- `tests/settings`: defaults and normalisation of `description` and `descriptionWords`.
- No existing test is deleted; the count does not drop (238 before). Version `1.5.0`.
- Live test (orchestrator): SillyTavern test instance, a description that asks for emotion, body language and
  movement with 90 words, real chat model and `hidream-o1-image-dev`: the request carries it, the answer follows it.

### 15.6 Warning when the chat model gives no description
Found in that live test: NanoGPT refused the chat model (`403 account_temporarily_restricted`), the extension
fell back to the direct prompt and said nothing, so the owner paid for a picture made from raw chat text
without knowing why it looked different.

- `buildImagePrompt` additionally returns `llmProblem`: `null` when the chat model was not asked or gave a
  description; otherwise the error message of the failed request, or `leere Antwort` for an empty answer.
- `prepareImage` shows `notify.warning('Das Textmodell hat keinen Bildprompt geliefert (<llmProblem>). Das Bild
  entsteht aus dem Rohtext der Nachricht.')` and goes on with the direct prompt as before.
- Checked in SillyTavern with both requests simulated (nothing sent): the warning appears next to the host's own
  error toast.

## 16. Prompt preview, and reply + picture from the own message (version 1.6.0, **BINDING**)

Owner's request, two parts:
1. While a picture is generated, a button shows the finished image prompt, so a picture that is going wrong can
   be cancelled early instead of after the wait.
2. The reply was deleted and the owner's own message is the last one in the chat: a tap on the picture button of
   that message writes the reply again and then the picture, without deleting and retyping the message.

Host fact both parts build on (read in `script.js` of SillyTavern 1.18 and TauriTavern 2.4.0): a click on
`#send_but` with an empty `#send_textarea` runs `Generate('normal')`. With the user's message last in the chat
no message is added, so `GENERATION_STARTED` and `MESSAGE_RECEIVED` fire but `MESSAGE_SENT` does not. (Two host
settings add a message after all, a pending file attachment and the preset option "send if empty"; then
`MESSAGE_SENT` fires as usual and nothing below may break on it.)

### 16.1 WIRING: `src/flow/generate-image.js`
```js
export async function prepareImage(lastIndex, { signal, onPrompt } = {})
export async function generateImageForMessage(messageIndex, { signal, saveBefore = false, saveAfterAttach = false, onPrompt } = {})
```
- `prepareImage` calls `onPrompt(prompt)` exactly once with the final prompt string that goes to the image model
  (style, reference preamble and description, as returned by `buildImagePrompt`). The call sits directly after
  the `throwIfAborted(signal)` that follows `buildImagePrompt`, so a cancelled job never reports a prompt, and
  before the two warnings.
- An exception inside `onPrompt` is logged with `console.warn` and never fails the image. No `onPrompt` given:
  nothing happens.
- `generateImageForMessage` passes `onPrompt` through. `generateTestImage` is unchanged.

### 16.2 UI: `src/flow/hold.js`
`createHold()` returns `{ engage, release, setStatus, setPrompt }`.

- `setPrompt(text)`: a non-empty string is remembered for the status bar that is shown right now and the bar is
  drawn again. No bar shown: ignored (a late prompt of a finished job must not open a bar). Anything else than a
  non-empty string forgets the prompt.
- `setStatus(null)` removes the bar and forgets the prompt and the open state. `setStatus(text, options)` draws
  the bar again and keeps prompt and open state (hold mode changes the text while a job runs).
- With a prompt remembered the bar carries, between the status text and the cancel button, a button
  `#bfqig-status-prompt` (`type="button"`, class `menu_button`, `aria-expanded`). Text `Prompt anzeigen`, opened
  `Prompt verbergen`. A click toggles the open state and draws the bar again.
- Opened, the bar ends with `<div id="bfqig-status-prompt-text" class="bfqig-status-prompt-text">` holding the
  prompt as `textContent` (never as HTML).
- Element order in the bar: spinner, `.bfqig-status-text`, prompt button, cancel button, prompt text.
  Ids, classes and behaviour of everything that exists today stay as they are.

### 16.3 PURE: `src/flow/messages.js`, `src/flow/preflight.js`
New entries in `MESSAGES`:

| Key | Text |
|---|---|
| `resendComposer` | `Das Nachrichtenfeld muss dafür leer sein.` |
| `resendNotLast` | `Das geht nur, solange deine Nachricht die letzte im Chat ist.` |

```js
export function resendExitMessage(host)                              // -> string | null
export function earlyExitMessage(host, isBusy, { resend = false } = {})
```
- `resendExitMessage`: composer text other than the empty string (not trimmed: the host would send whitespace
  as a message) -> `resendComposer`. Otherwise the message at `host.getChatLength() - 1` is missing or not
  `is_user` -> `resendNotLast`. Otherwise `null`.
- `earlyExitMessage`: `busy`, `noChat` and `generating` as before, in that order. Then with `resend` the result
  of `resendExitMessage(host)`; without it the `emptyText` and `slash` checks as before.

### 16.4 PURE: `src/flow/run-state.js` (hold mode)
`start({ resend = false } = {})`. Without `resend` nothing changes. With `resend`:
- `earlyExitMessage(host, run !== null, { resend: true })`; after the awaited `precheck`, next to the existing
  re-checks, `resendExitMessage(host)` once more (the chat may have changed meanwhile): a text -> warning toast,
  `false`, no click.
- `userIndex = host.getChatLength() - 1`, the existing message. `hold.engage(userIndex)`, status, timers and the
  click are the same as today.
- No other change: `GENERATION_STARTED` arms the run, the reply arrives at an index above `userIndex`, a
  `MESSAGE_SENT` that does come moves `userIndex` as it does today.

### 16.5 PURE: `src/flow/parallel-run.js` (parallel mode)
`start({ resend = false } = {})`; the host object gains `getChatLength`. Without `resend` nothing changes: the
image job starts on `MESSAGE_SENT`, never on `GENERATION_STARTED`. With `resend`:
- The same two checks as in 16.4. The run remembers `resend: true` and `userIndex = host.getChatLength() - 1`.
- Nothing is generated before the host really started: the image job starts on the first `GENERATION_STARTED`
  that is neither a dry run nor of type `quiet`, while the run is still `armed`. That handler sets the phase to
  `running`, clears the start timer and calls `startImageJob(r, r.userIndex)`. Later `GENERATION_STARTED`
  events of the same run (tool calls) start no second job.
- The host never starts: the existing start timer ends the run with `notStarted`; no image job was started and
  nothing was paid.
- A `MESSAGE_SENT` during a resend run is harmless: the job that already runs stays the only one.

### 16.6 WIRING: `src/flow/send-with-image.js`
- All three places that generate a picture report the prompt to the status bar with `onPrompt: hold.setPrompt`:
  `processReply` of the hold controller, `prepareImage` of the parallel controller, `runForMessage`.
- The parallel controller's host object gets `getChatLength`.
- `imageForMessage(messageIndex)`: after `refuseWhileBusy()` and the missing-message check, a message that is
  `is_user` and has the index `getChatLength() - 1` goes to
  `(getSettings().parallelImage ? parallelController : holdController).start({ resend: true })`. Every other
  message keeps today's behaviour (one more picture for that message, also for an own message further up).
- The returned `start` (wand menu entry "Senden + Bild") is unchanged and still asks for text.

### 16.7 `style.css`
- `.bfqig-status` gets `flex-wrap: wrap`.
- `.bfqig-status #bfqig-status-prompt`: like the cancel button (`flex: 0 0 auto; min-height: 40px; margin: 0;
  white-space: nowrap`).
- `.bfqig-status-prompt-text`: `flex: 1 0 100%; max-height: 30vh; overflow-y: auto; white-space: pre-wrap;
  overflow-wrap: anywhere; user-select: text; font-size: 0.9em;` with a top border in
  `var(--SmartThemeBorderColor)` and a small padding.

### 16.8 Tests, README, version
- New file `tests/flow/resend.test.js`; `tests/flow/fake-host.js` gets what it needs (`getChatLength` on the
  parallel host). Existing test files are not edited. At least:

  | Controller | Case |
  |---|---|
  | hold | text in the composer -> `resendComposer`, no click, not active |
  | hold | last message not the user's -> `resendNotLast`, no click |
  | hold | happy path: `engage` with the index of the existing user message (not the chat length), one click, `GENERATION_STARTED`, reply at index + 1 -> `processReply` called with that reply index, then released |
  | hold | the last message changes while `precheck` is awaited -> `resendNotLast`, no click |
  | hold | `start()` without `resend` and an empty composer still answers `emptyText` |
  | parallel | both refusals as above |
  | parallel | happy path: no job after the click; `GENERATION_STARTED('normal')` -> exactly one job with `lastIndex` = index of the user message; reply + finished job -> `attachImage` with the reply index |
  | parallel | `GENERATION_STARTED` of type `quiet` or with `dryRun === true` starts no job |
  | parallel | a second `GENERATION_STARTED` starts no second job |
  | parallel | the host never starts -> start timer, `notStarted`, zero jobs |
  | parallel | `start()` without `resend`: `GENERATION_STARTED` alone starts no job, `MESSAGE_SENT` does |
  | preflight | `resendExitMessage`: whitespace-only composer counts as text; empty chat -> `resendNotLast` |

- No existing test is deleted; the count does not drop (250 before). `npx eslint .` stays clean, no file above
  400 lines, `tests/architecture.test.js` green.
- README, section "Use": one item for the "Prompt anzeigen" button of the status bar, one for the picture
  button on the own last message (reply deleted -> reply and picture again, message box must be empty). The
  existing bullet "The image button among a message's icons ..." stays correct.
- Version `1.6.0` in `package.json`, `package-lock.json` (both places) and `manifest.json`.

### 16.9 Live test (orchestrator, not the implementer)
SillyTavern test instance, chat model `deepseek-chat`, image model `hidream-o1-image-dev`, one request at a
time: the prompt button appears while the picture is generated and shows the prompt that the image request
carries; with the reply deleted, the picture button on the own message writes a new reply and attaches a
picture, in hold mode and in parallel mode, and the chat holds no second copy of the own message.

## 17. Several pictures per run, pictures below each other (version 1.7.0, **BINDING**)

Owner's request, two parts:
1. A setting that makes more than one picture per run: the same description, several models, each with its own
   count ("2 of that model and 2 of that").
2. In the chat only one picture of a message is visible. Every new picture, from such a run or from one more
   press on the picture button, is to appear below the ones that are already there.

Cause of part 2 (read in `src/host/chat.js` and in `script.js` of both hosts): `attachImageToMessage` stamps
`extra.media_display = 'gallery'` on the message, and the hosts' gallery shows one picture with arrows. The
hosts' other value, `'list'`, draws every picture of the message below the previous one.

### 17.1 HOST: `src/host/chat.js`
`attachImageToMessage` sets `extra.media_display = 'list'` on every call, also on a message that carries
`'gallery'` from an earlier version. Nothing else changes there. Messages that get no new picture are not
touched (no migration of old chats).

### 17.2 PURE: `src/settings/defaults.js`
```js
export const BATCH_LIMITS = Object.freeze({ perModel: 4, total: 8 });
export function normalizeBatch(value)                    // -> [{ model, count }]
export function addToBatch(list, modelId)                // -> new list
export function setBatchCount(list, modelId, count)      // -> new list
export function removeFromBatch(list, modelId)           // -> new list
export function batchTotal(list)                         // -> number of pictures
export function expandImageJobs(list, fallbackModel)     // -> ['model-a', 'model-a', 'model-b']
```
- `normalizeBatch`: not an array -> `[]`. An entry needs a non-empty string `model` (trimmed). `count` becomes
  an integer clamped to 1..`perModel`; anything that is no finite number -> 1. A model listed twice keeps its
  first entry. Entries stay in order while the running total fits into `total`: an entry that would go beyond
  is cut down to what is left, entries with nothing left are dropped.
- `addToBatch`: a listed model gets `count + 1`, a new one is appended with `count: 1`; the result is
  normalised (a full list or a model already at `perModel` comes back unchanged in content).
- `setBatchCount`: sets the count of a listed model, result normalised. `removeFromBatch`: drops the model.
- `expandImageJobs`: the normalised list is empty -> `[fallbackModel]`. Otherwise the model ids, each repeated
  `count` times, in list order.
- `DEFAULT_SETTINGS.batch = { nanogpt: [], openrouter: [] }` (frozen like `favorites`);
  `normalizeSettings`: `batch: perProvider(src.batch, (value) => normalizeBatch(value))`.

### 17.3 UI: new file `src/settings/batch-view.js`, slot in `src/settings/panel.js`
```js
export function createBatchView()     // -> { element, refresh() }
```
`panel.js`: `<div class="bfqig-batch-slot"></div>` directly after `#bfqig-model-ref-note`; the view is mounted
there. `refresh()` is called after the model list has loaded, when the provider changes and when the model
picker reports a change. No other change in `panel.js`.

The view reads and writes `settings.batch[settings.provider]` through `getSettings` / `updateSettings` and
shows model names from `getModels(providerId)` (id as fallback, also while the list is loading or failed).

| Element | Id / class | Notes |
|---|---|---|
| label | class `bfqig-label` | text `Mehrere Bilder` |
| list | `#bfqig-batch-list` | one row per entry, in list order |
| row | `.bfqig-batch-row`, `data-model="<id>"` | |
| model name | `.bfqig-batch-name` | |
| count | `input.bfqig-batch-count.text_pole` | `type="number" min="1" max="4" step="1" inputmode="numeric"`, `aria-label="Anzahl"`; writes on `change` via `setBatchCount` and shows the stored value |
| remove | `button.bfqig-batch-remove.menu_button.bfqig-icon-button` | icon `fa-solid fa-xmark`, `title` and `aria-label` `Aus der Liste nehmen` |
| add | `#bfqig-batch-add`, class `menu_button` | text `Gewähltes Modell hinzufügen`; adds `settings.models[providerId]` via `addToBatch`; disabled when no model is chosen, the total is 8 or that model stands at 4 |
| note | `#bfqig-batch-note`, class `bfqig-note` | texts below |

| State | Note text |
|---|---|
| list empty | `Leer = ein Bild mit dem oben gewählten Modell.` |
| one picture | `1 Bild pro Durchgang. Es zählt nur diese Liste.` |
| n pictures | `<n> Bilder pro Durchgang, alle aus derselben Beschreibung. Es zählt nur diese Liste. Jedes Bild kostet einzeln.` |

"Testbild generieren" stays one picture with the chosen model.

### 17.4 PURE: `src/prompt/scene.js`
```js
export function promptPreviewText(entries)    // entries: [{ model, prompt }] in job order -> string
```
All entries carry the same prompt -> that prompt. Otherwise one block per distinct prompt, in the order of
first appearance: a line with the distinct model ids that get it, joined by `, ` and ended with `:`, then the
prompt; blocks are separated by one empty line. No entries -> `''`.

### 17.5 WIRING: `src/prompt/build.js`
`buildImagePrompt` is replaced by two steps, so the chat model is asked once per run and not once per model:
```js
export async function describeScene({ lastIndex, settings, candidates = [] })
// -> { context, instruction, description, usedLlm, shownNames, llmProblem, loaded }
export async function composeImagePrompt(scene, { settings, candidates = [], maxPromptChars, maxReferences = 0 })
// -> { prompt, references, failedReferences }
```
- `describeScene` does everything of today's `buildImagePrompt` up to and including `shownNames`. `loaded` is
  a `Map` from picture url to the promise of its JPEG data URL, empty at first.
- `composeImagePrompt` does the rest for one model: `selectReferences`, loading (through `scene.loaded`, so a
  picture that several models use is converted once), preamble, the direct text when `usedLlm` is false,
  `finalizePrompt`. For one model the result is exactly what `buildImagePrompt` returns today.
- No caller of `buildImagePrompt` is left; the function is removed.

### 17.6 WIRING: `src/flow/generate-image.js`
`prepared` changes its shape (the two controllers pass it through untouched):
```js
prepared = { images: [{ url, prompt, extension, model, ts }], providerId, folder, names }
```
`prepareImage(lastIndex, { signal, onPrompt })`:
1. Target as today; the models of the run are
   `expandImageJobs(settings.batch[provider.id], settings.models[provider.id] || provider.defaultModel)`.
2. `getModelInfo` once per distinct model, `describeScene` once, then the abort check. The warning for
   `llmProblem` is shown once.
3. `composeImagePrompt` once per distinct model with that model's prompt limit and reference slots. One
   warning when any of them reports failed reference pictures.
4. `onPrompt(promptPreviewText(entries))`, once, as in 16.1.
5. All pictures are requested at the same time (`Promise.allSettled` over `produceImage`). File names: one
   picture `bfqig_<ts>` as today, several `bfqig_<ts>_<n>` with n from 1 in job order (`ts` of an image entry is
   that suffix-bearing name part, so the save-dialog name stays unique too).
6. After all settled: the signal is aborted -> every uploaded picture of the run is discarded and the abort is
   thrown. No picture succeeded -> the first error is thrown unchanged. Some failed ->
   `notify.warning('<failed> von <n> Bildern fehlgeschlagen: <first reason>')` and the run goes on with the
   rest.
7. `images` holds the successful pictures in job order.

`attachPreparedImage`: as today everything up to the gallery records happens before the first `await`. The
message check runs once; then every picture is attached with `attachImageToMessage` and recorded (model of
that picture, same `names`), in order. Message gone, or attaching the first picture fails -> all pictures are
discarded and the message-gone error is thrown. With `autoSaveDialog` the save dialogs come one after another
(not awaited by the caller), never several at once.

`discardPreparedImage` removes every uploaded picture of `prepared`. `generateImageForMessage` returns
`{ url, prompt }` of the first picture. `generateTestImage` is unchanged.

### 17.7 `style.css`, README, version
- Rows of the batch list: name left (takes the room, wraps), count input narrow (about 4.5em), remove button
  right, touch height like the other controls of the panel.
- README: "Use" gets an item for "Mehrere Bilder" (list of models with counts, one description, every picture
  is paid for on its own, all pictures of a run must arrive within four minutes) and the sentence that the
  pictures of a message appear below each other.
- Version `1.7.0` in `package.json`, `package-lock.json` (both places) and `manifest.json`.

### 17.8 Tests
- New `tests/settings/batch.test.js`: `normalizeBatch` (garbage, trimming, duplicates, per-model clamp, total
  cut and drop), `addToBatch` (new, existing, model at 4, list at 8), `setBatchCount`, `removeFromBatch`,
  `batchTotal`, `expandImageJobs` (empty -> fallback, order and repetition), `normalizeSettings` default and
  per-provider normalisation of `batch`.
- New `tests/prompt/prompt-preview.test.js`: `promptPreviewText` for one entry, equal prompts, two distinct
  prompts with grouped model ids, no entries.
- An existing test that compares the whole settings object or the list of exports may be extended by exactly
  the new key; nothing else in existing tests changes and no test is deleted. The count does not drop (265
  before). `npx eslint .` clean, no JS file above 400 lines, `tests/architecture.test.js` green without
  changes to it.

### 17.9 Live test (orchestrator, not the implementer)
SillyTavern test instance: list `hidream-o1-image-dev` x1 and `z-image-turbo` x2. One run attaches three
pictures to one reply, all visible below each other; the gallery holds three records with the right models;
the prompt preview shows what each model gets; one more press on the picture button adds the next ones below.

## 18. Several prompts per run, pictures arrive one by one (version 1.8.0, **BINDING**)

Owner's request: with a list like "HiDream x8, Seedream x8" every picture is to get a slightly different angle
or style. The owner writes the wishes into the own message as an out-of-character note ("one picture like a
polaroid; one from the front; one from the view of someone walking by; one like on a movie set"). The chat
model turns them into several prompts; the extension, never the chat model, decides which model gets which
prompt how often.

Decisions taken with the owner:
- One request to the chat model returns all prompts (one line per wish), not one request per wish.
- Distribution is dealing cards over the jobs in list order: job 1 -> prompt 1, job 2 -> prompt 2, ..., then
  again prompt 1. With 2 prompts and "HiDream x8, Seedream x8" each model draws each prompt 4 times.
- The number of pictures and their models come from the list alone. A chat model that writes no or broken
  wishes costs nothing but variety: all pictures get the one normal prompt.
- Limits 8 per model and 16 per run; at most 4 requests in flight; every picture appears as soon as it is
  finished; the reply waits only for the first one.
- Pictures of a run with wishes are tagged but not checked as reference pictures (a polaroid look would
  otherwise carry over into the next pictures).

The work is cut into two lanes with disjoint files. Lane A owns everything PURE, the tests and the documents;
lane B owns the wiring. Lane B codes against the signatures below; they are binding for both.

### 18.1 PURE (lane A): `src/settings/defaults.js`
`BATCH_LIMITS = { perModel: 8, total: 16 }`. Nothing else changes; the view reads the limits from there.

### 18.2 PURE (lane A): new file `src/prompt/pictures.js`
```js
export const PICTURE_PROMPT_LIMIT = 8;
export function splitPictureLines(text, { max = PICTURE_PROMPT_LIMIT } = {})   // -> string[]
export function assignPrompts(jobCount, promptCount)                           // -> number[] of length jobCount
```
- `splitPictureLines` gets the chat model's answer after `splitShownLine` took the `Shown:` line away. A line
  that starts (after optional spaces and the characters `> * _` and backtick, quote marks, `-`, `#`) with the
  word `Picture`, a number and one of `: . ) -` begins a picture; the comparison ignores case and the number
  itself is not used (order of appearance counts). Lines after it that begin no picture belong to it. Every
  picture text goes through `cleanLlmOutput` of `scene.js`; empty ones are dropped; at most `max` are returned.
  No such line -> `[]`. Text in front of the first picture line is ignored.
- `assignPrompts`: index `i` gets `i % Math.min(promptCount, jobCount)`; `promptCount` below 1 counts as 1;
  `jobCount` below 1 -> `[]`.

### 18.3 PURE (lane A): `src/prompt/scene.js`
```js
export function buildSystemPrompt({ description, maxWords, maxPrompts = 1 } = {})
export function buildLlmRequest({ instruction, sceneBlock, characterBlock = '', knownNames = [], description, maxWords, maxPrompts = 1, requestMessage = '' })
export function promptPreviewText(entries)
```
- `buildSystemPrompt`: `maxPrompts` that is not an integer above 1 -> exactly today's text (the existing tests
  keep asserting it). Above 1 (clamped to `PICTURE_PROMPT_LIMIT`) today's text is followed by one space and:

  `Exception for several pictures: the block "[Picture requests]" repeats the latest message of the user. When that message asks for several different pictures of this moment, for example in an out-of-character note with one camera angle, style or format per picture, write one description per requested picture instead of line 2, at most <maxPrompts>. Put each on its own line that starts with "Picture 1:", "Picture 2:" and so on, in the order they were asked for. Each of these descriptions stands on its own, follows every rule for line 2 and carries out the request for its picture. When the message asks for no such thing, answer in the two lines described above.`
- `buildLlmRequest`: passes `maxPrompts` on. With `maxPrompts` above 1 and a `requestMessage` that is not
  empty after trimming, the block `[Picture requests]\n<requestMessage>` and an empty line are inserted directly
  in front of the final `Image prompt:` line (after the scene block). Otherwise the prompt is exactly today's.
- `promptPreviewText`: as today one block per distinct prompt in the order of first appearance, but the head
  line now counts: each distinct model id of the block, followed by ` x<n>` when it gets that prompt more than
  once (`hidream-o1-image-dev x4, seedream-v4.5 x4:`), joined by `, `, ended with `:`. All entries share one
  prompt -> that prompt without a head line, as today. (The multiplication sign is the plain letter x.)

### 18.4 PURE (lane A): new file `src/flow/image-pool.js`
```js
export function createImagePool({ jobs, produce, limit = 4, signal, discard })
// -> { total, failures, next(), abort() }
```
- `jobs`: array of anything. `produce(job, index, signal)` returns a promise; `signal` is the pool's own abort
  signal. At most `limit` calls are in flight; jobs start in order, the next one as soon as one settles. The
  first `limit` jobs start synchronously inside `createImagePool`.
- `next()`: promise for the next successful result as `{ index, job, value }`, in the order the results
  arrived (results that arrived before the call are queued). It resolves `null` once every job has settled or
  was never started because of an abort, and the queue is empty. Several pending `next()` calls are served in
  call order.
- `failures`: live array of `{ index, job, error }` in the order they happened. A failure never stops the
  other jobs.
- `abort()`: no further job starts, the pool's signal is aborted, queued results and results that still
  arrive are handed to `discard(value)` (when given) and never to `next()`, pending and later `next()` calls
  resolve `null`. Calling it twice is harmless. An abort of the outer `signal` does the same; a `signal` that
  is already aborted starts nothing.
- Rejections of jobs after an abort are not added to `failures`. Nothing in the pool throws out of a
  callback: an exception inside `discard` is swallowed.
- `total` is `jobs.length`.

Both new PURE files are added to `PURE_FILES` in `tests/architecture.test.js` (the only change there).

### 18.5 WIRING (lane B): `src/prompt/build.js`
```js
export const IMAGE_PROMPT_MIN_TOKENS = 2000;      // unchanged
export async function describeScene({ lastIndex, settings, candidates = [], maxPrompts = 1 })
// -> { context, instruction, descriptions, usedLlm, shownNames, llmProblem, loaded }
export async function composeImagePrompt(scene, { settings, candidates = [], maxPromptChars, maxReferences = 0 })
// -> { prompts, references, failedReferences }
```
- `describeScene`: `description` becomes `descriptions` (array). With `maxPrompts` above 1 the request carries
  `maxPrompts` and `requestMessage`: the nearest message with `isUser` at or before `lastIndex`, looking back at
  most 10 messages, as `<name>: <text>` with the text cleaned by `cleanMessageText` and cut with
  `truncateText(..., LIMITS.messageChars)`; none found -> `''`. The answer is split with `splitShownLine`, then
  `splitPictureLines`; pictures found -> they are the descriptions; none -> the one `cleanLlmOutput` text as
  today. `usedLlm` is `descriptions.length > 0`. The reply length asked for is
  `IMAGE_PROMPT_MIN_TOKENS + 300 * (maxPrompts - 1)`. One `Shown:` line holds for all pictures of the run.
- `composeImagePrompt`: one prompt per description (same references and preamble, each finalised on its own);
  without descriptions the one direct prompt as today.

### 18.6 WIRING (lane B): `src/flow/generate-image.js`
```js
prepared = { images, pool, total, wishes, preview, providerId, folder, names }
export async function prepareImage(lastIndex, { signal, onPrompt } = {})          // -> prepared
export async function attachPreparedImage(messageIndex, prepared, { token, save = false } = {})
export async function attachRemainingImages(messageIndex, prepared, { token, signal, onProgress } = {})
// -> { attached, failed, firstError, gone }
export function discardPreparedImage(prepared)
export async function generateImageForMessage(messageIndex, { signal, saveBefore, saveAfterAttach, onPrompt } = {})
// -> { url, prompt, prepared, token }
```
`prepareImage`:
1. Target, jobs (`expandImageJobs`), model infos as today. `maxPrompts` for `describeScene` is
   `PICTURE_PROMPT_LIMIT` when the run has more than one job, otherwise 1.
2. Prompts per distinct model via `composeImagePrompt`; job `i` gets prompt
   `assignPrompts(jobs.length, descriptions.length)[i]` of its model. More descriptions than jobs ->
   `notify.warning('Nur <jobs> von <descriptions> Bildwünschen werden gemalt: der Durchgang hat nur <jobs> Bilder.')`.
3. `onPrompt(preview)` once, as in 16.1, with `preview = promptPreviewText(entries)` over all jobs; then the
   two warnings of today.
4. `pool = createImagePool({ jobs, produce, limit: 4, signal, discard })`: `produce` calls `produceImage` with the
   pool's signal and returns the image entry `{ url, prompt, extension, model, ts }`; `discard` removes an
   uploaded picture. File names as in 17.6.
5. `await pool.next()`: the first finished picture. `null` -> the abort is thrown when the signal is aborted,
   otherwise the error of the first failure.
6. `images` holds that one picture; `total` is the number of jobs; `wishes` is true when the run has more
   than one description.

`attachPreparedImage` attaches and records `prepared.images` as today (everything up to the gallery records
before the first `await`). A gallery record of a run with `wishes` gets `enabled: false`, otherwise `true` as
today.

`attachRemainingImages` takes the rest out of `prepared.pool`, one `await pool.next()` after the other:
- Before a picture is attached it waits until the host is not generating (`isGenerating()` of `host/st.js`,
  checked once a second), so a reply that is being written is never touched.
- `signal` aborted -> the picture is discarded, the pool aborted, the loop ends.
- The message is no longer the same (`token`) or attaching fails -> the picture is discarded, the pool
  aborted, `gone: true`, the loop ends.
- Otherwise: attach, record (same rule for `enabled`), `await saveChat()`, then `onProgress({ done, total })`
  with `done` = pictures attached so far including the first.
- The save dialogs of `autoSaveDialog` never overlap, also across calls (one chain per run).
- Result: `attached` (pictures attached by this call), `failed` = `pool.failures.length`, `firstError` = the
  error of the first failure or `null`.

`discardPreparedImage` removes the pictures in `prepared.images` and aborts the pool.
`generateTestImage` is unchanged.

### 18.7 WIRING (lane B): new file `src/flow/tail.js`, changes in `src/flow/send-with-image.js`
```js
export function createTail({ bar, notify })     // bar: the object of createHold()
// -> { start(messageIndex, prepared, token), isActive(), cancel(), draw() }
```
- `start` does nothing when `prepared.total <= prepared.images.length`. Otherwise the tail becomes active,
  draws the bar and runs `attachRemainingImages` with its own `AbortController`; a `CHAT_CHANGED` event and
  `cancel()` abort it. Only one tail runs at a time (`start` while active is ignored with a console warning;
  the callers below prevent it).
- `draw()`: `bar.setStatus('Bilder: <done> von <total> fertig …', { onCancel: cancel, cancelLabel: 'Rest abbrechen' })`
  followed by `bar.setPrompt(prepared.preview)`. It is called on start and on every progress report.
- End of the run: the bar is cleared, the tail is inactive. `failed > 0` ->
  `notify.warning('<failed> von <total> Bildern fehlgeschlagen: <reason of firstError>')`. `gone` ->
  `notify.warning('Die Nachricht ist nicht mehr vorhanden.')`. An unexpected exception is logged and ends the
  tail the same way.

`send-with-image.js`:
- The bar belongs to the tail while it is active. The two controllers and `runForMessage` get a `hold`
  object that equals the bar except for `setStatus`: a call with `null`/`undefined` while the tail is active
  calls `tail.draw()` instead of clearing the bar.
- The tail starts after the first picture is attached, in all three paths: `processReply` of the hold
  controller and `runForMessage` (both from the result of `generateImageForMessage`), and `attachImage` of
  the parallel controller (a wrapper that still calls `attachPreparedImage` before its first `await`).
- An active tail counts as busy: `refuseWhileBusy()` and both `precheck` functions answer `MESSAGES.busy`.

### 18.8 Tests, README, version (lane A)
- New `tests/prompt/pictures.test.js`: `splitPictureLines` (plain lines, markdown and list decoration, wrapped
  lines, numbers out of order, empty pictures, text in front, `max`, no picture line), `assignPrompts` (the
  owner's examples 2 prompts on 16 jobs and 4 prompts on 16 jobs, 3 prompts on 16 jobs covers every prompt,
  more prompts than jobs, zero and garbage counts).
- New `tests/flow/image-pool.test.js`: never more than `limit` in flight, start order, `next()` in arrival
  order and queued results, `null` at the end, failures collected without stopping the rest, `abort()`
  (nothing new starts, queued and late results go to `discard`, pending `next()` resolves `null`, signal
  aborted), outer signal, already aborted signal, `discard` that throws.
- `tests/prompt/system-prompt.test.js` and `tests/prompt/prompt-preview.test.js` get cases for 18.3; existing
  cases change only where 18.3 changes the contract (the counted head line). `tests/settings/batch.test.js`
  follows the new limits. No test is deleted; the count does not drop (288 before).
- README: "Mehrere Bilder" item with the new limits, the wishes written as an out-of-character note, how the
  prompts are dealt out, pictures arriving one by one with the reply waiting only for the first, and that
  pictures of a run with wishes are not checked as references.
- Version `1.8.0` in `package.json`, `package-lock.json` (both places) and `manifest.json`.

### 18.9 Live test (orchestrator, neither lane)
SillyTavern test instance, chat model `deepseek-chat`, list `z-image-turbo` x5 and `hidream-o1-image-dev` x1,
own message with two wishes as an out-of-character note: the preview shows two prompts with the right counts
per model, never more than four image requests run at once, the reply appears with the first picture, the
others follow below it one by one, the six gallery records are tagged and unchecked.

## 19. A separate text model for the image prompt (version 1.9.0, **BINDING**)

Owner's request: choose in the settings a text model of its own that writes the image prompt, apart from the
model the chat runs on.

Decision: the text model comes from the same provider as the picture (NanoGPT or OpenRouter), is chosen from
that provider's list of text models and uses the key the extension already resolves. An empty choice keeps
today's behaviour (the chat model of the app writes the prompt). Read on 2026-11-13 without a key:
`GET https://nano-gpt.com/api/v1/models?detailed=true` (619 entries, `id`, `name`,
`architecture.output_modalities`) and `GET https://openrouter.ai/api/v1/models` (472 entries, same members).
Both providers answer `POST .../api/v1/chat/completions` in the OpenAI shape.

Cut into two steps because section 18 changes `build.js`, `generate-image.js` and `defaults.js` at the same
time: **lane C** builds 19.1, 19.2 and the view file of 19.4 now; 19.3, the panel slot, 19.5 and 19.6 follow
once section 18 is committed (**integration**).

### 19.1 PURE (lane C): `src/providers/nanogpt.js`, `src/providers/openrouter.js`
Both modules export in addition:
```js
export const TEXT_MODELS_URL    // nanogpt: 'https://nano-gpt.com/api/v1/models?detailed=true', openrouter: 'https://openrouter.ai/api/v1/models'
export const CHAT_URL           // 'https://nano-gpt.com/api/v1/chat/completions' / 'https://openrouter.ai/api/v1/chat/completions'
export function normalizeTextModels(json)                                   // -> [{ id, name }]
export async function listTextModels({ signal, fetchImpl } = {})
export function buildChatRequest({ model, systemPrompt, prompt, maxTokens })  // -> { url, body }
export async function generateText({ apiKey, model, systemPrompt, prompt, maxTokens, signal, fetchImpl })   // -> string
```
- `normalizeTextModels`: list from `json.data` or the array itself; an entry needs a string `id`; an entry whose
  `architecture.output_modalities` is an array without `'text'` is dropped (no such member: kept); `name` is the
  entry's non-empty `name`, else the id; sorted by name with `localeCompare`.
- `buildChatRequest`: body `{ model, messages, max_tokens, stream: false }` with a `system` message (left out
  when `systemPrompt` is empty) followed by the `user` message; `max_tokens` only when `maxTokens` is a positive
  number.
- `generateText`: no key -> the same `ProviderError` as `generateImage`. Request through `requestJson` with the
  bearer header and a 120 s timeout. The result is `choices[0].message.content`: a string as it is, an array of
  parts as the joined `text` members of its parts, anything else `''`. No retry, no streaming.
- What both modules share may live in `src/providers/http.js` (PURE); nothing existing changes its behaviour.

### 19.2 WIRING (lane C): `src/settings/model-cache.js`
```js
export async function getTextModels(providerId, { force = false } = {})
```
Same rules as `getModels` (memory, 7-day `localStorage`, one shared request, stale list on failure) with its
own storage key `bfqig_textmodels_v1_<providerId>` and its own memory maps. `getModels` and `getModelInfo` keep
their behaviour.

### 19.3 PURE (integration): `src/settings/defaults.js`
`DEFAULT_SETTINGS.textModels = { nanogpt: '', openrouter: '' }` (frozen); `normalizeSettings`:
`textModels: perProvider(src.textModels, (value) => toStr(value).trim())`. `''` means the chat model of the app.

### 19.4 UI: new file `src/settings/text-model-view.js` (lane C), slot in `src/settings/panel.js` (integration)
```js
export function createTextModelView()     // -> { element, refresh() }
```
It reads and writes `settings.textModels[settings.provider]` (a missing `textModels` object counts as empty
choices, so the file works before 19.3 lands) and lists `getTextModels(providerId)`.

| Element | Id / class | Notes |
|---|---|---|
| label | class `bfqig-label`, `for="bfqig-text-model"` | text `Textmodell für den Bildprompt` |
| filter | `input#bfqig-text-model-filter.text_pole`, `type="search"` | placeholder `Textmodell suchen …` |
| select | `select#bfqig-text-model.text_pole` | first option value `''`, text `Chat-Modell der App (Standard)`; then the models that match the filter (id or name, case ignored); the stored model always stays in the list, marked ` (nicht in der Liste)` when the loaded list lacks it |
| reload | `button#bfqig-text-model-refresh.menu_button.bfqig-icon-button` | icon `fa-solid fa-rotate`, `title`/`aria-label` `Textmodelle neu laden`; loads with `force` |
| note | `#bfqig-text-model-note`, class `bfqig-note` | texts below; `data-state="error"` for a load error |

| State | Note text |
|---|---|
| loading | `Textmodelle werden geladen …` |
| load failed | the error message |
| nothing chosen | `Der Bildprompt kommt vom Modell, mit dem du gerade chattest.` |
| a model chosen | `Der Bildprompt kommt von <provider label> mit diesem Modell und dem Key von oben. Dein Chat-Modell bleibt, wie es ist.` |

Filter and select share a row with the reload button like the image model picker (`bfqig-row`). `refresh()`
re-reads the provider and loads its list. Integration: `<div class="bfqig-text-model-slot"></div>` directly
after the row of the checkbox `#bfqig-use-llm`; `refresh()` on mount and on provider change.

### 19.5 WIRING (integration): `src/prompt/build.js`, `src/flow/generate-image.js`
`describeScene({ ..., textModel = null, signal })` with `textModel = { provider, apiKey, model }`. With it the
request goes to `textModel.provider.generateText({ apiKey, model, systemPrompt, prompt, maxTokens, signal })`
with the reply length of 18.5 as `maxTokens`; without it to the host as today. A failure or an empty answer
takes the existing path (`llmProblem`, warning, direct prompt). `prepareImage` passes `textModel` when
`settings.textModels[provider.id]` is not empty.

### 19.6 Tests, README, version
- Lane C: `tests/providers/text.test.js` (new): `normalizeTextModels` of both providers (data wrapper and bare
  array, entries without id, image-only entries, missing names, order), `buildChatRequest` (with and without
  system prompt and `maxTokens`), `generateText` with a fake `fetchImpl` (string content, parts content, empty
  content, error status with the provider's message, no key, the bearer header and the URL).
- Integration: defaults and normalisation of `textModels`; README item; version `1.9.0`.
- No test is deleted; the count does not drop. `npx eslint .` clean, no JS file above 400 lines.

### 19.7 Live test (orchestrator)
SillyTavern test instance: the chat stays on `deepseek-chat`; a text model of another family chosen in the
view writes the image prompt (the request to `chat/completions` carries it), the picture follows; with the
choice emptied the prompt comes from the chat model again.

## 20. Deleting in the chat also clears gallery and reference lists (fix, **BINDING**)

Owner's report: a picture deleted in the chat stays in the Galerie tab and in the Referenzen tab.

Reproduced on 2026-11-13 in the SillyTavern test instance: three pictures whose replies had been deleted with
`/del 1` still had gallery records with `enabled: true`, so they were still listed and still went along as
reference pictures. Cause: a record is removed only by the extension's own "Löschen"
(`deleteGeneratedImage`); the extension listens to none of the host's delete events (`grep` for
`MESSAGE_DELETED`, `MESSAGE_SWIPE_DELETED`, `MEDIA_ATTACHMENT_DELETED` under `src/` finds nothing).

Host facts (read in `script.js` and `scripts/chats.js` of SillyTavern 1.18 and TauriTavern 2.4.0):
- A message is deleted in place (`chat.splice(id, 1)` or `chat.length -= 1`, also by regenerate), then
  `MESSAGE_DELETED` fires with the new chat length only. The remaining message objects keep their identity.
- A swipe is deleted with `message.swipe_info.splice(swipeId, 1)`, then `MESSAGE_SWIPE_DELETED` fires with
  `{ messageId, swipeId, newSwipeId }`; at that moment `message.extra` may still hold the deleted swipe.
- The host's own picture delete removes the media entry and, when the owner leaves "Also delete files from
  server" ticked, deletes the file and fires `MEDIA_ATTACHMENT_DELETED` with the url.
- Neither host trims the `chat` array (TauriTavern virtualises rows, not the array).

Because the first two events arrive after the fact, the extension keeps a snapshot of which of its pictures
sit on which message and reads the loss from it. Only gallery records are removed (a generated reference
picture is its gallery record). Files are not touched: the host's picture delete has removed the file itself,
and a deleted message keeps its files like any message of the host does.

### 20.1 HOST: `src/host/chat.js`
```js
export function listChatMediaUrls()     // -> [{ message, swipes }]
```
One entry per message of the open chat, in chat order. `message` is the live message object. `swipes` is an
array with one array of urls per swipe: taken from `message.swipe_info[i].extra.media`, except that the entry at
`message.swipe_id` comes from the live `message.extra.media`; a message without `swipe_info` has exactly one
entry from `message.extra.media`. Only media entries with a non-empty string `url` count. Read-only: nothing
on the messages is changed. No chat open -> `[]`.

### 20.2 PURE: new file `src/gallery/chat-diff.js`
```js
export function normalizeUrl(url)                                   // leading slashes removed
export function takeSnapshot(entries, isOwn)                        // -> snapshot
export function goneAfterMessageDelete(snapshot, currentMessages)   // -> string[]
export function goneAfterSwipeDelete(snapshot, message, swipeId)    // -> string[]
```
- `takeSnapshot`: `entries` as returned by `listChatMediaUrls`, `isOwn(normalizedUrl)` says whether a url
  belongs to a gallery record. The snapshot keeps the messages in order and, per message and swipe, the own
  urls (normalised).
- `goneAfterMessageDelete`: plausible only when every message in `currentMessages` is in the snapshot (by
  identity) and there are fewer of them than in the snapshot; otherwise `[]` (a reloaded or replaced chat must
  never look like a delete). Result: the own urls of the snapshot messages that are no longer current, without
  those that a remaining message still carries on any swipe; each url once.
- `goneAfterSwipeDelete`: message not in the snapshot or `swipeId` no valid index of its swipes -> `[]`.
  Result: the urls of that swipe, without those that another swipe of the message or another message of the
  snapshot still carries; each url once.

### 20.3 WIRING: new file `src/gallery/chat-sync.js`, one line in `index.js`
```js
export function installChatSync()      // idempotent
```
- The snapshot is taken at install and renewed on `CHAT_CHANGED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`,
  `MESSAGE_SWIPED`, `GENERATION_ENDED`, on every gallery change (`onGalleryChange`) and on every `pointerdown`
  and `keydown` on `document` (capture phase), so it is never older than the action that causes a delete.
- `MESSAGE_DELETED`: `goneAfterMessageDelete(snapshot, current message objects)`.
  `MESSAGE_SWIPE_DELETED`: `goneAfterSwipeDelete(snapshot, getRawMessage(messageId), swipeId)`.
  `MEDIA_ATTACHMENT_DELETED`: that url when a gallery record has it.
- Every gone url loses its gallery record (`removeGalleryRecord` with the url as the record stores it). Then
  the snapshot is renewed. No file is deleted, no chat is saved, nothing is shown to the owner.
- An exception inside a handler is logged and never reaches the host.
- `index.js` calls `installChatSync()` right after `installChatImageMenu()`.

### 20.4 Tests
New `tests/gallery/chat-diff.test.js`: last message deleted; a message in the middle; several at once; a url
that a remaining message also carries stays; a current message the snapshot does not know -> `[]`; same number
of messages -> `[]`; urls that are not own never appear; a url with and without leading slash is one url;
swipe deleted with and without the same url on another swipe; unknown message and invalid swipe index.
No test is deleted; the count does not drop. `npx eslint .` clean.

### 20.5 Live test (orchestrator)
Test instance, no paid request: a reply with generated pictures is deleted with the host's own controls; its
records are gone from the Galerie and Referenzen tabs, records of other messages and of other chats stay, and
reloading the chat removes nothing.
