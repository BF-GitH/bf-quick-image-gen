// OpenRouter dedicated image API (spec 5.10). PURE.
import { DEFAULT_MODELS, SECRET_KEYS } from '../shared/constants.js';
import { ProviderError, extractImage, requestJson, truncatePrompt } from './http.js';
import { selectOpenRouterSize } from './sizing.js';

export const id = 'openrouter';
export const label = 'OpenRouter';
export const secretKey = SECRET_KEYS.openrouter;
export const defaultModel = DEFAULT_MODELS.openrouter;
export const MODELS_URL = 'https://openrouter.ai/api/v1/images/models';
export const GENERATE_URL = 'https://openrouter.ai/api/v1/images';

const DEFAULT_PROMPT_CHARS = 4000;
const TIMEOUT_MS = 180000;

// Models that require at least one reference image cannot do plain text-to-image.
function keepModel(model) {
    return typeof model?.id === 'string'
        && Array.isArray(model.architecture?.output_modalities)
        && model.architecture.output_modalities.includes('image')
        && (model.supported_parameters?.input_references?.min ?? 0) < 1;
}

function toModelInfo(model) {
    const supported = model.supported_parameters && typeof model.supported_parameters === 'object'
        ? model.supported_parameters
        : {};
    return {
        id: model.id,
        name: typeof model.name === 'string' && model.name ? model.name : model.id,
        supported,
        maxPromptChars: null,
        pricePerImage: null,
        nsfw: null,
    };
}

export function normalizeModels(json) {
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    return list.filter(keepModel).map(toModelInfo).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listModels({ signal, fetchImpl } = {}) {
    const json = await requestJson(MODELS_URL, { signal, fetchImpl, provider: label });
    return normalizeModels(json);
}

export function buildRequest({ model, prompt, aspect, quality, modelInfo }) {
    const text = truncatePrompt(prompt, modelInfo?.maxPromptChars ?? DEFAULT_PROMPT_CHARS);
    const size = selectOpenRouterSize(modelInfo?.supported ?? {}, aspect, quality);
    return { url: GENERATE_URL, body: { model, prompt: text, ...size } };
}

export async function generateImage({ apiKey, model, prompt, aspect, quality, modelInfo, signal, fetchImpl }) {
    if (!apiKey) throw new ProviderError(`${label}: Kein API-Key`, { provider: label, code: 'no_key' });
    const { url, body } = buildRequest({ model, prompt, aspect, quality, modelInfo });
    const json = await requestJson(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal,
        timeoutMs: TIMEOUT_MS,
        fetchImpl,
        provider: label,
    });
    return extractImage(json, { label, signal, fetchImpl });
}
