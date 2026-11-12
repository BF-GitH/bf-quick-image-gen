// NanoGPT dedicated image API (spec 5.10). PURE.
import { DEFAULT_MODELS, SECRET_KEYS } from '../shared/constants.js';
import { ProviderError, extractImage, requestJson, truncatePrompt } from './http.js';
import { selectNanoGptSize } from './sizing.js';

export const id = 'nanogpt';
export const label = 'NanoGPT';
export const secretKey = SECRET_KEYS.nanogpt;
export const defaultModel = DEFAULT_MODELS.nanogpt;
export const MODELS_URL = 'https://nano-gpt.com/api/v1/images/models';
export const GENERATE_URL = 'https://nano-gpt.com/api/v1/images';

const DEFAULT_PROMPT_CHARS = 4000;
const TIMEOUT_MS = 180000;
// Edit-only, upscaler and background-removal entries need an input image, which we never send.
const NON_GENERATIVE_RE = /(^|[/-])edit([/-]|$)|upscal|eras|remov|inpaint/i;

function keepModel(model) {
    return typeof model?.id === 'string'
        && Array.isArray(model.architecture?.input_modalities)
        && model.architecture.input_modalities.includes('text')
        && model.capabilities?.image_generation !== false
        && !NON_GENERATIVE_RE.test(model.id);
}

function minPrice(perImage) {
    if (!perImage || typeof perImage !== 'object') return null;
    const prices = Object.values(perImage).filter((value) => typeof value === 'number' && Number.isFinite(value));
    return prices.length > 0 ? Math.min(...prices) : null;
}

function toModelInfo(model) {
    const supported = model.supported_parameters && typeof model.supported_parameters === 'object'
        ? model.supported_parameters
        : {};
    const maxChars = supported.max_prompt_characters;
    return {
        id: model.id,
        name: typeof model.name === 'string' && model.name ? model.name : model.id,
        supported,
        maxPromptChars: typeof maxChars === 'number' && maxChars > 0 ? maxChars : null,
        pricePerImage: minPrice(model.pricing?.per_image),
        nsfw: typeof model.capabilities?.nsfw === 'boolean' ? model.capabilities.nsfw : null,
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
    const size = selectNanoGptSize(modelInfo?.supported ?? {}, aspect, quality);
    return { url: GENERATE_URL, body: { model, prompt: text, n: 1, ...size } };
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
    return extractImage(json, { label, allowTopLevelImage: true, signal, fetchImpl });
}
