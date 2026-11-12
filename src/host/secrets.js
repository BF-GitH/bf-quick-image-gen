// Reads provider keys the host app has stored. Never throws and never logs a key value:
// the result feeds a settings hint and the provider call, nothing else.

import { postApi } from './st.js';

async function postJson(path, body) {
    try {
        const response = await postApi(path, body);
        return response.ok ? await response.json() : null;
    } catch {
        return null;
    }
}

// -> true | false | null (the host did not say)
async function isExposureAllowed() {
    const data = await postJson('/api/secrets/settings', {});
    return typeof data?.allowKeysExposure === 'boolean' ? data.allowKeysExposure : null;
}

// -> true | false | null (the host did not say)
async function isKeyStored(secretKey) {
    const state = await postJson('/api/secrets/read', {});
    if (!state || typeof state !== 'object') return null;
    const entry = state[secretKey];
    return entry === true || (Array.isArray(entry) && entry.length > 0);
}

async function findKey(secretKey) {
    const data = await postJson('/api/secrets/find', { key: secretKey });
    const value = typeof data?.value === 'string' ? data.value.trim() : '';
    return value || null;
}

// TauriTavern shows a red "Backend Error" toast for every find it refuses (keys exposure off) or cannot
// answer (no key stored), so the key itself is asked for only when the two cheap questions say it can work.
async function inspectKey(secretKey) {
    const [allowed, stored] = await Promise.all([isExposureAllowed(), isKeyStored(secretKey)]);
    if (stored === false) return { state: 'missing', value: null };
    if (allowed === false) return { state: 'locked', value: null };
    const value = await findKey(secretKey);
    if (value) return { state: 'readable', value };
    return { state: stored ? 'locked' : 'missing', value: null };
}

export async function readStoredKey(secretKey) {
    try {
        return (await inspectKey(secretKey)).value;
    } catch {
        return null;
    }
}

export async function getStoredKeyState(secretKey) {
    try {
        return (await inspectKey(secretKey)).state;
    } catch {
        return 'missing';
    }
}
