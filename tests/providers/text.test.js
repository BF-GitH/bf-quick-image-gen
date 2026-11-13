import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nanogpt from '../../src/providers/nanogpt.js';
import * as openrouter from '../../src/providers/openrouter.js';
import { ProviderError } from '../../src/providers/http.js';

const PROVIDERS = [
    { mod: nanogpt, label: 'NanoGPT', models: 'https://nano-gpt.com/api/v1/models?detailed=true', chat: 'https://nano-gpt.com/api/v1/chat/completions' },
    { mod: openrouter, label: 'OpenRouter', models: 'https://openrouter.ai/api/v1/models', chat: 'https://openrouter.ai/api/v1/chat/completions' },
];

// Shapes as read from both lists on 2026-11-13.
const ENTRIES = [
    { id: 'z-model', object: 'model', name: 'Alpha Chat', architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'image-only', name: 'Bild Modell', architecture: { output_modalities: ['image'] } },
    { id: 'mixed', name: 'Gamma Mixed', architecture: { output_modalities: ['image', 'text'] } },
    { id: 'no-architecture', name: 'Delta Plain' },
    { id: 'no-outputs', name: 'Epsilon', architecture: { modality: 'text->text' } },
    { id: 'beta-id', name: '', architecture: { output_modalities: ['text'] } },
    { id: 'no-name' },
    { name: 'No id at all', architecture: { output_modalities: ['text'] } },
    { id: 42, name: 'Numeric id' },
    null,
];
const EXPECTED = [
    { id: 'z-model', name: 'Alpha Chat' },
    { id: 'beta-id', name: 'beta-id' },
    { id: 'no-architecture', name: 'Delta Plain' },
    { id: 'no-outputs', name: 'Epsilon' },
    { id: 'mixed', name: 'Gamma Mixed' },
    { id: 'no-name', name: 'no-name' },
];

function fakeFetch(respond) {
    const calls = [];
    const impl = async (url, init = {}) => {
        calls.push({ url, init });
        return respond(url, init);
    };
    impl.calls = calls;
    return impl;
}

for (const { mod, label, models, chat } of PROVIDERS) {
    test(`${label} exports the text URLs`, () => {
        assert.equal(mod.TEXT_MODELS_URL, models);
        assert.equal(mod.CHAT_URL, chat);
    });

    test(`${label} normalizeTextModels: data wrapper and bare array, filters, names, order`, () => {
        assert.deepEqual(mod.normalizeTextModels({ data: ENTRIES }), EXPECTED);
        assert.deepEqual(mod.normalizeTextModels(ENTRIES), EXPECTED);
        assert.deepEqual(mod.normalizeTextModels({}), []);
        assert.deepEqual(mod.normalizeTextModels(null), []);
    });

    test(`${label} listTextModels requests the text list and normalizes it`, async () => {
        const fetchImpl = fakeFetch(() => Response.json({ data: ENTRIES }));
        assert.deepEqual(await mod.listTextModels({ fetchImpl }), EXPECTED);
        assert.equal(fetchImpl.calls.length, 1);
        assert.equal(fetchImpl.calls[0].url, models);
        assert.equal(fetchImpl.calls[0].init.method, 'GET');
    });

    test(`${label} buildChatRequest with and without system prompt and maxTokens`, () => {
        assert.deepEqual(mod.buildChatRequest({ model: 'm', systemPrompt: 'sys', prompt: 'hi', maxTokens: 300 }), {
            url: chat,
            body: {
                model: 'm',
                messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
                max_tokens: 300,
                stream: false,
            },
        });
        const bare = mod.buildChatRequest({ model: 'm', systemPrompt: '', prompt: 'hi' });
        assert.deepEqual(bare.body, { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: false });
        for (const maxTokens of [0, -5, '300', NaN, null]) {
            assert.equal('max_tokens' in mod.buildChatRequest({ model: 'm', prompt: 'hi', maxTokens }).body, false);
        }
    });

    test(`${label} generateText sends the bearer request and returns string content`, async () => {
        const fetchImpl = fakeFetch(() => Response.json({ choices: [{ message: { content: 'a red fox' } }] }));
        const text = await mod.generateText({ apiKey: 'k-test', model: 'm', systemPrompt: 's', prompt: 'p', maxTokens: 50, fetchImpl });
        assert.equal(text, 'a red fox');
        const [{ url, init }] = fetchImpl.calls;
        assert.equal(url, chat);
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.Authorization, 'Bearer k-test');
        assert.equal(init.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(init.body), mod.buildChatRequest({ model: 'm', systemPrompt: 's', prompt: 'p', maxTokens: 50 }).body);
    });

    test(`${label} generateText joins text parts and returns '' for empty content`, async () => {
        const parts = fakeFetch(() => Response.json({
            choices: [{ message: { content: [{ type: 'text', text: 'a ' }, { type: 'image_url' }, { type: 'text', text: 'fox' }] } }],
        }));
        assert.equal(await mod.generateText({ apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: parts }), 'a fox');
        for (const reply of [{ choices: [{ message: { content: null } }] }, { choices: [] }, {}, { choices: [{ message: { content: 7 } }] }]) {
            assert.equal(await mod.generateText({ apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: fakeFetch(() => Response.json(reply)) }), '');
        }
    });

    test(`${label} generateText error status carries the provider message`, async () => {
        const fetchImpl = fakeFetch(() => Response.json({ error: { message: 'model not found', code: 'bad_model' } }, { status: 404 }));
        await assert.rejects(
            mod.generateText({ apiKey: 'k', model: 'm', prompt: 'p', fetchImpl }),
            (error) => error instanceof ProviderError && error.status === 404 && error.provider === label
                && error.message === `${label}: 404 – model not found`,
        );
    });

    test(`${label} generateText without a key throws no_key and sends nothing`, async () => {
        const fetchImpl = fakeFetch(() => Response.json({}));
        await assert.rejects(
            mod.generateText({ apiKey: '', model: 'm', prompt: 'p', fetchImpl }),
            (error) => error instanceof ProviderError && error.code === 'no_key' && error.message === `${label}: Kein API-Key`,
        );
        assert.equal(fetchImpl.calls.length, 0);
    });
}
