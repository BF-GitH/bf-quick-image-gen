// Provider registry (spec 5.11). PURE.
import * as nanogpt from './nanogpt.js';
import * as openrouter from './openrouter.js';

export const PROVIDERS = Object.freeze({ nanogpt, openrouter });

export function getProvider(id) {
    if (typeof id === 'string' && Object.hasOwn(PROVIDERS, id)) return PROVIDERS[id];
    throw new Error(`Unbekannter Anbieter: ${id}`);
}
