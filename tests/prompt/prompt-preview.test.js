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
    assert.equal(promptPreviewText(entries), 'model-a, model-c:\nlong prompt\n\nmodel-b:\nshort');
});

test('promptPreviewText: no entries give an empty string', () => {
    assert.equal(promptPreviewText([]), '');
    assert.equal(promptPreviewText(undefined), '');
});
