import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptPreviewText } from '../../src/prompt/scene.js';

test('promptPreviewText: one entry gives its prompt', () => {
    assert.equal(promptPreviewText([{ model: 'model-a', prompt: 'a cat' }]), 'a cat');
});

test('promptPreviewText: equal prompts give that prompt once, without model ids', () => {
    const entries = [
        { model: 'model-a', prompt: 'a cat' },
        { model: 'model-a', prompt: 'a cat' },
        { model: 'model-b', prompt: 'a cat' },
    ];
    assert.equal(promptPreviewText(entries), 'a cat');
});

test('promptPreviewText: distinct prompts give one block each, model ids grouped, in order of first appearance', () => {
    const entries = [
        { model: 'model-a', prompt: 'long prompt' },
        { model: 'model-b', prompt: 'short' },
        { model: 'model-b', prompt: 'short' },
        { model: 'model-c', prompt: 'long prompt' },
    ];
    assert.equal(promptPreviewText(entries), 'model-a, model-c:\nlong prompt\n\nmodel-b x2:\nshort');
});

test('promptPreviewText: the head line counts each model that gets a prompt more than once', () => {
    const models = [...Array(8).fill('hidream-o1-image-dev'), ...Array(8).fill('seedream-v4.5')];
    const entries = models.map((model, i) => ({ model, prompt: i % 2 === 0 ? 'polaroid' : 'front' }));
    assert.equal(promptPreviewText(entries), 'hidream-o1-image-dev x4, seedream-v4.5 x4:\npolaroid\n\nhidream-o1-image-dev x4, seedream-v4.5 x4:\nfront');
});

test('promptPreviewText: a model drawn once stays without a count next to counted ones', () => {
    const entries = [
        { model: 'z-image-turbo', prompt: 'p1' },
        { model: 'z-image-turbo', prompt: 'p2' },
        { model: 'z-image-turbo', prompt: 'p1' },
        { model: 'z-image-turbo', prompt: 'p2' },
        { model: 'z-image-turbo', prompt: 'p1' },
        { model: 'hidream-o1-image-dev', prompt: 'p2' },
    ];
    assert.equal(promptPreviewText(entries), 'z-image-turbo x3:\np1\n\nz-image-turbo x2, hidream-o1-image-dev:\np2');
});

test('promptPreviewText: no entries give an empty string', () => {
    assert.equal(promptPreviewText([]), '');
    assert.equal(promptPreviewText(undefined), '');
});
