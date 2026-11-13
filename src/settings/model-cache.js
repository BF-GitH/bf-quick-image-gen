// Model lists change rarely and the phone may be offline: memory first, then a 7-day localStorage cache.

import { getProvider } from '../providers/index.js';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// The cache holds the filtered, normalized list. Bump this whenever the list filters or the ModelInfo shape
// change, otherwise a list built by older code (wrong models, missing fields) stays in use for a week.
const CACHE_VERSION = 2;
const TEXT_CACHE_VERSION = 1;

// Image models and text models (spec 19.2) follow the same rules with their own key and memory maps.
const IMAGE_LISTS = {
    memory: new Map(),
    pending: new Map(),
    storageKey: (providerId) => `bfqig_models_v${CACHE_VERSION}_${providerId}`,
    // Version 1 used an unversioned key; remove it so the old list does not keep occupying storage.
    legacyKey: (providerId) => `bfqig_models_${providerId}`,
    load: (providerId) => getProvider(providerId).listModels(),
};
const TEXT_LISTS = {
    memory: new Map(),
    pending: new Map(),
    storageKey: (providerId) => `bfqig_textmodels_v${TEXT_CACHE_VERSION}_${providerId}`,
    legacyKey: null,
    load: (providerId) => getProvider(providerId).listTextModels(),
};

function readCache(lists, providerId) {
    try {
        const parsed = JSON.parse(localStorage.getItem(lists.storageKey(providerId)) ?? 'null');
        if (parsed && Number.isFinite(parsed.timestamp) && Array.isArray(parsed.models)) return parsed;
    } catch {
        // Corrupt or blocked storage behaves like an empty cache.
    }
    return null;
}

function writeCache(lists, providerId, models) {
    try {
        if (lists.legacyKey) localStorage.removeItem(lists.legacyKey(providerId));
        localStorage.setItem(lists.storageKey(providerId), JSON.stringify({ timestamp: Date.now(), models }));
    } catch {
        // Quota or blocked storage: the memory cache still works for this session.
    }
}

async function fetchModels(lists, providerId, cached) {
    try {
        const models = await lists.load(providerId);
        lists.memory.set(providerId, models);
        writeCache(lists, providerId, models);
        return models;
    } catch (error) {
        const stale = lists.memory.get(providerId) ?? cached?.models;
        if (stale) return stale;
        throw error;
    }
}

async function getList(lists, providerId, force) {
    if (!force && lists.memory.has(providerId)) return lists.memory.get(providerId);
    const cached = readCache(lists, providerId);
    if (!force && cached && Date.now() - cached.timestamp < MAX_AGE_MS) {
        lists.memory.set(providerId, cached.models);
        return cached.models;
    }
    // Panel mount and a generation can ask at the same time; share one request.
    if (lists.pending.has(providerId)) return lists.pending.get(providerId);
    const request = fetchModels(lists, providerId, cached).finally(() => lists.pending.delete(providerId));
    lists.pending.set(providerId, request);
    return request;
}

export async function getModels(providerId, { force = false } = {}) {
    return getList(IMAGE_LISTS, providerId, force);
}

export async function getTextModels(providerId, { force = false } = {}) {
    return getList(TEXT_LISTS, providerId, force);
}

export async function getModelInfo(providerId, modelId) {
    try {
        const models = await getModels(providerId);
        return models.find((model) => model.id === modelId) ?? null;
    } catch {
        return null;
    }
}
