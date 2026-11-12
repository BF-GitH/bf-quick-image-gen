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
// Edit-only, upscaler, background-removal, reference, layer and segmentation entries need an input image,
// which we never send. Tagless entries (about a third of the list) can only be judged by their id.
const NON_GENERATIVE_RE = /(^|[/-])edit([/-]|$)|upscal|eras|remov|inpaint|image-to-image|(^|[/-])vto([/-]|$)|reference|layeriz|layer-decomposition|sam3/i;
const INPUT_IMAGE_TAGS = new Set([
    'image-edit', 'image-to-image', 'img2img', 'segmentation', 'virtual-try-on', 'upscale',
    'background-removal', 'depth-estimation', 'inpainting', 'outpainting', 'object-removal',
]);
// Vector models answer with SVG, which cannot be stored as a raster image.
const VECTOR_TAGS = new Set(['svg', 'vector', 'text-to-vector']);

function tagsOf(model) {
    return Array.isArray(model.tags) ? model.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.toLowerCase()) : [];
}

function keepModel(model) {
    if (typeof model?.id !== 'string') return false;
    const tags = tagsOf(model);
    // Dual-mode models tagged text-to-image also generate from text alone.
    const needsInputImage = !tags.includes('text-to-image') && tags.some((tag) => INPUT_IMAGE_TAGS.has(tag));
    const isVector = /vector/i.test(model.id) || tags.some((tag) => VECTOR_TAGS.has(tag));
    return Array.isArray(model.architecture?.input_modalities)
        && model.architecture.input_modalities.includes('text')
        && model.capabilities?.image_generation !== false
        && !NON_GENERATIVE_RE.test(model.id)
        && !needsInputImage
        && !isVector;
}

function numericPrices(perImage) {
    if (!perImage || typeof perImage !== 'object') return null;
    const entries = Object.entries(perImage).filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function minPrice(prices) {
    return prices ? Math.min(...Object.values(prices)) : null;
}

function toModelInfo(model) {
    const supported = model.supported_parameters && typeof model.supported_parameters === 'object'
        ? model.supported_parameters
        : {};
    const maxChars = supported.max_prompt_characters;
    const prices = numericPrices(model.pricing?.per_image);
    return {
        id: model.id,
        name: typeof model.name === 'string' && model.name ? model.name : model.id,
        supported,
        maxPromptChars: typeof maxChars === 'number' && maxChars > 0 ? maxChars : null,
        pricePerImage: minPrice(prices),
        prices,
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
