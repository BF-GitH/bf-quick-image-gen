# BF Quick Image Gen

A small extension for [TauriTavern](https://github.com/Darkatse/TauriTavern) (the Rust rewrite of SillyTavern,
also on Android) that also runs in SillyTavern 1.18+.

It adds one wand-menu entry, **Senden + Bild**: your message is sent as usual, the reply is held back until an
image of the current scene has been generated and attached to it, then text and image appear together.
A normal send is never affected. The UI is German.

- Image providers: **NanoGPT** and **OpenRouter** (their dedicated image APIs). Nothing else.
- The image prompt always includes **message 0** of the chat (character looks, setting) plus the latest N messages,
  and the description from the **character card**.
- By default the chat model writes the image prompt: a short description of what is to be drawn (at most 45
  words, the most important first); if that fails the extension falls back to a direct prompt. A character from a
  published work is named with its work (`Hermione Granger from Harry Potter`), which is what anime models
  recognise.
- A **Galerie** tab lists every generated image.

## Install

In TauriTavern or SillyTavern: Extensions > **Install extension**, paste

```
https://github.com/BF-GitH/bf-quick-image-gen
```

Leave the optional "Branch or tag name" field empty: the default branch `main` holds the extension.

This fork uses its own settings key and its own menu entry, so it can sit next to the original Quick Image Gen.
Disable or remove the original if you no longer want its palette button and settings drawer.

## Use

1. Open the settings drawer "BF Quick Image Gen": pick the provider, a model (star = favourite), optionally an API key.
   "Testbild generieren" checks the setup.
2. In a chat, type your message, open the wand menu and choose **Senden + Bild**.
3. While the image is generated a status bar appears above the input; "Text sofort zeigen" shows the reply
   without waiting for the image.
4. If the image fails, the reply is shown anyway and a toast appears; tap it to retry for that message.
5. The checkbox "Text sofort zeigen, Bild parallel erzeugen" switches to the parallel mode: the reply streams like a
   normal send while the image is generated at the same time from the chat up to your message. The image is inserted
   below the reply as soon as both are ready.
6. Message 0 is used only as background information (what the characters and the world look like); the image shows
   the current moment, the latest message.
7. A long-press on a generated image in the chat opens the viewer with "Löschen" and "Auf Gerät speichern"
   (on Android the host's own image controls only appear on hover).

### Prompt and models

- The default prompt shows `{{char}}` through the eyes of `{{user}}`; the user is not in the picture. Change the
  text under "Prompt" to show someone else. An install that still has an old default gets the new one
  automatically; a text you changed is kept ("Standard" restores the default).
- Anime models on NanoGPT that draw known characters well with this prompt: `wai-illustrious-sdxl`
  (WAI Illustrious SDXL, fast and cheap) and `anima/text-to-image` (Anima, slower, keeps more detail).
  `flux-schnell` does not know most characters.
- SDXL-based models (all the anime ones) read only about the first 75 tokens of a prompt. That is why the prompt
  is kept this short, starts with how many people are shown, and why "Stil-Zusatz" is put in front of it.
- A reasoning chat model needs room to think: for the image prompt the reply length of a chat-completion preset
  is raised to 2000 tokens for that one request.

## API keys

The key is resolved in this order:

1. The key entered in the extension's own **API-Key** field.
2. The key stored in the app for that provider (API connections). Extensions may only read it when
   **Allow Keys Exposure** is on: User Settings (the person-with-gear icon) > "TauriTavern Settings" > Misc >
   "Allow Keys Exposure", then restart the app.
   The settings panel shows which case applies. The status follows the app when a key is saved, removed or
   switched in the API connections; the button next to the key field checks it again on demand.

Keys are never logged or displayed.

## Android

Images are uploaded into the app's data folder (`user/images/<character>/`) and attached to the chat message.
Android does not let extensions write silently to the public Download folder: "Auf Gerät speichern" in the gallery
opens the system save dialog, once per image (optionally after every image, see the gallery tab).

Keep the app in the foreground until the image has arrived: TauriTavern's background service ends with the chat
reply, so Android may pause the image request while the app is in the background. With TauriTavern's optional chat
virtualization, scrolling can show blank rows while a reply is held back. In parallel mode with the chat model
writing the image prompt, TauriTavern's "reply ready" notification can be missing when the reply finishes before
that prompt request.

## Not verified

- Calls against the real OpenRouter API (tested only against the local mock server and recorded model-list
  samples). NanoGPT was tested for real on 2026-11-12: chat model and image models, key taken from the app.
- TauriTavern on Android (tested in desktop SillyTavern 1.18).

## Development

Plain ES modules, no build step, no runtime dependencies.

```
npm run verify   # eslint + node --test (unit tests and architecture guard)
npm run mock     # local mock server: chat completions + NanoGPT/OpenRouter image routes (PORT, default 8124)
```

`dev/SPEC.md` is the binding build spec. The mock serves an OpenAI-compatible chat completion at
`http://127.0.0.1:8124/v1` and imitations of the image APIs at `/nanogpt/api/v1/images` and
`/openrouter/api/v1/images` (any non-empty Bearer key; a prompt containing `FAIL` returns an error;
`MOCK_IMAGE_DELAY_MS` sets the delay).

## Credits

Fork and rewrite of [Quick Image Gen](https://github.com/platberlitz/sillytavern-image-gen) by platberlitz.
MIT license, see `LICENSE`.
