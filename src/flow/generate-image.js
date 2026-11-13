// WIRING: one image for one chat message, from settings to attached media and gallery record.
// Split into prepare (prompt, image, upload) and attach, so the parallel mode can generate while the reply streams.

import { EXTENSION_ID, LOG_PREFIX } from '../shared/constants.js';
import { getProvider } from '../providers/index.js';
import { extensionForMime } from '../providers/http.js';
import { finalizePrompt, promptPreviewText } from '../prompt/scene.js';
import { composeImagePrompt, describeScene } from '../prompt/build.js';
import { PICTURE_PROMPT_LIMIT, assignPrompts } from '../prompt/pictures.js';
import { createImagePool } from './image-pool.js';
import { getSettings } from '../settings/store.js';
import { expandImageJobs } from '../settings/defaults.js';
import { resolveApiKey } from '../settings/keys.js';
import { getModelInfo } from '../settings/model-cache.js';
import { addGalleryRecord } from '../gallery/store.js';
import { listCandidates } from '../references/store.js';
import { getChatId, isGenerating, notify, timestampName } from '../host/st.js';
import { attachImageToMessage, getImageFolderName, getRawMessage, saveChat } from '../host/chat.js';
import { uploadImage, saveToDevice, deleteImage } from '../host/images.js';

const TEST_PROMPT = 'A cozy fantasy tavern interior at night, warm lantern light, wooden beams, detailed illustration';
const REMOTE_ONLY_WARNING = 'Bild konnte nicht lokal gespeichert werden, es ist nur verlinkt.';
const REFERENCES_FAILED_WARNING = 'Referenzbilder konnten nicht geladen werden, das Bild entsteht ohne sie.';
const llmProblemWarning = (reason) => `Das Textmodell hat keinen Bildprompt geliefert (${reason}). Das Bild entsteht aus dem Rohtext der Nachricht.`;
const tooManyWishesWarning = (jobs, wishes) => `Nur ${jobs} von ${wishes} Bildwünschen werden gemalt: der Durchgang hat nur ${jobs} Bilder.`;
const MESSAGE_GONE = 'Die Nachricht ist nicht mehr vorhanden.';
const POOL_LIMIT = 4;
const IDLE_POLL_MS = 1000;
// Lets the failure toast tell "nothing left to retry" apart from a failure worth retrying.
export const MESSAGE_GONE_CODE = 'MESSAGE_GONE';

function messageGoneError() {
    return Object.assign(new Error(MESSAGE_GONE), { code: MESSAGE_GONE_CODE });
}

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
async function produceImage({ target, modelInfo, prompt, references, folder, ts, signal }) {
    const { settings, provider, model, apiKey } = target;
    const result = await provider.generateImage({
        apiKey,
        model,
        prompt,
        aspect: settings.aspect,
        quality: settings.quality,
        modelInfo,
        references,
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

function record({ url, prompt, providerId, model, character, names, enabled = true }) {
    addGalleryRecord({
        url,
        prompt,
        provider: providerId,
        model,
        character,
        timestamp: Date.now(),
        // A generated picture becomes a checked reference for the people on it (owner's decision, spec 12.1);
        // a picture drawn from a wish (polaroid, movie set) would carry its look into the next pictures.
        ...(names ? { names, enabled } : {}),
    });
}

export async function checkConfiguration() {
    const provider = getProvider(getSettings().provider);
    await resolveApiKey(provider);
}

// While the job runs the host UI can be unlocked (retry, streaming): the user may delete, swipe or switch chats,
// and the index would then name another message. Only the exact message, swipe and chat may get the image.
export function captureMessage(messageIndex) {
    const message = getRawMessage(messageIndex);
    if (!message) throw messageGoneError();
    return { message, swipeId: swipeIdOf(message), chatId: getChatId() };
}

// The host numbers the swipe of a fresh reply only after MESSAGE_RECEIVED: unset and 0 are the same swipe.
function swipeIdOf(message) {
    return message.swipe_id ?? 0;
}

function isSameMessage(messageIndex, token) {
    if (!token) return false;
    const message = getRawMessage(messageIndex);
    return message === token.message && swipeIdOf(message) === token.swipeId && getChatId() === token.chatId;
}

// The status bar shows the prompt; a failing display must never cost the picture.
function reportPrompt(onPrompt, prompt) {
    if (typeof onPrompt !== 'function') return;
    try {
        onPrompt(prompt);
    } catch (error) {
        console.warn(`${LOG_PREFIX} onPrompt failed:`, error?.message ?? error);
    }
}

// Composes the prompt of every distinct model of the run; the chat model was asked once in describeScene.
async function composePrompts(scene, { target, models, infos, candidates }) {
    const results = await Promise.all(models.map((model) => composeImagePrompt(scene, {
        settings: target.settings,
        candidates,
        maxPromptChars: promptLimit(infos.get(model)),
        maxReferences: target.provider.maxReferenceImages(infos.get(model)),
    })));
    return new Map(models.map((model, i) => [model, results[i]]));
}

function discardImage(image) {
    // Only an uploaded file is ours to remove; deleteImage never throws, so no await needed.
    if (image?.extension) deleteImage(image.url);
}

// Returns with the first finished picture; the pool keeps producing the rest for attachRemainingImages.
export async function prepareImage(lastIndex, { signal, onPrompt } = {}) {
    throwIfAborted(signal);
    const target = await resolveTarget(signal);
    const providerId = target.provider.id;
    const jobs = expandImageJobs(target.settings.batch[providerId], target.model);
    const models = [...new Set(jobs)];
    const infos = new Map();
    for (const model of models) infos.set(model, await getModelInfo(providerId, model));
    throwIfAborted(signal);
    const candidates = listCandidates();
    const maxPrompts = jobs.length > 1 ? PICTURE_PROMPT_LIMIT : 1;
    const scene = await describeScene({ lastIndex, settings: target.settings, candidates, maxPrompts });
    throwIfAborted(signal);
    const wishCount = scene.descriptions.length;
    if (wishCount > jobs.length) notify.warning(tooManyWishesWarning(jobs.length, wishCount));
    const composed = await composePrompts(scene, { target, models, infos, candidates });
    throwIfAborted(signal);
    // The extension, never the chat model, decides which job draws which prompt: dealt like cards in list order.
    const assignment = assignPrompts(jobs.length, wishCount);
    const prompts = jobs.map((model, i) => composed.get(model).prompts[assignment[i]]);
    const preview = promptPreviewText(jobs.map((model, i) => ({ model, prompt: prompts[i] })));
    reportPrompt(onPrompt, preview);
    if (scene.llmProblem) notify.warning(llmProblemWarning(scene.llmProblem));
    if ([...composed.values()].some((result) => result.failedReferences > 0)) notify.warning(REFERENCES_FAILED_WARNING);

    const folder = getImageFolderName();
    const ts = timestampName();
    // Several pictures of one run need distinct file names, also in the save dialog.
    const fileTs = jobs.length === 1 ? [ts] : jobs.map((_, i) => `${ts}_${i + 1}`);
    const produce = async (model, i, poolSignal) => {
        const { url, extension } = await produceImage({
            target: { ...target, model },
            modelInfo: infos.get(model),
            prompt: prompts[i],
            references: composed.get(model).references.map((reference) => reference.dataUrl),
            folder,
            ts: fileTs[i],
            signal: poolSignal,
        });
        return { url, prompt: prompts[i], extension, model, ts: fileTs[i] };
    };
    const pool = createImagePool({ jobs, produce, limit: POOL_LIMIT, signal, discard: discardImage });
    const first = await pool.next();
    if (!first) {
        throwIfAborted(signal);
        throw pool.failures[0].error;
    }
    if (signal?.aborted) {
        discardImage(first.value);
        throwIfAborted(signal);
    }
    return {
        images: [first.value],
        pool,
        total: jobs.length,
        wishes: wishCount > 1,
        preview,
        providerId,
        folder,
        names: scene.shownNames,
    };
}

export function discardPreparedImage(prepared) {
    for (const image of prepared?.images ?? []) discardImage(image);
    prepared?.pool?.abort();
}

// One chain per run, so the dialogs of the first picture and of the ones that follow never overlap.
const dialogChains = new WeakMap();

function queueSaveDialogs(prepared, images) {
    const previous = dialogChains.get(prepared) ?? Promise.resolve();
    dialogChains.set(prepared, previous.then(() => openSaveDialogs(images)));
}

// The dialogs come one after another: several system dialogs at once would bury each other.
async function openSaveDialogs(images) {
    for (const { url, extension, ts } of images) {
        if (!extension) continue;
        try {
            await saveToDevice(url, `tauri_${ts}.${extension}`);
        } catch (error) {
            console.warn(`${LOG_PREFIX} save dialog failed:`, error?.message ?? error);
        }
    }
}

// Everything up to the gallery records runs before the first await: the parallel mode returns this promise from
// its MESSAGE_RECEIVED listener, and the host renders and saves the reply right after the listener settles.
export async function attachPreparedImage(messageIndex, prepared, { token, save = false } = {}) {
    const { images, providerId, folder, names, wishes } = prepared;
    if (!isSameMessage(messageIndex, token)) {
        discardPreparedImage(prepared);
        throw messageGoneError();
    }
    const shown = Array.isArray(names) ? names : [];
    for (const [i, image] of images.entries()) {
        if (!attachImageToMessage(messageIndex, { url: image.url, title: image.prompt })) {
            if (i === 0) {
                discardPreparedImage(prepared);
                throw messageGoneError();
            }
            discardImage(image);
            continue;
        }
        record({ url: image.url, prompt: image.prompt, providerId, model: image.model, character: folder, names: shown, enabled: !wishes });
    }
    if (save) {
        try {
            await saveChat();
        } catch (error) {
            // A failed attach starts no tail, so the pictures still being made must not be paid for and stored.
            prepared.pool?.abort();
            throw error;
        }
    }
    if (getSettings().autoSaveDialog) queueSaveDialogs(prepared, images);
}

// Resolves once the host writes no reply (checked once a second) or the signal is aborted.
function waitUntilIdle(signal) {
    return new Promise((resolve) => {
        const idle = () => signal?.aborted || !isGenerating();
        if (idle()) {
            resolve();
            return;
        }
        const timer = setInterval(() => {
            if (!idle()) return;
            clearInterval(timer);
            resolve();
        }, IDLE_POLL_MS);
    });
}

// Attaches the pictures that follow the first one, each as soon as it is finished.
export async function attachRemainingImages(messageIndex, prepared, { token, signal, onProgress } = {}) {
    const { pool, providerId, folder, names, wishes } = prepared;
    const shown = Array.isArray(names) ? names : [];
    // Ends a pending pool.next() at once instead of after the next picture.
    const stop = () => pool.abort();
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    let attached = 0;
    let gone = false;
    try {
        for (let result = await pool.next(); result; result = await pool.next()) {
            const image = result.value;
            // A reply that is being written must never be touched.
            await waitUntilIdle(signal);
            if (signal?.aborted) {
                discardImage(image);
                pool.abort();
                break;
            }
            if (!isSameMessage(messageIndex, token) || !attachImageToMessage(messageIndex, { url: image.url, title: image.prompt })) {
                discardImage(image);
                pool.abort();
                gone = true;
                break;
            }
            record({ url: image.url, prompt: image.prompt, providerId, model: image.model, character: folder, names: shown, enabled: !wishes });
            attached += 1;
            await saveChat();
            if (getSettings().autoSaveDialog) queueSaveDialogs(prepared, [image]);
            onProgress?.({ done: prepared.images.length + attached, total: prepared.total });
        }
    } catch (error) {
        // Pictures that still arrive would otherwise stay stored without a message.
        pool.abort();
        throw error;
    } finally {
        signal?.removeEventListener('abort', stop);
    }
    const [firstFailure] = pool.failures;
    return { attached, failed: pool.failures.length, firstError: firstFailure ? firstFailure.error : null, gone };
}

export async function generateImageForMessage(messageIndex, { signal, saveBefore = false, saveAfterAttach = false, onPrompt } = {}) {
    throwIfAborted(signal);
    const token = captureMessage(messageIndex);
    if (saveBefore) {
        await saveChat();
        throwIfAborted(signal);
    }
    const prepared = await prepareImage(messageIndex, { signal, onPrompt });
    await attachPreparedImage(messageIndex, prepared, { token, save: saveAfterAttach });
    const [first] = prepared.images;
    return { url: first.url, prompt: first.prompt, prepared, token };
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
    record({ url, prompt, providerId: target.provider.id, model: target.model, character: 'Test' });
    return { url, prompt };
}
