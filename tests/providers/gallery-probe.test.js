import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nanogpt from '../../src/providers/nanogpt.js';
import * as openrouter from '../../src/providers/openrouter.js';
import { ProviderError } from '../../src/providers/http.js';

const LIST_URL = 'https://nano-gpt.com/api/gallery/media?limit=1';
const PICTURE_URL = 'https://storage.example/picture-1.png';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EMPTY = { list: null, status: null, reason: null, download: null, downloadStatus: null, downloadReason: null };

// Shape as measured on 2026-11-13 (spec 22), with a second picture that must never be fetched.
const GALLERY = {
    items: [{
        id: 'item-1',
        model: 'some-model',
        createdAt: '2026-11-13T10:00:00Z',
        mediaGeneration: { requestId: 'req-1', status: 'completed', images: [{ url: PICTURE_URL }, { url: 'https://storage.example/other.png' }] },
    }],
};

function fakeFetch(respond) {
    const calls = [];
    const impl = async (url, init = {}) => {
        calls.push({ url, init });
        return respond(url, init);
    };
    impl.calls = calls;
    return impl;
}

function picture() {
    return new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } });
}

test('GALLERY_URL is exported and OpenRouter has no probe', () => {
    assert.equal(nanogpt.GALLERY_URL, 'https://nano-gpt.com/api/gallery/media');
    assert.equal('probeGallery' in openrouter, false);
});

test('probeGallery without a key throws no_key and sends nothing', async () => {
    const fetchImpl = fakeFetch(() => Response.json(GALLERY));
    for (const apiKey of ['', undefined]) {
        await assert.rejects(
            nanogpt.probeGallery({ apiKey, fetchImpl }),
            (error) => error instanceof ProviderError && error.code === 'no_key' && error.message === 'NanoGPT: Kein API-Key',
        );
    }
    assert.equal(fetchImpl.calls.length, 0);
});

test('probeGallery list ok + download ok returns outcome fields only', async () => {
    const fetchImpl = fakeFetch((url) => (url === LIST_URL ? Response.json(GALLERY) : picture()));
    const outcome = await nanogpt.probeGallery({ apiKey: 'k-test', fetchImpl });
    assert.deepEqual(outcome, { ...EMPTY, list: 'ok', download: 'ok' });
    assert.equal(fetchImpl.calls.length, 2);
    const [list, download] = fetchImpl.calls;
    assert.equal(list.url, LIST_URL);
    assert.equal(list.init.method, 'GET');
    assert.equal(list.init.headers.Authorization, 'Bearer k-test');
    assert.equal(download.url, PICTURE_URL);
    assert.equal(download.init.headers, undefined);
});

test('probeGallery list blocked: rejected fetch, step 2 not run', async () => {
    const fetchImpl = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const outcome = await nanogpt.probeGallery({ apiKey: 'k', fetchImpl });
    assert.deepEqual(outcome, { ...EMPTY, list: 'blocked', reason: 'NanoGPT: Netzwerkfehler (Failed to fetch)' });
    assert.equal(fetchImpl.calls.length, 1);
});

test('probeGallery list refused: http 401 carries the status, no step 2', async () => {
    const fetchImpl = fakeFetch(() => Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const outcome = await nanogpt.probeGallery({ apiKey: 'k', fetchImpl });
    assert.deepEqual(outcome, { ...EMPTY, list: 'refused', status: 401, reason: 'NanoGPT: 401 – Unauthorized' });
    assert.equal(fetchImpl.calls.length, 1);
});

test('probeGallery answer without an items array is refused without a status', async () => {
    for (const answer of [{}, { items: 'x' }, { data: [] }]) {
        const fetchImpl = fakeFetch(() => Response.json(answer));
        const outcome = await nanogpt.probeGallery({ apiKey: 'k', fetchImpl });
        assert.equal(outcome.list, 'refused');
        assert.equal(outcome.status, null);
        assert.equal(typeof outcome.reason, 'string');
        assert.equal(outcome.download, null);
        assert.equal(fetchImpl.calls.length, 1);
    }
});

test('probeGallery empty gallery or no picture address -> download none', async () => {
    const answers = [
        { items: [] },
        { items: [{ mediaGeneration: { images: [] } }] },
        { items: [{ mediaGeneration: { images: [{ url: 42 }] } }] },
        { items: [{ id: 'x' }] },
    ];
    for (const answer of answers) {
        const fetchImpl = fakeFetch(() => Response.json(answer));
        assert.deepEqual(await nanogpt.probeGallery({ apiKey: 'k', fetchImpl }), { ...EMPTY, list: 'ok', download: 'none' });
        assert.equal(fetchImpl.calls.length, 1);
    }
});

test('probeGallery download blocked: rejected picture fetch', async () => {
    const fetchImpl = fakeFetch((url) => (url === LIST_URL ? Response.json(GALLERY) : Promise.reject(new TypeError('Failed to fetch'))));
    const outcome = await nanogpt.probeGallery({ apiKey: 'k', fetchImpl });
    assert.deepEqual(outcome, { ...EMPTY, list: 'ok', download: 'blocked', downloadReason: 'Netzwerkfehler (Failed to fetch)' });
});

test('probeGallery download refused: http 403 carries the status', async () => {
    const fetchImpl = fakeFetch((url) => (url === LIST_URL ? Response.json(GALLERY) : new Response('no', { status: 403 })));
    const outcome = await nanogpt.probeGallery({ apiKey: 'k', fetchImpl });
    assert.deepEqual(outcome, {
        ...EMPTY,
        list: 'ok',
        download: 'refused',
        downloadStatus: 403,
        downloadReason: 'Bild-Download fehlgeschlagen (HTTP 403)',
    });
});

test('probeGallery throws an abort on', async () => {
    const before = new AbortController();
    before.abort();
    const unused = fakeFetch(() => Response.json(GALLERY));
    await assert.rejects(nanogpt.probeGallery({ apiKey: 'k', signal: before.signal, fetchImpl: unused }), { name: 'AbortError' });
    assert.equal(unused.calls.length, 0);

    const during = new AbortController();
    const fetchImpl = fakeFetch((url) => {
        if (url === LIST_URL) return Response.json(GALLERY);
        during.abort();
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
    await assert.rejects(nanogpt.probeGallery({ apiKey: 'k', signal: during.signal, fetchImpl }), { name: 'AbortError' });
    assert.equal(fetchImpl.calls.length, 2);
});
