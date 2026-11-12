# Anime character likeness on NanoGPT (test case: Kyouko Hori / 堀京子, Horimiya)

Research date: 2026-11-12. Web research only: no NanoGPT image or chat call was made, no API key was used.

## Zusammenfassung (Deutsch)

Kernbefund: Kyouko Hori ist in den Trainingsdaten der Anime-Modelle kaum vorhanden. NoobAIs offizielle
Charakterliste führt `hori_kyouko` mit 165 Bildern, davon 43 solo (Hatsune Miku: 103.500) [S10]; Danbooru hat
heute 254 Posts [S9]; in WAIs eigener Charakterliste (5.093 Einträge) fehlt sie ganz [S11]. Mit Prompt-Text
allein ist deshalb nur „braunhaariges Schulmädchen" erreichbar, keine echte Ähnlichkeit.

Die fünf Änderungen mit der größten Wirkung, nach erwarteter Wirkung sortiert:

| # | Änderung | Warum | Stand |
|---|----------|-------|-------|
| 1 | **Charakter-LoRA nutzen**: Modell `anima/text-to-image-lora` mit `lora_url_1` (HTTPS-Link auf die `.safetensors`) und `lora_scale_1` (1.0). Passendes LoRA existiert: Civitai 2674903, Basis Anima, Gewicht 1.0 [S22]. | Ein LoRA liefert das Wissen nach, das dem Basismodell fehlt. Einziger Weg zu „sieht aus wie im Anime" ohne Referenzbild. | Feldnamen stehen auf NanoGPTs Modellseite [S8], nicht in der API-Doku: **unverified**, ein Testaufruf nötig. |
| 2 | **Referenzbild + Edit-Modell** (Nano Banana, Seedream, Qwen Image Edit, GPT Image, FLUX.2/3) über `input_references` statt img2img auf SDXL. | Diese Modelle übernehmen die Figur aus dem Bild in eine neue Szene; SDXL-img2img und Anima-„Variation" kopieren nur die Komposition (`strength`). | `input_references` ist dokumentiert [S4]. Wird gerade von der Haupt-Session getestet. |
| 3 | **Tag-Block korrigieren**: `1girl, solo, hori kyouko, hori-san to miyamura-kun, long hair, brown hair, swept bangs, brown eyes, grey sweater, collared shirt, black skirt` an den Anfang; `horimiya` weglassen. | `horimiya` ist auf Danbooru nur ein Alias mit 0 Posts [S9]; der trainierte Serien-Tag heißt `hori-san to miyamura-kun` [S10]. Ohne `solo` zieht der Charakter-Tag Miyamura mit ins Bild (54 % ihrer Posts) [S9]. | Vorlagen unten sind mit dem CLIP-Tokenizer nachgezählt und passen in 75 Tokens. |
| 4 | **CFG und Steps mitschicken**: CFG 5–6, 28 Steps. | NanoGPT nutzt laut Modellseite für WAI, Animagine 4.0 und die Pony-Modelle CFG 7.5 und 20 Steps [S8]; die Model-Cards empfehlen CFG 5 (Animagine), 5–7 (WAI), 5–6 (NoobAI) und 25–30 Steps [S12][S16][S17]. | Parametername für `POST /api/v1/images` nicht dokumentiert (`guidance_scale`/`num_inference_steps` oder `CFGScale`/`steps`): **unverified**. |
| 5 | **Modell wechseln**: Anima oder Nova Anime XL statt WAI/Pony. | Anima: Wissensstand September 2025, Tags plus Fließtext, kein CLIP-Fenster [S21]. Nova IL v14 ist ein NoobAI-Mix, und NoobAI listet ihren Trigger offiziell [S10][S18]. Pony: Score-Tags fressen 20–38 der 75 Tokens. | Modellzuordnung verifiziert; Wirkung auf die Ähnlichkeit **unverified**. |

Was nach heutiger Doku **nicht** geht: ein Negativ-Prompt für die SDXL-Anime-Modelle (kein Feld in der Doku, kein
Regler auf den Modellseiten, kein Eintrag in `supported_parameters`) und ein dokumentierter Weg, ein Civitai-LoRA
an ein SDXL-Modell zu hängen.

---

Everything below is in English.

## How to read the status marks

| Mark | Meaning |
|------|---------|
| verified | Read directly from the primary source by this session on 2026-11-12 (file download or page read). |
| via agent | Fetched from the primary URL by a web-fetch sub-agent; exact values not re-read by me. Danbooru answers a plain `curl` with a Cloudflare challenge, so its numbers could not be double-checked. |
| counted | Token count computed locally with the official CLIP ViT-L/14 tokenizer file [S26]. |
| unverified | Not confirmed on a primary source. Treat as a hypothesis. |

## 1. Character tag facts

| Fact | Value | Status | Source |
|------|-------|--------|--------|
| Character tag | `hori_kyouko` (category character), other name 堀京子 | via agent | [S9] |
| Post count (Danbooru, 2026-11-12) | 254 | via agent | [S9] |
| Series tag | `hori-san_to_miyamura-kun`, 576 posts | via agent | [S9] |
| `horimiya` | Alias of `hori-san_to_miyamura-kun` since 2013, 0 posts of its own | via agent | [S9] |
| Count in NoobAI's training-time list | 165 posts, 43 solo; copyright `hori-san_to_miyamura-kun` | verified | [S10] |
| NoobAI official trigger | `hori kyouko, hori-san to miyamura-kun` | verified | [S10] |
| NoobAI core tags | `1girl, orange eyes, brown eyes, brown hair, long hair, katagiri senior high school uniform, school uniform` | verified | [S10] |
| In WAI's character list (v16, 5,093 rows; WAI-Anima, 4,963 rows) | Not present (no Horimiya character at all; the only "hori" is `hori yuko`) | verified | [S11] |
| Uniform tag | `katagiri_senior_high_school_uniform`, 216 posts | via agent | [S9] |
| Wiki description | Long brown hair with an ahoge, brown eyes, small breasts; usually in the Katagiri uniform or a white hoodie | via agent (paraphrased) | [S9] |
| Costume variants or aliases of the character tag | None | via agent | [S9] |

Tags that co-occur with `hori_kyouko` on Danbooru (share of her 254 posts, via agent, [S9]):

| Group | Tags |
|-------|------|
| Her look | `brown_hair` 93 %, `long_hair` 80 %, `school_uniform` 52 %, `katagiri_senior_high_school_uniform` 44 %, `collared_shirt` 43 %, `orange_eyes` 35 %, `brown_eyes` 33 %, `sweater` 26 %, `grey_sweater` 19 %, `black_skirt` 16 %, `cardigan` 15 %, `pleated_skirt` 15 %, `blazer` 15 %, `ahoge` 11 %, `bow` 10 %, `ponytail` 10 % |
| Contamination from Miyamura (`miyamura_izumi` is in 54 % of her posts) | `black_hair` 49 %, `1boy` 46 %, `short_hair` 41 %, `blue_eyes` 36 %, `necktie` 18 %, `glasses` 13 % |
| Solo share | `solo` only 33 % |

Canonical look as the LoRA authors tag it (three independent authors agree unless noted, verified against their Civitai pages [S22]):

| Item | Tags | Note |
|------|------|------|
| Hair | `long hair, brown hair, swept bangs, hair between eyes`, optional `sidelocks` | `ponytail` only when wanted |
| Eyes | `brown eyes` | Danbooru taggers split between `orange_eyes` and `brown_eyes` |
| Uniform, sweater | `grey sweater, white shirt, collared shirt, black skirt, pleated skirt` | |
| Uniform, winter | add `black jacket, open jacket` or `black blazer` | |
| Uniform, summer | `short sleeves, white shirt, collared shirt, black skirt, pleated skirt` | one author |
| Uniform, vest | `grey sweater vest, sleeves rolled up` | two authors |
| Bow | `red bowtie` | one author only (novowels); colour **unverified** against official art |
| Legs, shoes | `black socks, kneehighs, loafers` | one author |
| Cardigan colour | not established | **unverified** |

Tags to add: `1girl, solo`, the hair and eye tags above, concrete clothing tags.
Tags to avoid: `horimiya` as the series tag on Danbooru-tag models, `1boy`, `black hair`, `blue eyes`, `short hair`,
`glasses` (all Miyamura), `ponytail` unless intended, `blazer` together with `cardigan`. The uniform tag
`katagiri senior high school uniform` costs 8 tokens for a tag with 216 posts; concrete clothing tags are the
better use of the budget (my inference, **unverified**).

## 2. Prompt format per model family

### 2.0 Which NanoGPT id is which model

NanoGPT ids do not always name the model they serve. The mapping below is verified from the descriptions in the
NanoGPT model list [S1] and the matching Civitai records [S17]–[S20].

| NanoGPT id | Real model | Family | Route |
|------------|-----------|--------|-------|
| `wai-illustrious-sdxl` | WAI-illustrious-SDXL (Civitai 827184; served version not stated) | Illustrious | Runware |
| `persona:376130@2456367` | Nova Anime XL IL v14.0; the author's version note names NoobAI EPS v1.1 and Illustrious v2.0-stable as its parts | Illustrious / NoobAI mix | Runware |
| `crystal-clear-xl` | ZUKI anime ILL "best" (Civitai 949488, version 1581052) | Illustrious | Runware |
| `nsfw-gen-illustrious` | Animagine XL 4.0 (Civitai 1188071@1408658) | Animagine | Runware |
| `2dn-pony-v2` | 2DN Pony-v2 (Civitai 520661@933040; the model page is gone, the version record remains) | Pony | Runware |
| `infinite-illustrious` | Prefect Pony XL v4.0 (Civitai 439889@1047139) | Pony | Runware |
| `animagine-xl-31` | Crystal Clear XL (Civitai 122822@133832), not Animagine 3.1 | SDXL | Runware |
| `anima/text-to-image`, `anima/text-to-image-lora` | Anima (CircleStone Labs); variant Base, Aesthetic or Turbo not stated | Anima (Cosmos-Predict2 2B) | WaveSpeed |
| `custom-civitai` | Any Civitai checkpoint NanoGPT has confirmed | varies | Runware |

No NanoGPT model id or name contains "noob"; plain NoobAI-XL is not listed [S1]. The Runware and WaveSpeed routing
is read from NanoGPT's public model page URLs (`/models/image/wavespeed-ai/anima/...`) and its public web bundle
(provider map), not from the API docs.

All SDXL templates below share one core block (38 CLIP tokens, counted):

```
hori kyouko, hori-san to miyamura-kun, long hair, brown hair, swept bangs, brown eyes, grey sweater, collared shirt, black skirt
```

`{scene}` is the part the chat model writes. The scene budget is what remains of 75 tokens after the fixed part.
Example scene used for counting: `sitting, cafe, indoors, smile, looking at viewer, upper body` (14 tokens).

### 2.1 Illustrious XL, WAI-illustrious-SDXL, ZUKI anime ILL

| Item | Value | Status | Source |
|------|-------|--------|--------|
| Template | `1girl, solo, hori kyouko, hori-san to miyamura-kun, long hair, brown hair, swept bangs, brown eyes, grey sweater, collared shirt, black skirt, {scene}, masterpiece, best quality` | fixed part 48 tokens, scene budget 26 (counted) | |
| Structure used in training | person count, character names, rating, general tags, artist, score-range rating, year modifier | verified | [S15] |
| Tag style | Danbooru tags, lowercase, spaces, comma separated (card examples) | verified | [S13] |
| Natural language | The report says v0.1 struggles with natural-language prompts, longer ones in particular; v1.0 and later claim tag plus natural language | verified | [S15][S14] |
| Quality tags | Illustrious: `masterpiece`, `best quality`, `good quality`, `average quality`, `bad quality`, `worst quality`. WAI: `masterpiece,best quality,amazing quality` | verified | [S13][S17] |
| Rating tags (WAI) | `general`, `sensitive`, `nsfw`, `explicit` | verified | [S17] |
| Negative prompt | Illustrious card sample: `worst quality, comic, multiple views, bad quality, low quality, lowres, displeasing, very displeasing, bad anatomy, bad hands, scan artifacts, monochrome, greyscale, signature, twitter username, jpeg artifacts, 2koma, 4koma, guro, extra digits, fewer digits`. WAI: `bad quality,worst quality,worst detail,sketch,censor,` | verified | [S13][S17] |
| Sampler, steps, CFG | Illustrious: Euler a, 20–28 steps, CFG 5–7.5. WAI v17: Euler a, 15–30 steps, CFG 5–7. ZUKI: CFG 5–6, hires fix advised | verified | [S13][S17][S20] |
| Resolution | WAI: larger than 1024x1024, samples at 1024x1344. Illustrious v1.0: native up to 1536x1536 | verified | [S17][S14] |
| Parentheses | Not addressed by the cards. WAI's own tip `(aged up:1.0–2.0)` is A1111 weight syntax; in such front ends literal parentheses in tags are written `\(` `\)` | card silent; escaping rule **unverified** for NanoGPT | [S17] |
| WAI author's warning | Too many quality tags or long negative prompts reduce quality and blur the image | verified | [S17] |

### 2.2 Nova Anime XL (IL v14) and NoobAI-XL

| Item | Value | Status | Source |
|------|-------|--------|--------|
| Template (Nova) | `masterpiece, best quality, newest, 1girl, solo, hori kyouko, hori-san to miyamura-kun, long hair, brown hair, swept bangs, brown eyes, grey sweater, collared shirt, black skirt, {scene}` | fixed 50, scene budget 24 (counted) | |
| Template (NoobAI card prefix) | `masterpiece, best quality, newest, absurdres, safe, 1girl, solo, ` + core block + `, {scene}` | fixed 55, scene budget 19 (counted) | |
| NoobAI caption order | `<1girl/1boy/1other/...>, <character>, <series>, <artists>, <special tags>, <general tags>, <other tags>` | verified | [S16] |
| NoobAI prefix | `masterpiece, best quality, newest, absurdres, highres, safe,` | verified | [S16] |
| NoobAI negative | `nsfw, worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro` | verified | [S16] |
| NoobAI quality and date tags | `masterpiece`, `best quality`, `good quality`, `normal quality`, `worst quality`; `newest` (2021–2024), `recent`, `mid`, `early`, `old` | verified | [S16] |
| NoobAI settings | Euler a, CFG 5–6, 25–30 steps, about 1024x1024 area, best 832x1216 | verified | [S16] |
| Nova settings (Illustrious branch) | Euler a, 20–30 steps, CFG 4–6, clip skip 1–2 | verified | [S18] |
| Nova author's prompt | `masterpiece, best quality, amazing quality, 4k, very aesthetic, high resolution, ultra-detailed, absurdres, newest, scenery, {Prompt}, BREAK, depth of field, volumetric lighting` | verified; this prefix alone is 28 tokens (counted), do not use it inside a 75-token window | [S18] |
| NanoGPT defaults for Nova | CFG 6 (page recommends 4.5–6), 30 steps (page recommends 20–30), offers 832x1216 and 1216x832 | verified | [S8] |
| Tag style | lowercase, spaces (the official trigger list writes `hori kyouko, hori-san to miyamura-kun`) | verified | [S10] |
| Parentheses | Not addressed | **unverified** | |

### 2.3 Animagine XL 4.0 (`nsfw-gen-illustrious`)

| Item | Value | Status | Source |
|------|-------|--------|--------|
| Template | `1girl, hori kyouko, hori-san to miyamura-kun, safe, solo, long hair, brown hair, swept bangs, brown eyes, grey sweater, collared shirt, black skirt, {scene}, masterpiece, high score, great score, absurdres` | fixed 56, scene budget 18 (counted). The quality tags sit at the end, so an over-long scene cuts them off first | |
| Prescribed order | `1girl/1boy/1other, character name, from which series, rating, everything else in any order and end with quality enhancement` | verified | [S12] |
| Quality tags | End of prompt: `masterpiece, high score, great score, absurdres` | verified | [S12] |
| Score tags | `high score`, `great score`, `good score`, `average score`, `bad score`, `low score` | verified | [S12] |
| Rating tags | `safe`, `sensitive`, `nsfw`, `explicit` | verified | [S12] |
| Year tags | `year 2005` … `year 2025` | verified | [S12] |
| Negative prompt | `lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry` | verified | [S12] |
| Settings | Euler a, CFG 4–7 (5 recommended), 25–28 steps (28 recommended) | verified | [S12] |
| Resolution | 1024x1024, 832x1216, 896x1152, 768x1344 and landscape mirrors; higher resolutions may degrade | verified | [S12] |
| Tag style | Spaces; the card escapes parentheses in its own examples: `firefly \(honkai: star rail\)` | verified | [S12] |
| Natural language | Listed under limitations: tag prompts only, natural language is not expected to work well | verified | [S12] |
| Does it know her | The card lists no characters; knowledge cut-off 2025-01-07. Whether her name tag was in the 8.4M-image set is **unverified** | | [S12] |

### 2.4 Pony Diffusion V6 based (`2dn-pony-v2`, `infinite-illustrious`)

| Item | Value | Status | Source |
|------|-------|--------|--------|
| Template | `score_9, score_8_up, score_7_up, source_anime, 1girl, solo, hori kyouko, horimiya, long hair, brown hair, swept bangs, brown eyes, grey sweater, black skirt, {scene}` | fixed 52, scene budget 22 (counted) | |
| Official quality string | `score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up` then the description; the card says `score_9` alone works but is much weaker | verified | [S19] |
| Cost of the official string | With `source_anime` it is 38 of 75 tokens (counted); the template above uses a 20-token short form, which the card says is weaker | counted | [S19] |
| Source and rating tags | `source_pony`, `source_furry`, `source_cartoon`, `source_anime`; `rating_safe`, `rating_questionable`, `rating_explicit` | verified | [S19] |
| Tag style | Score, source and rating tags use underscores; the rest is free text or tags. The model was trained on captions and tags | verified | [S19] |
| Negative prompt | Designed to need none | verified | [S19] |
| Settings | Euler a, 25 steps, 1024 px; **clip skip 2 is required**, the card warns of unusable output without it | verified | [S19] |
| Prefect Pony XL | Author used clip skip 2 on every sample | verified | [S20] |
| Which name Pony V6 learned for her | Not documented. Pony LoRA authors trigger on `kyouko hori`. Without a LoRA expect a generic brown-haired girl | **unverified** | [S22] |
| Clip skip on NanoGPT | No control exposed; whether the route sets it is **unverified** | | [S8] |

### 2.5 Anima (`anima/text-to-image`, `anima/text-to-image-lora`)

| Item | Value | Status | Source |
|------|-------|--------|--------|
| Template (tags) | `masterpiece, best quality, score_7, safe, anime screenshot, 1girl, solo, hori kyouko, hori-san to miyamura-kun, long hair, brown hair, swept bangs, hair between eyes, brown eyes, grey sweater, white shirt, collared shirt, black skirt, pleated skirt, {scene}` | built from the card's tag order | [S21] |
| Template (natural language) | `masterpiece, best quality, safe, anime screenshot. Kyouko Hori from Horimiya, a high school girl with long straight brown hair, swept bangs and brown eyes, wearing a grey sweater over a white collared shirt and a black pleated skirt, {scene as one or two sentences}` | follows the card's rule to name the character first and then describe the basic appearance | [S21] |
| Tag order | `[quality/meta/year/safety tags] [1girl/1boy/1other etc] [character] [series] [artist] [general tags]` | verified | [S21] |
| Tag style | Lowercase, spaces instead of underscores; only score tags keep underscores. Where Danbooru and Gelbooru differ, use the Gelbooru form | verified. Her Gelbooru tags could not be read (API answers 401), so the series tag is **unverified** for Anima | [S21] |
| Natural language | Supported; use normal capitalisation for names, at least two sentences, tags and text may be mixed | verified | [S21] |
| Positive prefix | `masterpiece, best quality, score_7, safe,` | verified | [S21] |
| Negative prompt | `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration` | verified | [S21] |
| Aesthetic variant | Skip `score_*` tags in both prompts | verified | [S21] |
| Meta tags | `highres`, `absurdres`, `anime screenshot`, `official art`; year tags `year 2025`, period tags `newest`, `recent` | verified | [S21] |
| Artist tags | Must be prefixed with `@` | verified | [S21] |
| Weighting | Works but needs higher weights than SDXL, for example `(chibi:2)` | verified for ComfyUI; **unverified** on NanoGPT | [S21] |
| Settings | 30–50 steps, CFG 4–5; Turbo: CFG 1, 8–12 steps; samplers `er_sde`, `euler_a`; 512² to 1536² | verified | [S21] |
| Text encoder | Qwen (`qwen_3_06b_base`), not CLIP, so the 75-token window is not expected here | card lists the encoder; the consequence is my inference, **unverified** | [S21] |
| Knowledge cut-off | September 2025 for the anime data | verified | [S21] |
| What NanoGPT exposes | `aspect_ratio`, `resolution` (1k, 1.5k), `seed`, `nImages`, `strength` for an uploaded image; LoRA model adds `lora_url_1..3`, `lora_scale_1..3`. No steps, CFG, sampler or negative prompt | verified on the model pages | [S8] |

## 3. NanoGPT request parameters

Endpoint used by the extension: `POST https://nano-gpt.com/api/v1/images`.

| Parameter | Documented for | Status | Source |
|-----------|----------------|--------|--------|
| `model`, `prompt` | `/api/v1/images` | documented | [S4] |
| `n` (normalised to `nImages`; `nImages` wins if both are sent) | `/api/v1/images` | documented | [S4] |
| `resolution`, `aspect_ratio` | `/api/v1/images`, where the model supports it | documented | [S4] |
| `quality`, `output_format`, `background` | `/api/v1/images`, model specific (GPT Image family) | documented | [S3][S4] |
| `seed` | `/api/v1/images`: "model-specific" hint, identical results not guaranteed | documented. Listed in `supported_parameters` for only 3 of 263 models, none of them an anime SDXL model; the SDXL model pages do show a Seed control | [S4][S1][S8] |
| `input_references` (https URL, data URL, or `{type:"image_url",image_url:{url}}`) | `/api/v1/images` | documented | [S4] |
| `imageDataUrl`, `imageDataUrls`, `image_url`, `images` | Legacy aliases; mixing them with `input_references` returns `conflicting_image_inputs` | documented | [S3][S4] |
| `imageDataUrl`, `imageDataUrls`, `maskDataUrl` | `/v1/images/generations` and `/v1/images/edits` (base64 data URLs, no direct URL) | documented | [S5][S6] |
| `strength` (0–1, default 0.8; lower stays closer to the input) | `/v1/images/generations` only | documented there; **unverified** on `/api/v1/images`. Shown as a control on the Anima and Custom CivitAI model pages | [S5][S7][S8] |
| `guidance_scale` (0–20, default 7.5) | `/v1/images/generations` only, "model-specific" | documented there; **unverified** on `/api/v1/images` | [S5][S7] |
| `num_inference_steps` (1–100, default 30) | `/v1/images/generations` only, "model-specific" | documented there; **unverified** on `/api/v1/images` | [S5][S7] |
| `CFGScale`, `steps` | Control keys on the public model pages of the Runware-routed SDXL models (defaults 7.5 and 20; Nova 6 and 30) | seen on model pages; **unverified** as API fields | [S8] |
| `scheduler` | Control key on the Custom CivitAI page only (optional sampler or scheduler name) | seen on model page; **unverified** as API field | [S8] |
| `negative_prompt` | Only in the OpenAPI component `ImageGenerationRequest`, which no path references (legacy `/api/generate-image`; its doc page returns 404). `supported_parameters.negative_prompt` exists for 2 of 263 models (`moss-image` true, `kitani/morgana-v1.2` false) | **unverified** for every anime model; no control on their model pages, no image negative-prompt field in the public web bundle | [S7][S1][S8] |
| `num_steps`, `scale`, `sampler_name`, `width`, `height` | Same unbound legacy schema | **unverified** | [S7] |
| `lora_url_1..3`, `lora_scale_1..3` | Control keys on the Anima LoRA model page (an HTTPS URL to a compatible LoRA weights file, strength default 1). `supported_parameters.loras` with `url_fields: [lora_url_1, lora_url_2, lora_url_3]` and item `{path, scale}` is published for `minimax-h3/*` only | seen on model page; not in the API docs; **unverified** for Anima through the API | [S8][S1] |
| LoRA or checkpoint selection for `custom-civitai` | Not in the docs. The page's own "API example" is `{model:"custom-civitai", prompt, size, response_format}` with no Civitai field | **unverified** | [S8] |
| `kontext_max_mode` | `/v1/images/generations`, Flux Kontext | documented | [S5] |
| `stream`, `provider` | Rejected (`unsupported_stream`, `unsupported_provider_options`) | documented | [S3] |
| `allowed_passthrough_parameters` | Empty array on every endpoint checked; the docs say it is empty for now | verified | [S2][S3] |
| Behaviour for a parameter the model does not support | Not documented (ignored or rejected) | **unverified** | [S3] |

Per-model facts from the public model list and endpoints (verified, [S1][S2]):

| Model group | `max_prompt_characters` | Sizes | Input images | Other |
|-------------|------------------------|-------|--------------|-------|
| Runware SDXL anime models | 3000 (UTF-16 code units) | `1024x1024`, `768x1024`, `1024x768`, `1024x1408`, `1408x1024`, `1088x1920`, `1920x1088`, `512x512`, `2048x2048`; Nova also `832x1216`, `1216x832` | 1 | `image_to_image: true`, `nsfw: true` |
| `custom-civitai` | 3000 | `1024x1024`, `1024x768`, `768x1024`, `512x512`, `1920x1088`, `1088x1920` | 1 | up to 4 images |
| `anima/*` | unknown | `1k`, `1.5k` plus 15 aspect ratios | 1 | `nsfw: false`, up to 4 images |

The character limit of 3000 does not protect against the token window: 3000 characters are several hundred tokens.

## 4. LoRAs

### 4.1 How a LoRA is passed

| Route | Finding | Status | Source |
|-------|---------|--------|--------|
| `anima/text-to-image-lora` | Model page lists `lora_url_1..3` (an HTTPS URL to a LoRA weights file) and `lora_scale_1..3` (default 1); the description promises up to three character or style LoRAs. Price 0.015 USD (1k) against 0.01 USD for plain Anima | page verified; API use **unverified** | [S8][S1] |
| WaveSpeed (the provider behind Anima) | LoRA item is `{path, scale}`; `path` is a URL or a Hugging Face `owner/name`; Civitai needs the direct file URL; only `.safetensors`; scale range 0.0–4.0, 0.8–1.0 advised | via agent | [S23] |
| Civitai file URL | Form `https://civitai.com/api/download/models/<versionId>`. Whether the provider can fetch it without a Civitai login token is **unverified**; a public mirror of the same file avoids the question (check the LoRA's licence first) | **unverified** | |
| `custom-civitai` | The description says checkpoint and LoRA routes are checked before generation, but no request field is published | **unverified** | [S8] |
| Runware (the provider behind the SDXL models) | Its own API takes `lora: [{model: "<AIR>", weight}]` and checkpoints as AIR ids such as `civitai:102438@133677`; LoRAs are architecture specific and a mismatch returns an error | verified for Runware; NanoGPT does not expose it | [S24] |
| Other `*-lora` models in the list (`flux-2-*-lora`, `qwen-image-2.1/*-lora`, `z-image-turbo-lora`, `krea-v2/turbo-lora`, `pruna-ai/p-image/*-lora`) | Not anime bases; an Illustrious, Pony or Anima LoRA does not fit them | verified list; fit is architecture logic | [S1] |

### 4.2 Kyouko Hori character LoRAs on Civitai

All rows verified from the Civitai API on 2026-11-12 [S22]. URL pattern: `https://civitai.com/models/<id>`.

| Civitai id | Author | Base | Version id | Trigger words | Weight | Downloads |
|-----------|--------|------|-----------|---------------|--------|-----------|
| 2674903 | nochekaiser881 | **Anima** | 3003463 | `kyouko hori, hori kyouko, long hair, bangs, brown hair, hair between eyes, brown eyes, mature female, small breasts, anime screencap`; outfit `shirt, jacket, collared shirt, blazer, sweater, grey sweater, white shirt, black blazer, skirt, black skirt` | 1.0 | 423 |
| 2796812 | makimakimakima12138 | **Anima** | 3152462 | `hori kyoko12138, brown hair, long hair, brown eyes` | not stated | 80 |
| 1125133 | Player1ready | Illustrious | 1264622 | `hori kyouko, long hair, brown hair, swept bangs, hair between eyes` plus one of four outfit strings (see section 1) | not stated | 1890 |
| 1906012 | Kenjo | Illustrious | 2157359 | `KJOkyouko, brown hair, brown eyes, hair between eyes, long hair,` (hairstyle variants listed) | not stated; ADetailer advised | 899 |
| 2387215 | nochekaiser881 | Illustrious | 2684322 | `kyouko hori, long hair, bangs, brown hair, hair between eyes, brown eyes, mature female, small breasts, anime screencap` plus the outfit string above | 1.0 | 639 |
| 1473203 | Knistari | Illustrious | 1666337 | `KyoukoH, 1girl, solo, brown eyes, brown hair,` plus outfit tags (5 costumes) | not stated | 383 |
| 2279941 | eft | Illustrious | 2566061 | `kyouko hori` | 0.8 or higher for the anime-screencap look | 268 |
| 2068025 | vgt13 | Illustrious (2.0, tested on WAI v15) | 2340085 | `hm-hori, brown hair, brown eyes, sidelocks, bangs, hair between eyes,` | 0.6–0.9 | 240 |
| 471209 | nochekaiser881 | Pony | 524214 | `kyouko hori, long hair, bangs, brown hair, hair between eyes, brown eyes,` plus outfit string | 1.0 | 1068 |
| 741261 | novowels | Pony | 828947 | `kyouhri, brown hair, long hair, brown eyes` (all required); blazer outfit `black blazer, grey sweater, red bowtie, black pleated skirt` | 0.8–1.0 | 454 |
| 793978 | vgt13 | Pony | 887810 | `hm-hori` plus hair and clothing tags | 0.7–0.9 | 450 |
| 694700 | ethensia | Pony | 777435 | `kyouko hori,long hair,bangs, school uniform,hair between eyes,smile` | not stated | 389 |

No NoobAI-tagged Kyouko Hori LoRA appeared in three Civitai searches (`hori kyouko`, `Kyouko Hori`, `horimiya`,
first 60 results each). Illustrious LoRAs are commonly used on NoobAI-based merges (**unverified** here).

### 4.3 Would NanoGPT accept them

| LoRA | Verdict | Status |
|------|---------|--------|
| Anima LoRA 2674903 on `anima/text-to-image-lora` | Base matches, file is a single `.safetensors` of about 88 MB, the page asks for exactly an HTTPS URL to such a file. Most likely yes | **unverified** until one call is made |
| Illustrious or Pony LoRAs on the SDXL model ids | No LoRA control on those model pages and no documented field | **unverified**, assume no |
| Illustrious LoRA through `custom-civitai` | The description mentions LoRA routes; the request format is unpublished | **unverified** |

Trigger words must be copied exactly as the author wrote them, including name order: the Anima LoRA wants
`kyouko hori, hori kyouko`, Player1ready's wants `hori kyouko`.

## 5. Reference images

### 5.1 What NanoGPT offers

| Mechanism | Models | What it does | Status | Source |
|-----------|--------|--------------|--------|--------|
| `strength` image-to-image | Runware SDXL models, `custom-civitai` (page: strength applies only with a seed image, default 0.8) | Repaints the uploaded image; composition and pose come from the input | verified page text | [S8] |
| Prompt-guided variation of one uploaded image | `anima/*` (page: strength sets how strongly the upload is repainted, default 0.8; the source aspect ratio is kept) | Same idea: a variation of the input, not a new scene | verified page text | [S8][S1] |
| Reference or edit models via `input_references` | See the next table | The model reads the reference and draws a new image | documented field | [S4] |

Reference-capable models in the public list on 2026-11-12 (max reference images, lowest listed price per image,
verified [S1]):

| Family | NanoGPT ids (references, USD) |
|--------|-------------------------------|
| Nano Banana | `nano-banana-2-lite` (14, 0.040), `nano-banana-2-fast` (14, 0.045), `nano-banana-2.1` (14, 0.060), `nano-banana-2` (14, 0.080), `nano-banana-pro` (10, 0.140), `nano-banana` (4, 0.039) |
| Seedream | `bytedance/seedream-v5.5` (10, 0.020), `seedream-v4` (10, 0.030), `seedream-v5.0-lite` (10, 0.035), `seedream-v4.5` (10, 0.040, nsfw flag true) |
| Qwen | `qwen-image-2.1/edit` (10, 0.030), `qwen-edit-uncensored` (3, 0.040, nsfw flag true), `qwen-image-max-edit` (6, 0.070) |
| FLUX | `blackforestlabs/flux-3/klein/edit-image` (10, 0.008), `flux-2-klein-9b` (3, 0.010), `flux-2-flash` (4, 0.025), `black-forest-labs/flux-3/edit` (10, 0.050); `flux-kontext` has a model page with `guidance_scale` default 3.5 |
| GPT Image | `gpt-image-2` (4, 0.052), `gpt-image-2.6-flare` (16, 0.090), `openai/gpt-image-2.5/flare/edit` (16, 0.179) |

A LoRA plus reference route also exists: `qwen-image-2.1/edit-lora` (10 references, 3 LoRAs), but there is no
Kyouko Hori LoRA for Qwen on Civitai in the searches above.

### 5.2 Vendor guidance and user reports

Everything in this subsection was collected by a research sub-agent from the URLs given and was not re-read by
me: status **via agent** throughout. Reddit could not be searched or fetched, so the user reports come from other
forums. Example prompts are adaptations, not vendor text.

| Family | Vendor claim | Prompt pattern the vendor recommends | Knobs | Limits | Sources |
|--------|--------------|--------------------------------------|-------|--------|---------|
| Nano Banana (Gemini image models) | Character consistency from references is an advertised feature: up to 14 references, of which up to 4 character images (Nano Banana 2 / 2.1) or 5 (Pro); the first-generation model works best with at most 3 inputs | Describe the details that must survive (face, hair, outfit) and state that they stay unchanged; feed earlier results back in on follow-ups | No strength knob | Vendor: Pro does not always hold the character and is weak on small faces. User report: references ignored in roughly 10–20 % of runs, an identical retry helps. Third party: strictest of the five about copyrighted characters | [S27][S28][S29][S30] |
| Seedream 4.0 / 4.5 / 5.x | Product page says facial features, lighting and colour tone of the reference are kept | Address images by number, say per image what to take from it, avoid vague pronouns, stress what stays unchanged | Up to 14 references (4.0, 4.5, 5.0 lite) or 10 (5.0 pro/flash, 5.5); 30 MB and 36 MP per image; prompt up to 600 English words. No reference-strength knob found | None stated by the vendor. Third party: more permissive with anime styles | [S31][S32][S30] |
| Qwen-Image-Edit 2509 / 2511 | 2511 card claims clearly better character consistency and less image drift; 2509 claims better face identity across pose changes, best with 1–3 inputs | No dedicated guide; the card's examples simply describe the target scene (**unverified** as a recommendation) | Card example: `true_cfg_scale=4.0`, `guidance_scale=1.0`, 40 steps | User report: a full-body pose change broke a black-and-white manga style, coloured anime style stayed stable. User report: identity drift with 3 references at CFG 2.7, better at CFG 1.4–1.6 | [S33][S34][S35][S36] |
| FLUX.1 Kontext, FLUX.2, FLUX.3 | Kontext: identity is kept across scenes and repeated edits. FLUX.2: keeps face, clothing, proportions and style through multi-reference | Kontext: describe the subject instead of using pronouns, name the features to keep, say "change" or "replace" rather than "transform" (confirmed only through the ComfyUI docs, the BFL guide URL returned 404). FLUX.2/3: address images by position and assign roles | Kontext dev example `guidance_scale=2.5`; Kontext API takes one input image (20 MB / 20 MP) and has no guidance parameter; FLUX.2 up to 8 references through the API | BFL paper: artefacts after about 6 chained edits, occasional identity loss. Third party: Kontext Pro often shows artefacts around the face | [S37][S38][S39][S40][S41][S42] |
| GPT Image | Cookbook claims robust face and identity preservation for edits | Refer to images by index and description, list the invariants and repeat them on every iteration | `input_fidelity`: `low` (default) or `high`; `high` matches style and facial features of the inputs more closely and costs more tokens; the first image keeps the most detail, so put the character first; up to 16 inputs. Whether NanoGPT forwards `input_fidelity` is **unverified** | User report: gpt-image-1 blocks pop-culture characters with `moderation_blocked`. Third party: gpt-image-1 often changes identity and adds a yellow tint | [S43][S44][S45][S46][S42] |
| SDXL img2img | none | not applicable | `strength` sets how closely the output resembles the input image; at 1.0 the input is practically ignored | One knob couples composition, pose and identity, so "same character, new scene" is not reachable (inference from the definition). The SDXL-side technique for identity from an image is IP-Adapter, which NanoGPT does not expose | [S47][S48] |

Example prompts for "official art of the character as reference, same girl sitting in a cafe" (adapted, **unverified** in effect):

| Family | Prompt |
|--------|--------|
| Nano Banana | `Using the provided image of the anime schoolgirl with brown hair, create a new scene: she sits at a window table in a cozy cafe. Keep her face, hairstyle, uniform and the original anime art style completely unchanged.` |
| Seedream | `Refer to the character in image 1: the same brown-haired schoolgirl sits at a cafe table with a cup of tea. Keep her face, hairstyle, uniform and the anime art style unchanged.` |
| Qwen Image Edit | `The brown-haired schoolgirl from the image is sitting at a table in a cozy cafe, holding a teacup. Keep her face, hairstyle, school uniform and the anime art style unchanged.` |
| FLUX Kontext / FLUX.2 | `Place the brown-haired schoolgirl at a table in a cozy cafe with a cup of tea, while maintaining the same facial features, hairstyle, school uniform and anime art style.` |
| GPT Image | `Image 1: character reference. Show the same brown-haired schoolgirl sitting in a cafe. Character appearance must remain unchanged: same face, hairstyle, uniform, proportions, color palette and anime art style.` |

Practical tips from user reports (via agent):

| Tip | Source |
|-----|--------|
| For a different camera distance start again from the original reference; do not chain edits | [S49] |
| Name the role of each reference in the prompt, crop references tightly, simplify their background | [S36] |
| Qwen: small changes keep the style; after a large pose change restore the style in a later step | [S35] |
| Nano Banana: plan one retry for runs that ignore the reference | [S29] |

Consequences for this extension (my reading, **unverified** until the main session's test is in): send one clean
front-facing official image through `input_references`, write the prompt as "same character, new scene, keep
face, hair, outfit and anime style unchanged" plus the scene, and keep the character's appearance tags in the
prompt as a second anchor. Copyright filters differ per family and can refuse a named anime character; describing
her instead of naming her avoids that trigger.

## 6. Known pitfalls, matched to the measurements

| Measurement or risk | Explanation | Status | Source |
|---------------------|-------------|--------|--------|
| SDXL models ignore everything after about 75 tokens | CLIP has a 77-position context (75 usable plus start and end token); SDXL's tokenizer is configured with `model_max_length: 77`. A1111 works around it by splitting the prompt into 75-token chunks; a plain pipeline truncates. NanoGPT's SDXL route evidently truncates | context size verified; NanoGPT behaviour is the owner's measurement, not documented | [S26][S25] |
| Token cost of common pieces | `hori kyouko` 5, `hori-san to miyamura-kun` 10, `horimiya` 3, `katagiri senior high school uniform,` 8, `1girl, solo,` 5, `masterpiece, best quality,` 5, WAI quality string 8, Animagine quality string 11, NoobAI prefix 15, Nova author prefix 28, Pony full score string with `source_anime` 38, core identity block 38, example scene 14 | counted | [S26] |
| Order inside the window | Identity first, scene second, extras last. On Animagine the quality tags belong at the end, so the scene must stay within its budget | follows from truncation plus the card | [S12] |
| Plain text name gives a generic girl | The Illustrious report says v0.1 struggles with natural-language prompts; Animagine's card lists natural language as not effective. These models key on the exact Danbooru tag | verified | [S15][S12] |
| `hori kyouko, horimiya` gives orange-brown hair but no real likeness | The character tag is known but thin: 165 posts, 43 solo in NoobAI's list; absent from WAI's tested-character list. `horimiya` is an alias with 0 posts, the trained series tag is `hori-san to miyamura-kun`. Eye colour is tagged orange in 35 % and brown in 33 % of posts | counts verified; the causal link to the hair colour is my inference, **unverified** | [S10][S11][S9] |
| Name order | Danbooru-tag models use family name first: `hori kyouko`. "Kyouko Hori" is only right for Anima natural language or for a LoRA whose trigger is written that way | verified | [S10][S21][S22] |
| Duplicated or extra characters | `miyamura_izumi` is in 54 % of her posts, `1boy` in 46 %, `solo` in 33 %: the character tag alone pulls in a black-haired boy. Always send `1girl, solo` | via agent | [S9] |
| No negative prompt on NanoGPT's SDXL models | `1boy, black hair` cannot be pushed away; `solo` and a tight tag block are the only tools | **unverified** (absence of documentation) | [S1][S7][S8] |
| NanoGPT defaults differ from the cards | CFG 7.5 and 20 steps for WAI, Animagine, ZUKI and both Pony models; cards ask for CFG 5–7 and 25–30 steps | verified | [S8][S12][S16][S17] |
| Misleading ids | `infinite-illustrious` is a Pony model, `nsfw-gen-illustrious` is Animagine 4.0, `animagine-xl-31` is Crystal Clear XL. Pick the prompt format by the real model | verified | [S1] |
| Pony needs clip skip 2 | Not controllable through NanoGPT | requirement verified; NanoGPT side **unverified** | [S19] |
| Quality-tag bloat | WAI's author says extra quality tags and long negatives blur the image | verified | [S17] |
| `BREAK` | An A1111 keyword that starts a new 75-token chunk, not a model feature; no evidence NanoGPT honours it | verified for A1111; **unverified** on NanoGPT | [S25] |
| Parentheses | In A1111 or ComfyUI style parsers `(` `)` are weight syntax and literal ones are written `\(` `\)` (Animagine's card does this). Whether NanoGPT's routes parse weights is **unverified**. Kyouko's own tags contain no parentheses, so the question does not arise for her | | [S12] |
| Resolution | Animagine warns about degradation above its training size; WAI wants more than 1024x1024; NoobAI and Nova prefer 832x1216 | verified | [S12][S16][S17][S18] |

## 7. Open points that one cheap call each would settle (not executed)

| Question | Call |
|----------|------|
| Does `/api/v1/images` accept LoRAs for Anima | `anima/text-to-image-lora` with `lora_url_1`, `lora_scale_1: 1` and the trigger words of LoRA 2674903 |
| Which CFG and steps names work on the SDXL route | Same prompt and `seed`, once with `guidance_scale: 5, num_inference_steps: 28`, once with `CFGScale: 5, steps: 28`, compared against a call without them |
| Is `negative_prompt` honoured | Same prompt and `seed`, with and without `negative_prompt: "1boy, black hair"` |
| Does the Civitai download URL work as `lora_url_1` | The first call above answers it |

## 8. Sources

| Id | Source |
|----|--------|
| S1 | NanoGPT public image model list, 263 models, generated 2026-11-12: https://nano-gpt.com/api/v1/images/models |
| S2 | NanoGPT per-model endpoints (checked: `custom-civitai`, `wai-illustrious-sdxl`, `nsfw-gen-illustrious`, `anima/text-to-image`, `anima/text-to-image-lora`, `nano-banana-2.1`, `minimax-h3/text-to-image`): https://nano-gpt.com/api/v1/images/models/custom-civitai/endpoints |
| S3 | NanoGPT docs, Image API: https://docs.nano-gpt.com/api-reference/image-generation.md |
| S4 | NanoGPT docs, Generate Images (`POST /api/v1/images`): https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate.md |
| S5 | NanoGPT docs, OpenAI-compatible image generation: https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai.md |
| S6 | NanoGPT docs, Image Edits: https://docs.nano-gpt.com/api-reference/endpoint/image-edits.md |
| S7 | NanoGPT OpenAPI spec: https://docs.nano-gpt.com/api-reference/openapi.json (legacy page https://docs.nano-gpt.com/api-reference/endpoint/image-generation returns 404) |
| S8 | NanoGPT public model pages, section "Generation controls available for this model": https://nano-gpt.com/models/image/wai-illustrious-sdxl , https://nano-gpt.com/models/image/custom-civitai , https://nano-gpt.com/models/image/nsfw-gen-illustrious , https://nano-gpt.com/models/image/persona%3A376130%402456367 , https://nano-gpt.com/models/image/crystal-clear-xl , https://nano-gpt.com/models/image/2dn-pony-v2 , https://nano-gpt.com/models/image/infinite-illustrious , https://nano-gpt.com/models/image/wavespeed-ai/anima/text-to-image , https://nano-gpt.com/models/image/wavespeed-ai/anima/text-to-image-lora , https://nano-gpt.com/models/image/flux-kontext |
| S9 | Danbooru: https://danbooru.donmai.us/wiki_pages/hori_kyouko , https://danbooru.donmai.us/tags.json?search[name_matches]=hori_kyouko* , https://danbooru.donmai.us/tags.json?search[name_matches]=*horimiya* , https://danbooru.donmai.us/tag_aliases.json?search[antecedent_name]=horimiya , https://danbooru.donmai.us/related_tag.json?query=hori_kyouko&category=general&limit=60 , https://danbooru.donmai.us/related_tag.json?query=hori_kyouko&category=character&limit=20 |
| S10 | NoobAI official wiki dataset, file `danbooru_character.csv`, row `hori_kyouko`: https://huggingface.co/datasets/Laxhar/noob-wiki |
| S11 | WAI character lists `wai_characters_v160.csv` and `waiANIMA_v10Base10_characters.csv`: https://huggingface.co/datasets/flagrantia/character_select_stand_alone_app |
| S12 | Animagine XL 4.0 model card: https://huggingface.co/cagliostrolab/animagine-xl-4.0 |
| S13 | Illustrious XL v0.1 model card: https://huggingface.co/OnomaAIResearch/Illustrious-xl-early-release-v0 |
| S14 | Illustrious XL v1.0 model card: https://huggingface.co/OnomaAIResearch/Illustrious-XL-v1.0 |
| S15 | Illustrious technical report, section 3.1.2 (tag order), 3.1.4 and A.2.3: https://arxiv.org/abs/2409.19946 |
| S16 | NoobAI-XL 1.1 model card: https://huggingface.co/Laxhar/noobai-XL-1.1 |
| S17 | WAI-illustrious-SDXL on Civitai: https://civitai.com/models/827184 |
| S18 | Nova Anime XL on Civitai (version IL v14.0 = 2456367): https://civitai.com/models/376130 |
| S19 | Pony Diffusion V6 XL on Civitai: https://civitai.com/models/257749 |
| S20 | Prefect Pony XL: https://civitai.com/models/439889 ; ZUKI anime ILL: https://civitai.com/models/949488 ; 2DN Pony-v2 version record: https://civitai.com/api/v1/model-versions/933040 |
| S21 | Anima model card: https://huggingface.co/circlestone-labs/Anima |
| S22 | Civitai LoRAs: https://civitai.com/models/2674903 , https://civitai.com/models/2796812 , https://civitai.com/models/1125133 , https://civitai.com/models/1906012 , https://civitai.com/models/2387215 , https://civitai.com/models/1473203 , https://civitai.com/models/2279941 , https://civitai.com/models/2068025 , https://civitai.com/models/471209 , https://civitai.com/models/741261 , https://civitai.com/models/793978 , https://civitai.com/models/694700 ; search: https://civitai.com/api/v1/models?query=hori%20kyouko |
| S23 | WaveSpeed, LoRA training and usage: https://wavespeed.ai/docs/lora-training-usage |
| S24 | Runware docs: https://runware.ai/docs/learn/loras , https://runware.ai/docs/learn/clip-skip , https://runware.ai/docs/learn/schedulers , https://runware.ai/docs/llms.txt |
| S25 | AUTOMATIC1111 wiki, "Infinite prompt length" and "BREAK keyword": https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/Features |
| S26 | CLIP ViT-L/14 tokenizer and config (`max_position_embeddings: 77`): https://huggingface.co/openai/clip-vit-large-patch14 ; SDXL tokenizer config (`model_max_length: 77`): https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/tokenizer/tokenizer_config.json |
| S27 | Google, image generation docs (via agent): https://aistudio.google.com/docs/image-generation |
| S28 | Google DeepMind, Gemini image Pro model page (via agent): https://deepmind.google/models/gemini-image/pro/ |
| S29 | User report, Google AI developer forum (via agent): https://discuss.ai.google.dev/t/nano-banan-pro-ignoring-prompt-and-reference-images/112781 |
| S30 | Third party, Scenario content-policy overview (via agent): https://help.scenario.com/articles/8779329416-content-policy-copyright-what-each-model-allows |
| S31 | ByteDance Seedream 4.5 product page (via agent): https://seed.bytedance.com/en/seedream4_5 |
| S32 | Volcengine Seedream docs, prompt guide and API limits (via agent): https://docs.volcengine.com/docs/82379/1829186 , https://docs.volcengine.com/docs/82379/1541523 |
| S33 | Qwen-Image-Edit-2511 model card (via agent): https://huggingface.co/Qwen/Qwen-Image-Edit-2511 |
| S34 | Qwen-Image-Edit-2509 model card (via agent): https://huggingface.co/Qwen/Qwen-Image-Edit-2509 |
| S35 | User report, note.com (via agent): https://note.com/claute_colo0514/n/n7a130a53240e |
| S36 | User report, Hugging Face forum (via agent): https://discuss.huggingface.co/t/multi-image-edit-3-refs-artifacts-at-true-cfg-fine-on-lightning-reference-content-dependent/175726 |
| S37 | BFL, Kontext overview and image editing (via agent): https://docs.bfl.ml/kontext/kontext_overview.md , https://docs.bfl.ml/kontext/kontext_image_editing.md |
| S38 | BFL, character consistency and multi-reference prompting, FLUX.2 editing (via agent): https://docs.bfl.ai/guides/usecases_editing_character_consistency.md , https://docs.bfl.ai/guides/prompting_editing_multi_reference.md , https://docs.bfl.ml/flux_2/flux2_image_editing.md |
| S39 | ComfyUI docs, FLUX.1 Kontext dev (via agent): https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev |
| S40 | FLUX.1 Kontext dev model card (via agent): https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev |
| S41 | FLUX.1 Kontext paper (via agent): https://arxiv.org/html/2506.15742v2 |
| S42 | Third party comparison of consistent-character methods (via agent): https://neverbiasu.github.io/posts/reprints/generate-consistent-characters.html |
| S43 | OpenAI cookbook, image generation prompting guide (via agent): https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide.md |
| S44 | OpenAI API reference, images (via agent): https://developers.openai.com/api/reference/resources/images.md |
| S45 | OpenAI cookbook, high input fidelity (via agent): https://developers.openai.com/cookbook/examples/generate_images_with_high_input_fidelity |
| S46 | User report, OpenAI community forum (via agent): https://community.openai.com/t/gpt-image-1-moderation-blocks-prompts-allowed-by-dall-e-3-pop-culture-references/1252701 |
| S47 | Hugging Face Diffusers, image-to-image (`strength`) (via agent): https://huggingface.co/docs/diffusers/using-diffusers/img2img |
| S48 | Hugging Face Diffusers, IP-Adapter (via agent): https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter |
| S49 | User report, astorie.ai consistency test (via agent): https://astorie.ai/blog/nano-banana-character-2-1-consistency-test |
