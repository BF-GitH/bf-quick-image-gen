// WIRING: one image for one chat message, from settings to attached media and gallery record.

import { EXTENSION_ID, LOG_PREFIX } from '../shared/constants.js';
import { getProvider } from '../providers/index.js';
import { extensionForMime } from '../providers/http.js';
import { finalizePrompt } from '../prompt/scene.js';
import { buildImagePrompt } from '../prompt/build.js';
import { getSettings } from '../settings/store.js';
import { resolveApiKey } from '../settings/keys.js';
import { getModelInfo } from '../settings/model-cache.js';
import { addGalleryRecord } from '../gallery/store.js';
import { notify, timestampName } from '../host/st.js';
import { attachImageToMessage, getImageFolderName, saveChat } from '../host/chat.js';
import { uploadImage, saveToDevice, deleteImage } from '../host/images.js';

const TEST_PROMPT = 'A cozy fantasy tavern interior at night, warm lantern light, wooden beams, detailed illustration';
const REMOTE_ONLY_WARNING = 'Bild konnte nicht lokal gespeichert werden, es ist nur verlinkt.';
const MESSAGE_GONE = 'Die Nachricht ist nicht mehr vorhanden.';

function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
}

function promptLimit(modelInfo) {
    return Math.min(modelInfo?.maxPromptChars ?? 1800, 4000);
}

async function resolveTarget(signal) {
    const settings = getSettings();
    const provider = getProvider(settings.provider);
    const model = settings.models[provider.id] || provider.defaultModel;
    const apiKey = await resolveApiKey(provider);
    throwIfAborted(signal);
    return { settings, provider, model, apiKey };
}

// Uploading keeps the image working offline and after provider URLs expire; a remote URL is the last resort.
async function produceImage({ target, modelInfo, prompt, folder, ts, signal }) {
    const { settings, provider, model, apiKey } = target;
    const result = await provider.generateImage({
        apiKey,
        model,
        prompt,
        aspect: settings.aspect,
        quality: settings.quality,
        modelInfo,
        signal,
    });
    throwIfAborted(signal);
    if (result.remoteUrl) {
        notify.warning(REMOTE_ONLY_WARNING);
        return { url: result.remoteUrl, extension: null };
    }
    const extension = extensionForMime(result.mime);
    const url = await uploadImage({ base64: result.base64, extension, folder, fileName: `bfqig_${ts}` });
    if (signal?.aborted) {
        // Nothing will reference the file after a cancel; deleteImage never throws, so no await needed.
        deleteImage(url);
        throwIfAborted(signal);
    }
    return { url, extension };
}

function record({ url, prompt, target, character }) {
    addGalleryRecord({
        url,
        prompt,
        provider: target.provider.id,
        model: target.model,
        character,
        timestamp: Date.now(),
    });
}

export async function checkConfiguration() {
    const provider = getProvider(getSettings().provider);
    await resolveApiKey(provider);
}

export async function generateImageForMessage(messageIndex, { signal, saveBefore = false, saveAfterAttach = false } = {}) {
    throwIfAborted(signal);
    const target = await resolveTarget(signal);
    if (saveBefore) {
        await saveChat();
        throwIfAborted(signal);
    }
    const modelInfo = await getModelInfo(target.provider.id, target.model);
    throwIfAborted(signal);
    const { prompt } = await buildImagePrompt({
        replyIndex: messageIndex,
        settings: target.settings,
        maxPromptChars: promptLimit(modelInfo),
    });
    throwIfAborted(signal);

    const folder = getImageFolderName();
    const ts = timestampName();
    const { url, extension } = await produceImage({ target, modelInfo, prompt, folder, ts, signal });

    if (!attachImageToMessage(messageIndex, { url, title: prompt })) throw new Error(MESSAGE_GONE);
    record({ url, prompt, target, character: folder });
    if (saveAfterAttach) {
        await saveChat();
        throwIfAborted(signal);
    }
    if (target.settings.autoSaveDialog && extension) {
        saveToDevice(url, `tauri_${ts}.${extension}`).catch((error) => {
            console.warn(`${LOG_PREFIX} save dialog failed:`, error?.message ?? error);
        });
    }
    return { url, prompt };
}

export async function generateTestImage({ signal } = {}) {
    throwIfAborted(signal);
    const target = await resolveTarget(signal);
    const modelInfo = await getModelInfo(target.provider.id, target.model);
    throwIfAborted(signal);
    const prompt = finalizePrompt(TEST_PROMPT, {
        styleSuffix: target.settings.styleSuffix,
        maxChars: promptLimit(modelInfo),
    });
    const { url } = await produceImage({
        target,
        modelInfo,
        prompt,
        folder: EXTENSION_ID,
        ts: timestampName(),
        signal,
    });
    record({ url, prompt, target, character: 'Test' });
    return { url, prompt };
}
