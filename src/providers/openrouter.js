// OpenRouter dedicated image API (spec 5.10). PURE.
import { DEFAULT_MODELS, SECRET_KEYS } from '../shared/constants.js';
import {
    ProviderError, buildChatBody, extractImage, normalizeTextModels, requestChatText, requestJson, truncatePrompt,
} from './http.js';
import { selectOpenRouterSize } from './sizing.js';

export const id = 'openrouter';
export const label = 'OpenRouter';
export const secretKey = SECRET_KEYS.openrouter;
export const defaultModel = DEFAULT_MODELS.openrouter;
export const MODELS_URL = 'https://openrouter.ai/api/v1/images/models';
export const GENERATE_URL = 'https://openrouter.ai/api/v1/images';
export const TEXT_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_PROMPT_CHARS = 4000;
const TIMEOUT_MS = 180000;

// SVG-only models cannot be stored as a raster image.
function isVectorOnly(model) {
    const formats = model.supported_parameters?.output_format?.values;
    return Array.isArray(formats) && formats.length > 0 && formats.every((value) => value === 'svg');
}

// Models that require at least one reference image cannot do plain text-to-image.
function keepModel(model) {
    return typeof model?.id === 'string'
        && Array.isArray(model.architecture?.output_modalities)
        && model.architecture.output_modalities.includes('image')
        && (model.supported_parameters?.input_references?.min ?? 0) < 1
        && !isVectorOnly(model);
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
        prices: null,
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

export function maxReferenceImages(modelInfo) {
    const max = modelInfo?.supported?.input_references?.max;
    return typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
}

// The request field mirrors NanoGPT's; for OpenRouter it is taken from the docs and unverified.
export function buildRequest({ model, prompt, aspect, quality, modelInfo, references }) {
    const text = truncatePrompt(prompt, modelInfo?.maxPromptChars ?? DEFAULT_PROMPT_CHARS);
    const size = selectOpenRouterSize(modelInfo?.supported ?? {}, aspect, quality);
    const body = { model, prompt: text, ...size };
    const refs = Array.isArray(references) ? references.slice(0, maxReferenceImages(modelInfo)) : [];
    if (refs.length > 0) body.input_references = refs;
    return { url: GENERATE_URL, body };
}

export async function generateImage({ apiKey, model, prompt, aspect, quality, modelInfo, references, signal, fetchImpl }) {
    if (!apiKey) throw new ProviderError(`${label}: Kein API-Key`, { provider: label, code: 'no_key' });
    const { url, body } = buildRequest({ model, prompt, aspect, quality, modelInfo, references });
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

export { normalizeTextModels };

export async function listTextModels({ signal, fetchImpl } = {}) {
    const json = await requestJson(TEXT_MODELS_URL, { signal, fetchImpl, provider: label });
    return normalizeTextModels(json);
}

export function buildChatRequest({ model, systemPrompt, prompt, maxTokens }) {
    return { url: CHAT_URL, body: buildChatBody({ model, systemPrompt, prompt, maxTokens }) };
}

export async function generateText({ apiKey, model, systemPrompt, prompt, maxTokens, signal, fetchImpl }) {
    const { url, body } = buildChatRequest({ model, systemPrompt, prompt, maxTokens });
    return requestChatText(url, { apiKey, body, signal, fetchImpl, provider: label });
}
