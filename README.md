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
- **Reference pictures** keep a character looking the same: upload a picture, name it, and it goes along
  whenever that character is in the scene. Every generated image becomes a reference by itself.
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
8. "Prompt anzeigen" in the status bar shows the finished image prompt while the picture is generated, so a
   picture that is going wrong can be cancelled early.
9. Reply deleted and your own message is the last one in the chat: the picture button of that message writes the
   reply again and then the picture, in both modes. The message box must be empty for this.
10. "Mehrere Bilder" under the model list makes several pictures per run: add models with a count each (up to 8
    per model, 16 in total). Every picture is paid for on its own. An empty list means one picture with the chosen
    model; "Testbild generieren" always makes one.
    - Different pictures: write your wishes into your own message as an out-of-character note, for example
      `((one picture like a polaroid; one from the front; one from the view of someone walking by))`. The chat model
      writes one prompt per wish (at most 8). Without such a note all pictures get the same prompt.
    - The extension, not the chat model, decides who gets which prompt: the prompts are dealt out like cards over
      the list in order (picture 1 gets prompt 1, picture 2 prompt 2, then prompt 1 again). With two wishes and
      "HiDream x8, Seedream x8" each model draws each prompt four times. "Prompt anzeigen" shows every prompt with
      its models and counts.
    - At most four pictures are requested at once. The reply waits only for the first picture, which must arrive
      within four minutes; the others follow below it one by one as they finish. "Rest abbrechen" in the status bar
      stops the ones still missing.
    - Pictures of a run with wishes are tagged but not checked as reference pictures, so a polaroid look does not
      carry over into the next pictures. Check the ones you want to use.
11. The pictures of a message appear below each other; one more picture for the message goes below the ones
    already there.
12. Deleting a message, a swipe or a picture with the app's own controls also takes the pictures out of the
    Galerie and Referenzen tabs. The picture files themselves are left alone.

### Reference pictures

Text alone rarely gets a specific character right: the anime models have seen too few pictures of most of them.
A reference picture does.

1. Pick a model that accepts reference pictures. The note under the model list says how many it takes. Tested on
   NanoGPT: `seedream-v4.5`, `seedream-v5.0-lite`, `qwen-image-3`, `gpt-image-2`, `hidream-o1-image-dev`. The
   anime SDXL models only copy the framing of a reference.
2. Tab "Referenzen": type a new character's name, or tick characters you already have under "Figuren
   auswählen" (several for a picture that shows several), choose a picture, "Bild hochladen". Two pictures per
   character work best: the face, and the whole figure in the outfit you want.
3. From then on the chat model says who is in each picture, and the matching reference pictures go along.

- Pictures of the same characters form a group ("Kyouko", "Yuki", "Kyouko + Yuki"). The order inside a group
  is the order of use; the arrows move a picture. Until you sort a group, uploads come first and then the
  newest generated picture; once you sort it, your order stays and new pictures go to the end.
- Only checked pictures are used, at most two per character and never more than the model takes.
- A picture that shows several characters of the scene goes first, so four characters fit into three pictures.
  A picture with someone who is not in the scene stays out.
- Every generated image is tagged with the characters on it and is checked by itself (except in a run with
  wishes, see "Mehrere Bilder"). Delete or uncheck the ones
  you do not like, otherwise their flaws carry over.
- You appear in pictures only when a checked reference carries your persona name; otherwise the picture is seen
  through your eyes.
- The image button among a message's icons generates a new picture for that message.
- More reference pictures cost time, not money: `seedream-v4.5` took 18 s with one and 47 s with six, at the
  same price.

### Prompt and models

- The default prompt shows `{{char}}` and everyone else who is present, seen through the eyes of `{{user}}`.
  Change the text under "Prompt" to show someone else. An install that still has an old default gets the new one
  automatically; a text you changed is kept ("Standard" restores the default).
- "Prompt" is the task for the chat model (what the picture should show). "Bildbeschreibung" says what the chat
  model then writes about the picture and in which order, and "Wörter höchstens" how long it may get. To get
  feelings, bodies and movement into the pictures, write for example:
  `who is shown, their build and what they wear in this moment, their pose and movement, their facial expression and the emotion behind it, what caused this moment as far as it can be seen, the place, the light`
  and raise the words to about 90 (only for models that read that much, see below). Always added by the
  extension itself: who is in the picture, the number of people in front, and which reference picture shows whom.
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
