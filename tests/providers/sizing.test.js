import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    nearestByRatio, parsePixelSize, parseRatio, pickTier, selectNanoGptSize, selectOpenRouterSize,
} from '../../src/providers/sizing.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const nano = Object.fromEntries(load('nanogpt-models.sample.json').data.map((m) => [m.id, m.supported_parameters]));
const or = Object.fromEntries(load('openrouter-models.sample.json').data.map((m) => [m.id, m.supported_parameters]));

test('parseRatio handles ratios, pixel sizes and garbage', () => {
    assert.equal(parseRatio('16:9'), 16 / 9);
    assert.equal(parseRatio('1024x768'), 1024 / 768);
    assert.equal(parseRatio('1024*768'), 1024 / 768);
    assert.equal(parseRatio('19.5:9'), 19.5 / 9);
    assert.equal(parseRatio('auto'), null);
    assert.equal(parseRatio('0:1'), null);
    assert.equal(parseRatio(''), null);
    assert.equal(parseRatio(undefined), null);
});

test('parsePixelSize', () => {
    assert.deepEqual(parsePixelSize('1280*720'), { width: 1280, height: 720 });
    assert.deepEqual(parsePixelSize('768x1024'), { width: 768, height: 1024 });
    assert.equal(parsePixelSize('16:9'), null);
    assert.equal(parsePixelSize('1k'), null);
});

test('nearestByRatio returns the verbatim candidate', () => {
    assert.equal(nearestByRatio(['1:1', '3:2', '2:3'], 16 / 9), '3:2');
    assert.equal(nearestByRatio(['9:19.5', '9:16'], 9 / 16), '9:16');
    assert.equal(nearestByRatio(['auto', 'x'], 1), null);
    assert.equal(nearestByRatio([], 1), null);
});

test('pickTier standard and high', () => {
    assert.equal(pickTier(['512', '1K', '2K', '4K'], 'standard'), '1K');
    assert.equal(pickTier(['512', '1K', '2K', '4K'], 'high'), '2K');
    assert.equal(pickTier(['1k', '1.5k', '2k'], 'high'), '2k');
    assert.equal(pickTier(['512'], 'standard'), '512');
    assert.equal(pickTier(['4k', '8k'], 'high'), '4k');
    assert.equal(pickTier(['auto'], 'standard'), null);
});

test('NanoGPT required cases from the fixtures', () => {
    assert.deepEqual(selectNanoGptSize(nano['flux-schnell'], '2:3', 'standard'), { resolution: '768x1024' });
    assert.deepEqual(selectNanoGptSize(nano['z-image-turbo'], '16:9', 'standard'), { resolution: '1280*720' });
    assert.deepEqual(selectNanoGptSize(nano['z-image-turbo'], '1:1', 'standard'), { resolution: '1024*1024' });
    assert.deepEqual(selectNanoGptSize(nano['z-image-turbo'], '1:1', 'high'), { resolution: '1536*1536' });
    assert.deepEqual(selectNanoGptSize(nano['qwen-image-3'], '9:16', 'standard'), { aspect_ratio: '9:16', resolution: '1k' });
    assert.deepEqual(selectNanoGptSize(nano['qwen-image-3'], '9:16', 'high'), { aspect_ratio: '9:16', resolution: '2k' });
    assert.deepEqual(selectNanoGptSize(nano['grok-imagine-image'], '3:4', 'standard'), { resolution: '3:4' });
    assert.deepEqual(selectNanoGptSize(nano['seedream-v4.5'], '1:1', 'standard'), { resolution: '1920x1920' });
    assert.deepEqual(selectNanoGptSize(nano['nano-banana-2'], '2:3', 'standard'), { aspect_ratio: '2:3', resolution: '1k' });
    assert.deepEqual(selectNanoGptSize(nano['birefnet/v2'], '1:1', 'standard'), {});
});

test('NanoGPT named sizes prefer square_hd for 1:1', () => {
    assert.deepEqual(selectNanoGptSize(nano['marigold-v2'], '1:1', 'standard'), { resolution: 'square_hd' });
    assert.deepEqual(selectNanoGptSize(nano['marigold-v2'], '9:16', 'standard'), { resolution: 'portrait_16_9' });
    assert.deepEqual(selectNanoGptSize(nano['marigold-v2'], '4:3', 'high'), { resolution: 'landscape_4_3' });
});

test('NanoGPT aspect list with only auto sends auto, empty input sends nothing', () => {
    assert.deepEqual(selectNanoGptSize({ resolutions: [], aspect_ratio: ['auto'] }, '1:1', 'standard'), { aspect_ratio: 'auto' });
    assert.deepEqual(selectNanoGptSize({}, '1:1', 'standard'), {});
    assert.deepEqual(selectNanoGptSize(undefined, '1:1', 'high'), {});
});

test('OpenRouter required cases from the fixtures', () => {
    assert.deepEqual(selectOpenRouterSize(or['google/gemini-2.5-flash-image'], '9:16', 'standard'), { aspect_ratio: '9:16' });
    assert.deepEqual(selectOpenRouterSize(or['google/gemini-3.1-flash-image'], '1:1', 'standard'), { aspect_ratio: '1:1', resolution: '1K' });
    assert.deepEqual(selectOpenRouterSize(or['google/gemini-3.1-flash-image'], '1:1', 'high'), { aspect_ratio: '1:1', resolution: '2K' });
    assert.deepEqual(selectOpenRouterSize(or['openai/gpt-image-1'], '16:9', 'standard'), { aspect_ratio: '3:2' });
    assert.deepEqual(selectOpenRouterSize(or['meta/muse-image'], '1:1', 'standard'), {});
});
