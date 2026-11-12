// Key resolution order: own key from the settings, then the key stored in the host app.

import { readStoredKey, getStoredKeyState } from '../host/secrets.js';
import { getSettings } from './store.js';

export const KEY_STATE_MESSAGES = Object.freeze({
    own: 'Eigener Key wird verwendet.',
    readable: 'Der in der App gespeicherte Key wird verwendet.',
    locked: 'In der App ist ein Key gespeichert, aber für Erweiterungen gesperrt. Entweder in TauriTavern unter Einstellungen → Misc „Allow Keys Exposure“ einschalten und die App neu starten, oder den Key hier eintragen.',
    missing: 'Kein Key gefunden. Key hier eintragen oder in der App bei den API-Verbindungen speichern.',
});

function ownKey(provider) {
    return String(getSettings().keys?.[provider.id] ?? '').trim();
}

export async function resolveApiKey(provider) {
    const own = ownKey(provider);
    if (own) return own;
    const stored = await readStoredKey(provider.secretKey);
    if (stored) return stored;
    const state = await getStoredKeyState(provider.secretKey);
    // 'readable' here means find() failed in between; treating it as missing tells the user what to do.
    throw new Error(state === 'locked' ? KEY_STATE_MESSAGES.locked : KEY_STATE_MESSAGES.missing);
}

export async function describeKeyState(provider) {
    if (ownKey(provider)) return { state: 'own', message: KEY_STATE_MESSAGES.own };
    const state = await getStoredKeyState(provider.secretKey);
    const known = Object.hasOwn(KEY_STATE_MESSAGES, state) ? state : 'missing';
    return { state: known, message: KEY_STATE_MESSAGES[known] };
}
