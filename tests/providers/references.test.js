import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nanogpt from '../../src/providers/nanogpt.js';
import * as openrouter from '../../src/providers/openrouter.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const NANO = nanogpt.normalizeModels(load('nanogpt-models.sample.json'));
const OR = openrouter.normalizeModels(load('openrouter-models.sample.json'));
const nanoInfo = (id) => NANO.find((m) => m.id === id);
const orInfo = (id) => OR.find((m) => m.id === id);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const refs = (n) => Array.from({ length: n }, (_, i) => `data:image/jpeg;base64,R${i}`);

test('NanoGPT maxReferenceImages reads supported.max_input_images from the real model list', () => {
    assert.equal(nanogpt.maxReferenceImages(nanoInfo('seedream-v4.5')), 10);
    assert.equal(nanogpt.maxReferenceImages(nanoInfo('qwen-image-3')), 3);
    assert.equal(nanogpt.maxReferenceImages(nanoInfo('nano-banana-2')), 14);
    assert.equal(nanogpt.maxReferenceImages(nanoInfo('flux-schnell')), 0);
    assert.equal(nanogpt.maxReferenceImages(nanoInfo('z-image-turbo')), 0);
});

test('OpenRouter maxReferenceImages reads supported.input_references.max from the real model list', () => {
    assert.equal(openrouter.maxReferenceImages(orInfo('google/gemini-2.5-flash-image')), 3);
    assert.equal(openrouter.maxReferenceImages(orInfo('openai/gpt-image-1')), 16);
    assert.equal(openrouter.maxReferenceImages(orInfo('meta/muse-image')), 0);
});

test('maxReferenceImages: anything but a positive finite number is 0, fractions are floored', () => {
    for (const value of [undefined, null, 0, -2, NaN, Infinity, '4', {}, 0.5]) {
        assert.equal(nanogpt.maxReferenceImages({ supported: { max_input_images: value } }), 0, String(value));
        assert.equal(openrouter.maxReferenceImages({ supported: { input_references: { max: value } } }), 0, String(value));
    }
    assert.equal(nanogpt.maxReferenceImages({ supported: { max_input_images: 3.9 } }), 3);
    // One input image means img2img on NanoGPT (the picture copies the reference's framing), so it is no slot.
    assert.equal(nanogpt.maxReferenceImages({ supported: { max_input_images: 1 } }), 0);
    assert.equal(nanogpt.maxReferenceImages({ supported: { max_input_images: 1.9 } }), 0);
    assert.equal(nanogpt.maxReferenceImages({ supported: { max_input_images: 2 } }), 2);
    assert.deepEqual(
        nanogpt.buildRequest({ model: 'x', prompt: 'p', aspect: '1:1', quality: 'standard', modelInfo: { supported: { max_input_images: 1 } }, references: refs(1) }).body.input_references,
        undefined,
    );
    assert.equal(openrouter.maxReferenceImages({ supported: { input_references: { max: 2.2 } } }), 2);
    assert.equal(nanogpt.maxReferenceImages(undefined), 0);
    assert.equal(openrouter.maxReferenceImages(null), 0);
    assert.equal(openrouter.maxReferenceImages({ supported: { input_references: 4 } }), 0);
});

test('NanoGPT buildRequest adds input_references cut to the model limit', () => {
    const base = { model: 'qwen-image-3', prompt: 'p', aspect: '1:1', quality: 'standard', modelInfo: nanoInfo('qwen-image-3') };
    const { body } = nanogpt.buildRequest({ ...base, references: refs(5) });
    assert.deepEqual(body.input_references, refs(3));
    assert.equal(body.n, 1);
    assert.equal(nanogpt.buildRequest({ ...base, references: refs(2) }).body.input_references.length, 2);
    for (const references of [undefined, [], 'x']) {
        assert.ok(!('input_references' in nanogpt.buildRequest({ ...base, references }).body), String(references));
    }
    const noRefs = { ...base, model: 'flux-schnell', modelInfo: nanoInfo('flux-schnell'), references: refs(2) };
    assert.ok(!('input_references' in nanogpt.buildRequest(noRefs).body));
});

test('OpenRouter buildRequest adds input_references cut to the model limit', () => {
    const base = { model: 'google/gemini-2.5-flash-image', prompt: 'p', aspect: '9:16', quality: 'standard', modelInfo: orInfo('google/gemini-2.5-flash-image') };
    const { body } = openrouter.buildRequest({ ...base, references: refs(4) });
    assert.deepEqual(body, { model: base.model, prompt: 'p', aspect_ratio: '9:16', input_references: refs(3) });
    assert.ok(!('input_references' in openrouter.buildRequest({ ...base, references: [] }).body));
    const muse = { ...base, model: 'meta/muse-image', modelInfo: orInfo('meta/muse-image'), references: refs(1) };
    assert.ok(!('input_references' in openrouter.buildRequest(muse).body));
});

test('generateImage sends the references in the request body', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push(JSON.parse(init.body));
        return Response.json({ data: [{ b64_json: PNG }] });
    };
    const args = { apiKey: 'sk-test', prompt: 'p', aspect: '1:1', quality: 'standard', references: refs(2), fetchImpl };
    await nanogpt.generateImage({ ...args, model: 'seedream-v4.5', modelInfo: nanoInfo('seedream-v4.5') });
    await openrouter.generateImage({ ...args, model: 'openai/gpt-image-1', modelInfo: orInfo('openai/gpt-image-1') });
    assert.deepEqual(calls[0].input_references, refs(2));
    assert.deepEqual(calls[1].input_references, refs(2));
});
