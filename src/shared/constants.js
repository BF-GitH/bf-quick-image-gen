// Shared constants. Pure data: no imports, no host access.

export const EXTENSION_ID = 'bf-quick-image-gen';
export const SETTINGS_KEY = 'bf_quick_image_gen';
export const LOG_PREFIX = '[bf-quick-image-gen]';

export const PROVIDER_IDS = Object.freeze(['nanogpt', 'openrouter']);

// Canonical size setting: an aspect ratio. Providers map it to whatever a model supports.
export const ASPECT_IDS = Object.freeze(['1:1', '2:3', '3:4', '9:16', '3:2', '4:3', '16:9']);
export const QUALITY_IDS = Object.freeze(['standard', 'high']);

export const DEFAULT_MODELS = Object.freeze({
    nanogpt: 'flux-schnell',
    openrouter: 'google/gemini-2.5-flash-image',
});

// Names under which the host app (TauriTavern / SillyTavern) stores the provider keys.
export const SECRET_KEYS = Object.freeze({
    nanogpt: 'api_key_nanogpt',
    openrouter: 'api_key_openrouter',
});
