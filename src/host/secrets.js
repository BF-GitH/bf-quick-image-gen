// Reads provider keys the host app has stored. Never throws and never logs a key value:
// the result feeds a settings hint and the provider call, nothing else.

import { postApi } from './st.js';

export async function readStoredKey(secretKey) {
    try {
        // Both hosts refuse (403/404/500) unless "Allow Keys Exposure" is on; that is a normal outcome.
        const response = await postApi('/api/secrets/find', { key: secretKey });
        if (!response.ok) return null;
        const data = await response.json();
        const value = typeof data?.value === 'string' ? data.value.trim() : '';
        return value || null;
    } catch {
        return null;
    }
}

async function hasStoredKey(secretKey) {
    try {
        const response = await postApi('/api/secrets/read', {});
        if (!response.ok) return false;
        const state = await response.json();
        const entry = state?.[secretKey];
        return entry === true || (Array.isArray(entry) && entry.length > 0);
    } catch {
        return false;
    }
}

export async function getStoredKeyState(secretKey) {
    try {
        if (await readStoredKey(secretKey)) return 'readable';
        return (await hasStoredKey(secretKey)) ? 'locked' : 'missing';
    } catch {
        return 'missing';
    }
}
