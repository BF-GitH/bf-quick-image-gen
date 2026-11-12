import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ProviderError, arrayBufferToBase64, extensionForMime, fetchImageAsBase64, parseDataUrl, requestJson, sniffImageMime,
} from '../../src/providers/http.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = b64([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0]);
const WEBP = b64([...Buffer.from('RIFF'), 0x24, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);

// Fake fetch that honours the abort signal like the real one, but never resolves on its own.
function hangingFetch() {
    return (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
}

test('sniffImageMime recognises magic bytes', () => {
    assert.equal(sniffImageMime(PNG), 'image/png');
    assert.equal(sniffImageMime(JPEG), 'image/jpeg');
    assert.equal(sniffImageMime(GIF), 'image/gif');
    assert.equal(sniffImageMime(WEBP), 'image/webp');
    assert.equal(sniffImageMime(b64([1, 2, 3, 4, 5, 6])), 'image/png');
    assert.equal(sniffImageMime('!!not base64!!'), 'image/png');
    assert.equal(sniffImageMime(b64([...Buffer.from(' \r\n\t<svg xmlns="http://www.w3.org/2000/svg"/>')])), 'image/svg+xml');
    assert.equal(sniffImageMime(b64([...Buffer.from('<?xml version="1.0"?><svg/>')])), 'image/svg+xml');
});

test('extensionForMime', () => {
    assert.equal(extensionForMime('image/png'), 'png');
    assert.equal(extensionForMime('image/jpeg'), 'jpg');
    assert.equal(extensionForMime('image/webp'), 'webp');
    assert.equal(extensionForMime('image/gif'), 'gif');
    assert.equal(extensionForMime('application/octet-stream'), 'png');
    assert.equal(extensionForMime(undefined), 'png');
});

test('parseDataUrl', () => {
    assert.deepEqual(parseDataUrl(`data:image/jpeg;base64,${JPEG}`), { base64: JPEG, mime: 'image/jpeg' });
    assert.deepEqual(parseDataUrl(`data:;base64,${WEBP}`), { base64: WEBP, mime: 'image/webp' });
    assert.equal(parseDataUrl('https://example.com/a.png'), null);
    assert.equal(parseDataUrl('data:image/png,rawtext'), null);
    assert.equal(parseDataUrl(null), null);
});

test('arrayBufferToBase64 round trip including a multi-chunk buffer', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 31) % 256);
    const encoded = arrayBufferToBase64(bytes.buffer);
    assert.deepEqual(new Uint8Array(Buffer.from(encoded, 'base64')), bytes);
    assert.equal(arrayBufferToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), 'iVBORw==');
});

test('requestJson sends JSON and parses the reply', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
        seen = { url, init };
        return Response.json({ ok: 1 });
    };
    const json = await requestJson('https://x.test/a', { method: 'POST', body: { a: 1 }, fetchImpl, provider: 'P' });
    assert.deepEqual(json, { ok: 1 });
    assert.equal(seen.init.body, '{"a":1}');
    assert.equal(seen.init.method, 'POST');
});

test('requestJson error message priority and code', async () => {
    const cases = [
        [{ error: { message: 'm1', code: 'c1' }, message: 'x' }, 'P: 400 – m1', 'c1'],
        [{ error: 'plain', message: 'x' }, 'P: 400 – plain', ''],
        [{ error: 503, message: 'from message' }, 'P: 400 – from message', ''],
        [{ detail: 'from detail' }, 'P: 400 – from detail', ''],
    ];
    for (const [body, message, code] of cases) {
        const fetchImpl = async () => Response.json(body, { status: 400 });
        await assert.rejects(requestJson('u', { fetchImpl, provider: 'P' }), (err) => {
            assert.ok(err instanceof ProviderError);
            assert.equal(err.message, message);
            assert.equal(err.code, code);
            assert.equal(err.status, 400);
            return true;
        });
    }
    const long = 'z'.repeat(500);
    const fetchImpl = async () => new Response(long, { status: 502 });
    await assert.rejects(requestJson('u', { fetchImpl, provider: 'P' }), { message: `P: 502 – ${'z'.repeat(200)}` });
});

test('requestJson treats a 2xx body with an error member as failure', async () => {
    const fetchImpl = async () => Response.json({ error: { message: 'quota', code: 'q' } }, { status: 200 });
    await assert.rejects(requestJson('u', { fetchImpl, provider: 'P' }), {
        name: 'ProviderError', message: 'P: 200 – quota', status: 200, code: 'q',
    });
});

test('requestJson timeout', async () => {
    await assert.rejects(requestJson('u', { fetchImpl: hangingFetch(), timeoutMs: 20, provider: 'P' }), {
        name: 'ProviderError', message: 'P: Zeitüberschreitung nach 0.02 s', code: 'timeout',
    });
});

test('requestJson rethrows a caller abort as AbortError', async () => {
    const controller = new AbortController();
    const pending = requestJson('u', { fetchImpl: hangingFetch(), signal: controller.signal, provider: 'P' });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, (err) => {
        assert.ok(!(err instanceof ProviderError));
        assert.equal(err.name, 'AbortError');
        assert.ok(err instanceof DOMException);
        return true;
    });
    const already = new AbortController();
    already.abort();
    await assert.rejects(requestJson('u', { fetchImpl: hangingFetch(), signal: already.signal }), { name: 'AbortError' });
});

test('requestJson network failure', async () => {
    const fetchImpl = async () => {
        throw new TypeError('Failed to fetch');
    };
    await assert.rejects(requestJson('u', { fetchImpl, provider: 'P' }), {
        name: 'ProviderError', message: 'P: Netzwerkfehler (Failed to fetch)', code: 'network',
    });
});

test('the Authorization value never appears in an error message', async () => {
    const headers = { Authorization: 'Bearer sk-secret-123', 'Content-Type': 'application/json' };
    const echo = async (_url, init) => Response.json(
        { error: { message: `bad key ${init.headers.Authorization} / sk-secret-123` } }, { status: 401 });
    await assert.rejects(requestJson('u', { headers, fetchImpl: echo, provider: 'P' }), (err) => {
        assert.ok(!err.message.includes('sk-secret-123'), err.message);
        assert.match(err.message, /^P: 401 – bad key/);
        return true;
    });
    const netFail = async () => {
        throw new TypeError('boom');
    };
    await assert.rejects(requestJson('u', { headers, fetchImpl: netFail, provider: 'P' }), (err) => {
        assert.ok(!err.message.includes('sk-secret-123'));
        return true;
    });
});

test('fetchImageAsBase64 uses content-type, sniffs otherwise, fails on non-2xx', async () => {
    const bytes = Buffer.from(JPEG, 'base64');
    const typed = async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg; charset=binary' } });
    assert.deepEqual(await fetchImageAsBase64('u', { fetchImpl: typed }), { base64: JPEG, mime: 'image/jpeg' });
    const untyped = async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
    assert.deepEqual(await fetchImageAsBase64('u', { fetchImpl: untyped }), { base64: JPEG, mime: 'image/jpeg' });
    const missing = async () => new Response('nope', { status: 404 });
    await assert.rejects(fetchImageAsBase64('u', { fetchImpl: missing }), { name: 'ProviderError', status: 404 });
});
