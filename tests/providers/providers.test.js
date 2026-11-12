import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nanogpt from '../../src/providers/nanogpt.js';
import * as openrouter from '../../src/providers/openrouter.js';
import { PROVIDERS, getProvider } from '../../src/providers/index.js';
import { ProviderError } from '../../src/providers/http.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const NANO_JSON = load('nanogpt-models.sample.json');
const OR_JSON = load('openrouter-models.sample.json');
const NANO = nanogpt.normalizeModels(NANO_JSON);
const OR = openrouter.normalizeModels(OR_JSON);
const nanoInfo = (id) => NANO.find((m) => m.id === id);
const orInfo = (id) => OR.find((m) => m.id === id);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64');

// Records requests and answers from a route table with real Response objects.
function fakeFetch(routes) {
    const calls = [];
    const impl = async (url, init = {}) => {
        calls.push({ url, init });
        const handler = routes[url];
        if (!handler) throw new TypeError(`unexpected url ${url}`);
        return handler(init);
    };
    impl.calls = calls;
    return impl;
}

test('NanoGPT normalizeModels keeps exactly the text-to-image models, sorted by name', () => {
    // Dropped: input-image models (edit, reference, try-on, segmentation, layers, depth, cutout, upscale)
    // and vector models; kept: dual-mode models tagged text-to-image.
    assert.deepEqual(NANO.map((m) => m.id).sort(), [
        'bytedance/seedream-v5.5', 'flux-schnell', 'grok-imagine-image', 'nano-banana-2', 'p-h3-image', 'qwen-image-3',
        'seedream-v4.5', 'z-image-turbo',
    ]);
    const names = NANO.map((m) => m.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(nanoInfo('flux-schnell'), {
        id: 'flux-schnell',
        name: 'Flux Schnell',
        supported: NANO_JSON.data[0].supported_parameters,
        maxPromptChars: 3000,
        pricePerImage: 0.0085,
        prices: NANO_JSON.data[0].pricing.per_image,
        nsfw: false,
    });
    assert.equal(nanoInfo('nano-banana-2').maxPromptChars, null);
    assert.equal(nanoInfo('nano-banana-2').pricePerImage, 0.08);
    assert.deepEqual(nanoInfo('nano-banana-2').prices, { '1k': 0.08, '2k': 0.12, '4k': 0.16 });
    assert.equal(nanoInfo('seedream-v4.5').nsfw, true);
});

test('NanoGPT prices keep only numeric entries, null without any', () => {
    const model = (perImage) => ({ id: 'm', architecture: { input_modalities: ['text'] }, pricing: { per_image: perImage } });
    const [mixed] = nanogpt.normalizeModels([model({ '1k': 0.02, '2k': '0.04', auto: null, '4k': 0.1 })]);
    assert.deepEqual(mixed.prices, { '1k': 0.02, '4k': 0.1 });
    assert.equal(mixed.pricePerImage, 0.02);
    const [none] = nanogpt.normalizeModels([model({ auto: 'free' })]);
    assert.equal(none.prices, null);
    assert.equal(none.pricePerImage, null);
});

test('NanoGPT drops tagless models by id and vector models by id', () => {
    const model = (id) => ({ id, architecture: { input_modalities: ['text', 'image'] } });
    const ids = ['a/image-to-image', 'flux-pro/v1/vto', 'x-vto', 'vidu-reference', 'seedream/layerize', 'v/layer-decomposition',
        'sam3-image', 'some-vector', 'flux-schnell', 'photo-vtol'];
    assert.deepEqual(nanogpt.normalizeModels(ids.map(model)).map((m) => m.id).sort(), ['flux-schnell', 'photo-vtol']);
});

test('OpenRouter normalizeModels drops exactly krea/k3-edit and the SVG-only model', () => {
    const all = OR_JSON.data.map((m) => m.id);
    assert.deepEqual(all.filter((id) => !OR.some((m) => m.id === id)), ['krea/k3-edit', 'recraft/recraft-v4.1-vector']);
    assert.equal(OR.length, all.length - 2);
    assert.ok(orInfo('black-forest-labs/flux.2-pro'), 'mixed output formats stay');
    const muse = orInfo('meta/muse-image');
    assert.deepEqual(muse, { id: 'meta/muse-image', name: 'Meta: Muse Image', supported: {}, maxPromptChars: null, pricePerImage: null, prices: null, nsfw: null });
    assert.deepEqual(nanogpt.normalizeModels(null), []);
    assert.deepEqual(openrouter.normalizeModels({}), []);
});

test('listModels fetches without auth and normalizes', async () => {
    const fetchImpl = fakeFetch({ [nanogpt.MODELS_URL]: () => Response.json(NANO_JSON) });
    const models = await nanogpt.listModels({ fetchImpl });
    assert.equal(models.length, 8);
    assert.equal(fetchImpl.calls[0].init.method, 'GET');
    assert.equal(fetchImpl.calls[0].init.headers, undefined);
    const orFetch = fakeFetch({ [openrouter.MODELS_URL]: () => Response.json(OR_JSON) });
    assert.equal((await openrouter.listModels({ fetchImpl: orFetch })).length, OR_JSON.data.length - 2);
});

test('buildRequest bodies, truncation and omitted size fields', () => {
    const long = 'a'.repeat(5000);
    const flux = nanogpt.buildRequest({ model: 'flux-schnell', prompt: long, aspect: '2:3', quality: 'standard', modelInfo: nanoInfo('flux-schnell') });
    assert.equal(flux.url, 'https://nano-gpt.com/api/v1/images');
    assert.deepEqual(flux.body, { model: 'flux-schnell', prompt: 'a'.repeat(3000), n: 1, resolution: '768x1024' });

    const banana = nanogpt.buildRequest({ model: 'nano-banana-2', prompt: long, aspect: '2:3', quality: 'high', modelInfo: nanoInfo('nano-banana-2') });
    assert.deepEqual(banana.body, { model: 'nano-banana-2', prompt: 'a'.repeat(4000), n: 1, aspect_ratio: '2:3', resolution: '2k' });

    const bare = nanogpt.buildRequest({ model: 'x', prompt: 'hi', aspect: '1:1', quality: 'standard' });
    assert.deepEqual(bare.body, { model: 'x', prompt: 'hi', n: 1 });

    const gemini = openrouter.buildRequest({ model: 'google/gemini-3.1-flash-image', prompt: long, aspect: '1:1', quality: 'high', modelInfo: orInfo('google/gemini-3.1-flash-image') });
    assert.equal(gemini.url, 'https://openrouter.ai/api/v1/images');
    assert.deepEqual(gemini.body, { model: 'google/gemini-3.1-flash-image', prompt: 'a'.repeat(4000), aspect_ratio: '1:1', resolution: '2K' });

    const muse = openrouter.buildRequest({ model: 'meta/muse-image', prompt: 'p', aspect: '16:9', quality: 'standard', modelInfo: orInfo('meta/muse-image') });
    assert.deepEqual(muse.body, { model: 'meta/muse-image', prompt: 'p' });
    assert.ok(!('n' in muse.body));
});

test('truncation never splits a surrogate pair', () => {
    const info = { ...nanoInfo('z-image-turbo'), maxPromptChars: 3 };
    const { body } = nanogpt.buildRequest({ model: 'm', prompt: 'ab\u{1F600}c', aspect: '1:1', quality: 'standard', modelInfo: info });
    assert.equal(body.prompt, 'ab');
});

const ARGS = { apiKey: 'sk-test-key', model: 'm', prompt: 'p', aspect: '1:1', quality: 'standard' };

test('generateImage sends auth headers and reads b64_json', async () => {
    const fetchImpl = fakeFetch({ [openrouter.GENERATE_URL]: () => Response.json({ created: 1, data: [{ b64_json: JPEG, media_type: 'image/jpeg' }] }) });
    assert.deepEqual(await openrouter.generateImage({ ...ARGS, fetchImpl }), { base64: JPEG, mime: 'image/jpeg' });
    const { init } = fetchImpl.calls[0];
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer sk-test-key');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { model: 'm', prompt: 'p' });

    const sniff = fakeFetch({ [nanogpt.GENERATE_URL]: () => Response.json({ data: [{ b64_json: PNG }] }) });
    assert.deepEqual(await nanogpt.generateImage({ ...ARGS, fetchImpl: sniff }), { base64: PNG, mime: 'image/png' });
});

test('generateImage accepts a data URL in url', async () => {
    const fetchImpl = fakeFetch({ [nanogpt.GENERATE_URL]: () => Response.json({ data: [{ url: `data:image/jpeg;base64,${JPEG}` }] }) });
    assert.deepEqual(await nanogpt.generateImage({ ...ARGS, fetchImpl }), { base64: JPEG, mime: 'image/jpeg' });
    assert.equal(fetchImpl.calls.length, 1);
});

test('generateImage downloads a remote url', async () => {
    const remote = 'https://cdn.example.test/img.jpg';
    const fetchImpl = fakeFetch({
        [nanogpt.GENERATE_URL]: () => Response.json({ data: [{ url: remote }] }),
        [remote]: () => new Response(Buffer.from(JPEG, 'base64'), { headers: { 'content-type': 'image/jpeg' } }),
    });
    assert.deepEqual(await nanogpt.generateImage({ ...ARGS, fetchImpl }), { base64: JPEG, mime: 'image/jpeg' });
    assert.equal(fetchImpl.calls[1].url, remote);
    assert.equal(fetchImpl.calls[1].init.headers, undefined);
});

test('generateImage returns remoteUrl when the download fails', async () => {
    const remote = 'https://cdn.example.test/blocked.png';
    const corsFail = fakeFetch({
        [nanogpt.GENERATE_URL]: () => Response.json({ data: [{ url: remote }] }),
        [remote]: () => {
            throw new TypeError('Failed to fetch');
        },
    });
    assert.deepEqual(await nanogpt.generateImage({ ...ARGS, fetchImpl: corsFail }), { remoteUrl: remote });
    const notFound = fakeFetch({
        [nanogpt.GENERATE_URL]: () => Response.json({ data: [{ url: remote }] }),
        [remote]: () => new Response('gone', { status: 403 }),
    });
    assert.deepEqual(await nanogpt.generateImage({ ...ARGS, fetchImpl: notFound }), { remoteUrl: remote });
});

test('NanoGPT accepts a top-level image, OpenRouter does not', async () => {
    const reply = () => Response.json({ image: JPEG });
    const nanoFetch = fakeFetch({ [nanogpt.GENERATE_URL]: reply });
    assert.deepEqual(await nanogpt.generateImage({ ...ARGS, fetchImpl: nanoFetch }), { base64: JPEG, mime: 'image/jpeg' });
    const orFetch = fakeFetch({ [openrouter.GENERATE_URL]: reply });
    await assert.rejects(openrouter.generateImage({ ...ARGS, fetchImpl: orFetch }), { message: 'OpenRouter: Antwort enthält kein Bild' });
});

test('SVG and other non-raster results are rejected as unsupported_format', async () => {
    const SVG = Buffer.from('\n  <svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').toString('base64');
    const XML = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const remote = 'https://cdn.example.test/out';
    const cases = [
        [openrouter, { data: [{ b64_json: SVG }] }, 'image/svg+xml'],
        [openrouter, { data: [{ b64_json: SVG, media_type: 'image/png' }] }, 'image/svg+xml'],
        [openrouter, { data: [{ b64_json: PNG, media_type: 'image/svg+xml' }] }, 'image/svg+xml'],
        [nanogpt, { data: [{ url: `data:image/svg+xml;base64,${SVG}` }] }, 'image/svg+xml'],
        [nanogpt, { data: [{ url: `data:application/octet-stream;base64,${XML}` }] }, 'image/svg+xml'],
        [nanogpt, { image: XML }, 'image/svg+xml'],
        [nanogpt, { data: [{ b64_json: PNG, media_type: 'image/bmp' }] }, 'image/bmp'],
    ];
    for (const [provider, reply, mime] of cases) {
        const fetchImpl = fakeFetch({ [provider.GENERATE_URL]: () => Response.json(reply) });
        await assert.rejects(provider.generateImage({ ...ARGS, fetchImpl }), (err) => {
            assert.ok(err instanceof ProviderError);
            assert.equal(err.message, `${provider.label}: Bildformat wird nicht unterstützt (${mime})`);
            assert.equal(err.code, 'unsupported_format');
            return true;
        });
    }
    for (const type of ['image/svg+xml', 'text/xml']) {
        const fetchImpl = fakeFetch({
            [nanogpt.GENERATE_URL]: () => Response.json({ data: [{ url: remote }] }),
            [remote]: () => new Response(Buffer.from(SVG, 'base64'), { headers: { 'content-type': type } }),
        });
        await assert.rejects(nanogpt.generateImage({ ...ARGS, fetchImpl }), {
            message: 'NanoGPT: Bildformat wird nicht unterstützt (image/svg+xml)', code: 'unsupported_format',
        });
    }
});

test('empty data throws ProviderError', async () => {
    const fetchImpl = fakeFetch({ [nanogpt.GENERATE_URL]: () => Response.json({ data: [] }) });
    await assert.rejects(nanogpt.generateImage({ ...ARGS, fetchImpl }), (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.message, 'NanoGPT: Antwort enthält kein Bild');
        return true;
    });
});

test('401 with the provider error body, key never in the message', async () => {
    const nanoFetch = fakeFetch({ [nanogpt.GENERATE_URL]: () => Response.json(
        { error: { message: 'Invalid Authentication', type: 'invalid_request_error', code: 'missing_api_key' } }, { status: 401 }) });
    await assert.rejects(nanogpt.generateImage({ ...ARGS, fetchImpl: nanoFetch }), (err) => {
        assert.equal(err.message, 'NanoGPT: 401 – Invalid Authentication');
        assert.equal(err.status, 401);
        assert.equal(err.code, 'missing_api_key');
        assert.equal(err.provider, 'NanoGPT');
        assert.ok(!err.message.includes(ARGS.apiKey));
        return true;
    });
    const orFetch = fakeFetch({ [openrouter.GENERATE_URL]: () => Response.json(
        { error: { message: 'No cookie auth credentials found', code: 401 } }, { status: 401 }) });
    await assert.rejects(openrouter.generateImage({ ...ARGS, fetchImpl: orFetch }), {
        message: 'OpenRouter: 401 – No cookie auth credentials found', code: 401,
    });
});

test('2xx body with an error member throws', async () => {
    const fetchImpl = fakeFetch({ [openrouter.GENERATE_URL]: () => Response.json({ error: { message: 'Provider overloaded', code: 529 } }) });
    await assert.rejects(openrouter.generateImage({ ...ARGS, fetchImpl }), { name: 'ProviderError', message: 'OpenRouter: 200 – Provider overloaded' });
});

test('missing apiKey throws before any request', async () => {
    const fetchImpl = fakeFetch({});
    await assert.rejects(nanogpt.generateImage({ ...ARGS, apiKey: '', fetchImpl }), { name: 'ProviderError', message: 'NanoGPT: Kein API-Key' });
    await assert.rejects(openrouter.generateImage({ ...ARGS, apiKey: undefined, fetchImpl }), { message: 'OpenRouter: Kein API-Key' });
    assert.equal(fetchImpl.calls.length, 0);
});

test('provider constants and registry', () => {
    assert.equal(nanogpt.id, 'nanogpt');
    assert.equal(nanogpt.label, 'NanoGPT');
    assert.equal(nanogpt.secretKey, 'api_key_nanogpt');
    assert.equal(nanogpt.defaultModel, 'flux-schnell');
    assert.equal(openrouter.id, 'openrouter');
    assert.equal(openrouter.label, 'OpenRouter');
    assert.equal(openrouter.secretKey, 'api_key_openrouter');
    assert.equal(openrouter.defaultModel, 'google/gemini-2.5-flash-image');
    assert.equal(getProvider('nanogpt'), PROVIDERS.nanogpt);
    assert.equal(getProvider('openrouter').GENERATE_URL, 'https://openrouter.ai/api/v1/images');
    assert.throws(() => getProvider('dalle'), { message: 'Unbekannter Anbieter: dalle' });
    assert.throws(() => getProvider('toString'), { message: 'Unbekannter Anbieter: toString' });
});
