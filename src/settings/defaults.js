// Settings template and validation. Pure: the store decides where the object lives.

import { ASPECT_IDS, DEFAULT_MODELS, PROVIDER_IDS, QUALITY_IDS } from '../shared/constants.js';
import { DEFAULT_DESCRIPTION, DEFAULT_INSTRUCTION, DESCRIPTION_WORDS, LEGACY_DEFAULT_INSTRUCTIONS } from '../prompt/scene.js';
import { GALLERY_LIMIT } from '../gallery/records.js';
import { REFERENCE_LIMIT, normalizeNames } from '../references/select.js';

export const DEFAULT_SETTINGS = Object.freeze({
    provider: 'nanogpt',
    keys: Object.freeze({ nanogpt: '', openrouter: '' }),
    models: Object.freeze({ ...DEFAULT_MODELS }),
    favorites: Object.freeze({ nanogpt: Object.freeze([]), openrouter: Object.freeze([]) }),
    batch: Object.freeze({ nanogpt: Object.freeze([]), openrouter: Object.freeze([]) }),
    // '' means the chat model of the app writes the image prompt.
    textModels: Object.freeze({ nanogpt: '', openrouter: '' }),
    instruction: DEFAULT_INSTRUCTION,
    description: DEFAULT_DESCRIPTION,
    descriptionWords: DESCRIPTION_WORDS.fallback,
    aspect: '1:1',
    quality: 'standard',
    styleSuffix: '',
    useLlm: true,
    autoSaveDialog: false,
    parallelImage: false,
    gallery: Object.freeze([]),
    references: Object.freeze([]),
    referenceOrder: Object.freeze({}),
});

const ORDER_LIMIT = 300;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toStr(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function toBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function toDescriptionWords(value) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return DESCRIPTION_WORDS.fallback;
    return Math.min(DESCRIPTION_WORDS.max, Math.max(DESCRIPTION_WORDS.min, Math.round(number)));
}

function normalizeDescription(value) {
    return typeof value === 'string' && value.trim() ? value : DEFAULT_DESCRIPTION;
}

function uniqueStrings(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item) => typeof item === 'string' && item !== ''))];
}

function perProvider(source, mapValue) {
    const from = isObject(source) ? source : {};
    return Object.fromEntries(PROVIDER_IDS.map((id) => [id, mapValue(from[id], id)]));
}

// An untouched old default is migrated so existing installs get the current wording.
function normalizeInstruction(value) {
    const instruction = toStr(value);
    if (!instruction.trim() || LEGACY_DEFAULT_INSTRUCTIONS.includes(instruction)) return DEFAULT_INSTRUCTION;
    return instruction;
}

function hasUrl(entry) {
    return isObject(entry) && typeof entry.url === 'string' && entry.url !== '';
}

function normalizeGalleryEntry(entry) {
    const copy = { ...entry };
    if (copy.names !== undefined) copy.names = normalizeNames(copy.names);
    if (copy.enabled !== undefined) copy.enabled = Boolean(copy.enabled);
    return copy;
}

function normalizeGallery(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(hasUrl).map(normalizeGalleryEntry).slice(0, GALLERY_LIMIT);
}

function normalizeReferences(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(hasUrl).map((entry) => ({
        url: entry.url,
        names: normalizeNames(entry.names),
        enabled: toBool(entry.enabled, true),
        timestamp: typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp) ? entry.timestamp : 0,
    })).slice(0, REFERENCE_LIMIT);
}

// fromEntries instead of assignment: a stored key "__proto__" must stay a plain key.
function normalizeReferenceOrder(value) {
    if (!isObject(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter(([, list]) => Array.isArray(list))
        .map(([groupId, list]) => [groupId, uniqueStrings(list).slice(0, ORDER_LIMIT)])
        .filter(([, list]) => list.length > 0));
}

export function normalizeSettings(saved) {
    const src = isObject(saved) ? saved : {};
    return {
        provider: oneOf(src.provider, PROVIDER_IDS, DEFAULT_SETTINGS.provider),
        keys: perProvider(src.keys, (value) => toStr(value)),
        models: perProvider(src.models, (value, id) => toStr(value).trim() || DEFAULT_MODELS[id]),
        favorites: perProvider(src.favorites, (value) => uniqueStrings(value)),
        batch: perProvider(src.batch, (value) => normalizeBatch(value)),
        textModels: perProvider(src.textModels, (value) => toStr(value).trim()),
        instruction: normalizeInstruction(src.instruction),
        description: normalizeDescription(src.description),
        descriptionWords: toDescriptionWords(src.descriptionWords),
        aspect: oneOf(src.aspect, ASPECT_IDS, DEFAULT_SETTINGS.aspect),
        quality: oneOf(src.quality, QUALITY_IDS, DEFAULT_SETTINGS.quality),
        styleSuffix: toStr(src.styleSuffix),
        useLlm: toBool(src.useLlm, DEFAULT_SETTINGS.useLlm),
        autoSaveDialog: toBool(src.autoSaveDialog, DEFAULT_SETTINGS.autoSaveDialog),
        parallelImage: toBool(src.parallelImage, DEFAULT_SETTINGS.parallelImage),
        gallery: normalizeGallery(src.gallery),
        references: normalizeReferences(src.references),
        referenceOrder: normalizeReferenceOrder(src.referenceOrder),
    };
}

export function toggleFavorite(list, modelId) {
    const current = uniqueStrings(list);
    if (typeof modelId !== 'string' || modelId === '') return current;
    return current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId];
}

export const BATCH_LIMITS = Object.freeze({ perModel: 8, total: 16 });

function toBatchCount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
    return Math.min(BATCH_LIMITS.perModel, Math.max(1, Math.trunc(value)));
}

export function normalizeBatch(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    let left = BATCH_LIMITS.total;
    for (const entry of value) {
        const model = isObject(entry) && typeof entry.model === 'string' ? entry.model.trim() : '';
        if (!model || seen.has(model)) continue;
        seen.add(model);
        if (left <= 0) continue;
        const count = Math.min(toBatchCount(entry.count), left);
        left -= count;
        result.push({ model, count });
    }
    return result;
}

export function addToBatch(list, modelId) {
    const current = normalizeBatch(list);
    const model = typeof modelId === 'string' ? modelId.trim() : '';
    if (!model) return current;
    const listed = current.some((entry) => entry.model === model);
    return normalizeBatch(listed
        ? current.map((entry) => (entry.model === model ? { model, count: entry.count + 1 } : entry))
        : [...current, { model, count: 1 }]);
}

export function setBatchCount(list, modelId, count) {
    return normalizeBatch(normalizeBatch(list).map((entry) => (entry.model === modelId ? { model: entry.model, count } : entry)));
}

export function removeFromBatch(list, modelId) {
    return normalizeBatch(list).filter((entry) => entry.model !== modelId);
}

export function batchTotal(list) {
    return normalizeBatch(list).reduce((sum, entry) => sum + entry.count, 0);
}

export function expandImageJobs(list, fallbackModel) {
    const entries = normalizeBatch(list);
    if (entries.length === 0) return [fallbackModel];
    return entries.flatMap(({ model, count }) => Array(count).fill(model));
}
