# BF Quick Image Gen

A small extension for [TauriTavern](https://github.com/Darkatse/TauriTavern) (the Rust rewrite of SillyTavern,
also on Android) that also runs in SillyTavern 1.18+.

It adds one wand-menu entry, **Senden + Bild**: your message is sent as usual, the reply is held back until an
image of the current scene has been generated and attached to it, then text and image appear together.
A normal send is never affected. The UI is German.

- Image providers: **NanoGPT** and **OpenRouter** (their dedicated image APIs). Nothing else.
- The image prompt always includes **message 0** of the chat (character looks, setting) plus the latest N messages.
- By default the chat model writes the image prompt; if that fails the extension falls back to a direct prompt.
- A **Galerie** tab lists every generated image.

## Install

In TauriTavern or SillyTavern: Extensions > **Install extension**, paste

```
https://github.com/BF-GitH/bf-quick-image-gen
```

The installer clones the repository's **default branch** unless you fill in the optional "Branch or tag name"
field. While the rewrite lives on the branch `slim-tauritavern`, enter that name there.

This fork uses its own settings key and its own menu entry, so it can sit next to the original Quick Image Gen.
Disable or remove the original if you no longer want its palette button and settings drawer.

## Use

1. Open the settings drawer "BF Quick Image Gen": pick the provider, a model (star = favourite), optionally an API key.
   "Testbild generieren" checks the setup.
2. In a chat, type your message, open the wand menu and choose **Senden + Bild**.
3. While the image is generated a status bar appears above the input; "Text sofort zeigen" shows the reply
   without waiting for the image.
4. If the image fails, the reply is shown anyway and a toast appears; tap it to retry for that message.

## API keys

The key is resolved in this order:

1. The key entered in the extension's own **API-Key** field.
2. The key stored in the app for that provider (API connections). Extensions may only read it when
   **Allow Keys Exposure** is on: TauriTavern Settings > Misc > "Allow Keys Exposure", then restart the app.
   The settings panel shows which case applies.

Keys are never logged or displayed.

## Android

Images are uploaded into the app's data folder (`user/images/<character>/`) and attached to the chat message.
Android does not let extensions write silently to the public Download folder: "Auf Gerät speichern" in the gallery
opens the system save dialog, once per image (optionally after every image, see the gallery tab).

## Not verified

- Calls against the real NanoGPT and OpenRouter APIs (tested only against the local mock server and recorded
  model-list samples).
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
