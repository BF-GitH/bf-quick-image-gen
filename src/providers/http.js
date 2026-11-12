// HTTP and image-byte helpers shared by both providers. PURE: no host access, fetch is injectable.

export class ProviderError extends Error {
    constructor(message, { status = 0, provider = '', code = '' } = {}) {
        super(message);
        this.name = 'ProviderError';
        this.status = status;
        this.provider = provider;
        this.code = code;
    }
}

function prefixed(provider, text) {
    return provider ? `${provider}: ${text}` : text;
}

function abortError() {
    return new DOMException('The operation was aborted.', 'AbortError');
}

// Providers sometimes echo request data back; make sure a bearer token can never leak into a message.
function redact(text, headers) {
    const auth = headers?.Authorization ?? headers?.authorization;
    if (typeof auth !== 'string') return text;
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return text;
    return text.split(auth).join('[redacted]').split(token).join('[redacted]');
}

// Runs fn(signal) under one internal controller that merges the caller signal and a timeout.
// AbortSignal.any is avoided on purpose: older Android WebViews lack it.
async function withAbort(fn, { signal, timeoutMs, provider }) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        return await fn(controller.signal);
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut) {
            throw new ProviderError(prefixed(provider, `Zeitüberschreitung nach ${timeoutMs / 1000} s`), {
                provider,
                code: 'timeout',
            });
        }
        if (signal?.aborted || error?.name === 'AbortError') throw abortError();
        const reason = error?.message || String(error);
        throw new ProviderError(prefixed(provider, `Netzwerkfehler (${reason})`), { provider, code: 'network' });
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCallerAbort);
    }
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function errorDetails(json, text) {
    const err = json?.error;
    let message;
    if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) message = err.message;
    else if (typeof err === 'string' && err) message = err;
    else if (typeof json?.message === 'string' && json.message) message = json.message;
    else if (typeof json?.detail === 'string' && json.detail) message = json.detail;
    else message = String(text ?? '').slice(0, 200);
    const code = err && typeof err === 'object' ? (err.code ?? '') : '';
    return { message, code };
}

function hasErrorMember(json) {
    return json !== null && typeof json === 'object' && !Array.isArray(json)
        && json.error !== undefined && json.error !== null && json.error !== false;
}

export async function requestJson(url, {
    method = 'GET', headers, body, signal, timeoutMs = 180000, fetchImpl = fetch, provider = '',
} = {}) {
    return withAbort(async (innerSignal) => {
        const init = { method, headers, signal: innerSignal };
        if (body !== undefined) init.body = JSON.stringify(body);
        const response = await fetchImpl(url, init);
        const text = await response.text();
        const json = tryParseJson(text);
        if (!response.ok || hasErrorMember(json)) {
            const { message, code } = errorDetails(json, text);
            const shown = message || response.statusText || 'unbekannter Fehler';
            throw new ProviderError(redact(prefixed(provider, `${response.status} – ${shown}`), headers), {
                status: response.status,
                provider,
                code,
            });
        }
        if (json === undefined) {
            throw new ProviderError(prefixed(provider, `${response.status} – ungültige JSON-Antwort`), {
                status: response.status,
                provider,
                code: 'invalid_json',
            });
        }
        return json;
    }, { signal, timeoutMs, provider });
}

export async function fetchImageAsBase64(url, { signal, timeoutMs = 60000, fetchImpl = fetch } = {}) {
    return withAbort(async (innerSignal) => {
        const response = await fetchImpl(url, { signal: innerSignal });
        if (!response.ok) {
            throw new ProviderError(`Bild-Download fehlgeschlagen (HTTP ${response.status})`, {
                status: response.status,
                code: 'download',
            });
        }
        const base64 = arrayBufferToBase64(await response.arrayBuffer());
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        return { base64, mime: type.startsWith('image/') ? type : sniffImageMime(base64) };
    }, { signal, timeoutMs, provider: '' });
}

export function parseDataUrl(text) {
    if (typeof text !== 'string') return null;
    const match = /^data:([^;,]*)((?:;[^;,]*)*);base64,([\s\S]*)$/i.exec(text.trim());
    if (!match) return null;
    const base64 = match[3].replace(/\s+/g, '');
    if (!base64) return null;
    const mime = match[1].toLowerCase();
    return { base64, mime: mime.startsWith('image/') ? mime : sniffImageMime(base64) };
}

function startsWith(bytes, signature, offset = 0) {
    return signature.every((value, i) => bytes.charCodeAt(offset + i) === value);
}

export function sniffImageMime(base64) {
    let bytes;
    try {
        // 344 base64 chars = 258 bytes: enough to find "<svg" behind leading whitespace or a short preamble.
        bytes = atob(String(base64 ?? '').replace(/\s+/g, '').slice(0, 344));
    } catch {
        return 'image/png';
    }
    if (/^\s*<(svg|\?xml)/i.test(bytes)) return 'image/svg+xml';
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    return 'image/png';
}

export function extensionForMime(mime) {
    const type = String(mime ?? '').toLowerCase().split(';')[0].trim();
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/gif') return 'gif';
    return 'png';
}

export function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    // Chunked because String.fromCharCode(...bigArray) overflows the call stack on multi-MB images.
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

// The upload stores bytes under a raster extension, so SVG or anything else would become a broken file.
function ensureRaster(result, label) {
    const type = String(result.mime ?? '').toLowerCase().split(';')[0].trim();
    if (RASTER_MIMES.has(type) && sniffImageMime(result.base64) !== 'image/svg+xml') return result;
    const shown = RASTER_MIMES.has(type) ? 'image/svg+xml' : type || 'unbekannt';
    throw new ProviderError(`${label}: Bildformat wird nicht unterstützt (${shown})`, { provider: label, code: 'unsupported_format' });
}

// Shared response handling for both image APIs (spec 5.10 "Response").
export async function extractImage(json, { label, allowTopLevelImage = false, signal, fetchImpl = fetch }) {
    const entry = Array.isArray(json?.data) ? json.data[0] : undefined;
    if (typeof entry?.b64_json === 'string' && entry.b64_json) {
        const base64 = entry.b64_json.replace(/\s+/g, '');
        return ensureRaster({ base64, mime: entry.media_type ?? sniffImageMime(base64) }, label);
    }
    if (typeof entry?.url === 'string' && entry.url) {
        const inline = parseDataUrl(entry.url);
        if (inline) return ensureRaster(inline, label);
        let downloaded;
        try {
            downloaded = await fetchImageAsBase64(entry.url, { signal, fetchImpl });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            // Typically CORS on the signed storage host: the image still exists, so hand out the link.
            return { remoteUrl: entry.url };
        }
        return ensureRaster(downloaded, label);
    }
    if (allowTopLevelImage && typeof json?.image === 'string' && json.image) {
        const inline = parseDataUrl(json.image);
        if (inline) return ensureRaster(inline, label);
        const base64 = json.image.replace(/\s+/g, '');
        return ensureRaster({ base64, mime: sniffImageMime(base64) }, label);
    }
    throw new ProviderError(`${label}: Antwort enthält kein Bild`, { provider: label, code: 'no_image' });
}

export function truncatePrompt(prompt, maxChars) {
    const text = String(prompt ?? '');
    if (text.length <= maxChars) return text;
    let cut = text.slice(0, maxChars);
    // Never leave half a surrogate pair at the end: providers reject invalid UTF-16.
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return cut;
}
