// Model lists change rarely and the phone may be offline: memory first, then a 7-day localStorage cache.

import { getProvider } from '../providers/index.js';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const memory = new Map();
const pending = new Map();

function storageKey(providerId) {
    return `bfqig_models_${providerId}`;
}

function readCache(providerId) {
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey(providerId)) ?? 'null');
        if (parsed && Number.isFinite(parsed.timestamp) && Array.isArray(parsed.models)) return parsed;
    } catch {
        // Corrupt or blocked storage behaves like an empty cache.
    }
    return null;
}

function writeCache(providerId, models) {
    try {
        localStorage.setItem(storageKey(providerId), JSON.stringify({ timestamp: Date.now(), models }));
    } catch {
        // Quota or blocked storage: the memory cache still works for this session.
    }
}

async function fetchModels(providerId, cached) {
    try {
        const models = await getProvider(providerId).listModels();
        memory.set(providerId, models);
        writeCache(providerId, models);
        return models;
    } catch (error) {
        const stale = memory.get(providerId) ?? cached?.models;
        if (stale) return stale;
        throw error;
    }
}

export async function getModels(providerId, { force = false } = {}) {
    if (!force && memory.has(providerId)) return memory.get(providerId);
    const cached = readCache(providerId);
    if (!force && cached && Date.now() - cached.timestamp < MAX_AGE_MS) {
        memory.set(providerId, cached.models);
        return cached.models;
    }
    // Panel mount and a generation can ask at the same time; share one request.
    if (pending.has(providerId)) return pending.get(providerId);
    const request = fetchModels(providerId, cached).finally(() => pending.delete(providerId));
    pending.set(providerId, request);
    return request;
}

export async function getModelInfo(providerId, modelId) {
    try {
        const models = await getModels(providerId);
        return models.find((model) => model.id === modelId) ?? null;
    } catch {
        return null;
    }
}
