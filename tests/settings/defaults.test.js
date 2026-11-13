import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, toggleFavorite } from '../../src/settings/defaults.js';
import { DEFAULT_DESCRIPTION, DEFAULT_INSTRUCTION, LEGACY_DEFAULT_INSTRUCTIONS } from '../../src/prompt/scene.js';
import { GALLERY_LIMIT } from '../../src/gallery/records.js';
import { DEFAULT_MODELS } from '../../src/shared/constants.js';
import { REFERENCE_LIMIT } from '../../src/references/select.js';

const EXPECTED_DEFAULTS = {
    provider: 'nanogpt', keys: { nanogpt: '', openrouter: '' }, models: { ...DEFAULT_MODELS },
    favorites: { nanogpt: [], openrouter: [] }, instruction: DEFAULT_INSTRUCTION, description: DEFAULT_DESCRIPTION,
    descriptionWords: 45, aspect: '1:1', quality: 'standard',
    contextMessages: 4, styleSuffix: '', useLlm: true, autoSaveDialog: false, parallelImage: false, gallery: [],
    references: [], referenceOrder: {},
    batch: { nanogpt: [], openrouter: [] },
};

test('DEFAULT_SETTINGS matches the template and is frozen', () => {
    assert.deepEqual(DEFAULT_SETTINGS, EXPECTED_DEFAULTS);
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS.favorites.nanogpt));
});

test('normalizeSettings(undefined) and garbage roots give the defaults', () => {
    for (const saved of [undefined, null, 42, 'x', [], true]) {
        assert.deepEqual(normalizeSettings(saved), EXPECTED_DEFAULTS);
    }
});

test('normalizeSettings returns a fresh object; mutating it leaves DEFAULT_SETTINGS alone', () => {
    const a = normalizeSettings(undefined);
    const b = normalizeSettings(undefined);
    assert.notEqual(a, b);
    assert.notEqual(a.keys, DEFAULT_SETTINGS.keys);
    a.keys.nanogpt = 'k';
    a.favorites.nanogpt.push('m');
    a.gallery.push({ url: 'u' });
    a.models.nanogpt = 'other';
    assert.deepEqual(DEFAULT_SETTINGS, EXPECTED_DEFAULTS);
    assert.deepEqual(b, EXPECTED_DEFAULTS);
});

test('normalizeSettings keeps valid values', () => {
    const saved = {
        provider: 'openrouter', keys: { nanogpt: 'a', openrouter: 'b' }, models: { nanogpt: 'x', openrouter: 'y' },
        favorites: { nanogpt: ['x'], openrouter: ['y', 'z'] }, instruction: 'Malen', description: 'the mood', descriptionWords: 90,
        aspect: '16:9', quality: 'high', contextMessages: 12, styleSuffix: 'anime', useLlm: false, autoSaveDialog: true, parallelImage: true,
        gallery: [{ url: 'user/images/a.png', prompt: 'p' }],
        references: [{ url: 'user/images/bfqig-references/r.jpg', names: ['Kyouko'], enabled: false, timestamp: 5 }],
        referenceOrder: { kyouko: ['user/images/bfqig-references/r.jpg'] },
        batch: { nanogpt: [{ model: 'x', count: 2 }], openrouter: [] },
    };
    const result = normalizeSettings(saved);
    assert.deepEqual(result, saved);
    assert.notEqual(result.gallery[0], saved.gallery[0]);
    assert.notEqual(result.references[0], saved.references[0]);
});

test('normalizeSettings repairs garbage types', () => {
    const result = normalizeSettings({
        provider: 7, keys: 'nope', models: { nanogpt: 5, openrouter: null }, favorites: { nanogpt: 'x', openrouter: [1, 'a'] },
        instruction: { a: 1 }, aspect: 1, quality: [], contextMessages: 'viele', styleSuffix: 3, useLlm: 'yes',
        autoSaveDialog: 1, parallelImage: 'true', gallery: 'list', references: { url: 'x' },
    });
    assert.deepEqual(result, {
        ...EXPECTED_DEFAULTS,
        models: { nanogpt: '5', openrouter: DEFAULT_MODELS.openrouter },
        favorites: { nanogpt: [], openrouter: ['a'] },
        styleSuffix: '3',
    });
});

test('normalizeSettings clamps contextMessages to an integer in 1..20', () => {
    const cases = [[0, 1], [-5, 1], [21, 20], [1e9, 20], [3.7, 3], ['6', 6], [NaN, 4], [Infinity, 4], [null, 4], ['', 4]];
    for (const [input, expected] of cases) {
        assert.equal(normalizeSettings({ contextMessages: input }).contextMessages, expected, String(input));
    }
});

test('normalizeSettings rejects unknown provider, aspect and quality', () => {
    const result = normalizeSettings({ provider: 'stability', aspect: '5:4', quality: 'ultra' });
    assert.equal(result.provider, 'nanogpt');
    assert.equal(result.aspect, '1:1');
    assert.equal(result.quality, 'standard');
});

test('normalizeSettings deduplicates favourites', () => {
    const result = normalizeSettings({ favorites: { nanogpt: ['a', 'b', 'a', '', 'b'], openrouter: ['c', 'c'] } });
    assert.deepEqual(result.favorites, { nanogpt: ['a', 'b'], openrouter: ['c'] });
});

test('normalizeSettings drops gallery entries without a string url and caps the list', () => {
    const result = normalizeSettings({ gallery: [{ url: 'a' }, { prompt: 'no url' }, { url: 5 }, null, 'x', { url: '' }, { url: 'b' }] });
    assert.deepEqual(result.gallery, [{ url: 'a' }, { url: 'b' }]);
    const many = Array.from({ length: GALLERY_LIMIT + 10 }, (_, i) => ({ url: `u${i}` }));
    assert.equal(normalizeSettings({ gallery: many }).gallery.length, GALLERY_LIMIT);
});

test('normalizeSettings replaces an empty instruction and empty models with defaults', () => {
    const result = normalizeSettings({ instruction: '   ', models: { nanogpt: '', openrouter: '  ' } });
    assert.equal(result.instruction, DEFAULT_INSTRUCTION);
    assert.deepEqual(result.models, { ...DEFAULT_MODELS });
});

test('normalizeSettings migrates the legacy default instructions (1.0, 1.1 and 1.2) and keeps a customised one', () => {
    assert.equal(LEGACY_DEFAULT_INSTRUCTIONS.length, 3);
    assert.ok(LEGACY_DEFAULT_INSTRUCTIONS[0].endsWith('and the current action from the latest messages.'));
    assert.ok(LEGACY_DEFAULT_INSTRUCTIONS[1].endsWith('the place where they are now, the lighting and the mood.'));
    assert.ok(LEGACY_DEFAULT_INSTRUCTIONS[2].endsWith('seen through the eyes of {{user}}. {{user}} is not in the picture.'));
    for (const legacy of LEGACY_DEFAULT_INSTRUCTIONS) {
        assert.notEqual(legacy, DEFAULT_INSTRUCTION);
        assert.equal(normalizeSettings({ instruction: legacy }).instruction, DEFAULT_INSTRUCTION);
    }
    assert.equal(normalizeSettings({ instruction: '' }).instruction, DEFAULT_INSTRUCTION);
    const custom = `${LEGACY_DEFAULT_INSTRUCTIONS[0]} Always in watercolour.`;
    assert.equal(normalizeSettings({ instruction: custom }).instruction, custom);
    const custom11 = LEGACY_DEFAULT_INSTRUCTIONS[1].replace('the mood.', 'the mood. Watercolour.');
    assert.equal(normalizeSettings({ instruction: custom11 }).instruction, custom11);
    assert.equal(normalizeSettings({ instruction: 'Malen' }).instruction, 'Malen');
});

test('normalizeSettings validates references: url, names, enabled, timestamp, limit', () => {
    const result = normalizeSettings({
        references: [
            { url: 'a.jpg', names: ' Kyouko , yuki, KYOUKO ', enabled: 'no', timestamp: 'x', extra: 1 },
            { url: '' }, null, 'b.jpg', { names: ['x'] },
            { url: 'c.jpg', names: ['Tooru'], enabled: false, timestamp: Infinity },
        ],
    });
    assert.deepEqual(result.references, [
        { url: 'a.jpg', names: ['Kyouko', 'yuki'], enabled: true, timestamp: 0 },
        { url: 'c.jpg', names: ['Tooru'], enabled: false, timestamp: 0 },
    ]);
    const many = Array.from({ length: REFERENCE_LIMIT + 5 }, (_, i) => ({ url: `r${i}`, names: 'A' }));
    assert.equal(normalizeSettings({ references: many }).references.length, REFERENCE_LIMIT);
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS.references));
});

test('normalizeSettings validates referenceOrder: arrays of unique non-empty strings, capped, else dropped', () => {
    const result = normalizeSettings({
        referenceOrder: {
            'kyouko': ['b.jpg', 'a.jpg', 'b.jpg', '', 5, null, 'c.jpg'],
            'kyouko|yuki': [],
            'tooru': 'a.jpg',
            'yuki': [1, ''],
            'miyamura': { 0: 'x' },
        },
    });
    assert.deepEqual(result.referenceOrder, { kyouko: ['b.jpg', 'a.jpg', 'c.jpg'] });
    const many = Array.from({ length: 310 }, (_, i) => `u${i}`);
    assert.equal(normalizeSettings({ referenceOrder: { a: many } }).referenceOrder.a.length, 300);
    for (const garbage of [undefined, null, 'x', 7, ['a'], true]) {
        assert.deepEqual(normalizeSettings({ referenceOrder: garbage }).referenceOrder, {}, String(garbage));
    }
    const proto = normalizeSettings({ referenceOrder: JSON.parse('{"__proto__": ["p.jpg"]}') }).referenceOrder;
    assert.deepEqual(Object.keys(proto), ['__proto__']);
    assert.equal(Object.getPrototypeOf(proto), Object.prototype);
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS.referenceOrder));
});

test('normalizeSettings normalises names and coerces enabled on gallery entries only when present', () => {
    const result = normalizeSettings({
        gallery: [
            { url: 'a.png', prompt: 'p' },
            { url: 'b.png', names: 'Kyouko, Yuki, kyouko', enabled: 0 },
            { url: 'c.png', names: 7, enabled: 'yes' },
        ],
    });
    assert.deepEqual(result.gallery, [
        { url: 'a.png', prompt: 'p' },
        { url: 'b.png', names: ['Kyouko', 'Yuki'], enabled: false },
        { url: 'c.png', names: [], enabled: true },
    ]);
});

test('normalizeSettings coerces parallelImage to a boolean, default false', () => {
    assert.equal(DEFAULT_SETTINGS.parallelImage, false);
    assert.equal(normalizeSettings({ parallelImage: true }).parallelImage, true);
    assert.equal(normalizeSettings({ parallelImage: false }).parallelImage, false);
    for (const garbage of [undefined, null, 1, 'true', {}]) {
        assert.equal(normalizeSettings({ parallelImage: garbage }).parallelImage, false, String(garbage));
    }
});

test('toggleFavorite adds and removes without mutating', () => {
    const empty = [];
    const added = toggleFavorite(empty, 'flux-schnell');
    assert.deepEqual(added, ['flux-schnell']);
    assert.deepEqual(empty, []);
    const two = toggleFavorite(added, 'z-image-turbo');
    assert.deepEqual(two, ['flux-schnell', 'z-image-turbo']);
    assert.deepEqual(toggleFavorite(two, 'flux-schnell'), ['z-image-turbo']);
    assert.deepEqual(two, ['flux-schnell', 'z-image-turbo']);
    assert.deepEqual(toggleFavorite(undefined, 'a'), ['a']);
});

test('DEFAULT_SETTINGS carries the default picture description and 45 words', () => {
    assert.equal(DEFAULT_SETTINGS.description, DEFAULT_DESCRIPTION);
    assert.equal(DEFAULT_SETTINGS.descriptionWords, 45);
});

test('normalizeSettings keeps a written description and replaces empty or non-string ones', () => {
    assert.equal(normalizeSettings({ description: 'their emotions, the place' }).description, 'their emotions, the place');
    for (const input of ['', '   ', '\n\t', undefined, null, 5, {}, []]) {
        assert.equal(normalizeSettings({ description: input }).description, DEFAULT_DESCRIPTION, JSON.stringify(input));
    }
});

test('normalizeSettings clamps descriptionWords to an integer in 20..200', () => {
    const cases = [[45, 45], [90, 90], [19, 20], [0, 20], [-5, 20], [201, 200], [1e9, 200], [87.6, 88], ['120', 120],
        [NaN, 45], [Infinity, 45], [null, 45], ['', 45], ['viele', 45], [{}, 45]];
    for (const [input, expected] of cases) {
        assert.equal(normalizeSettings({ descriptionWords: input }).descriptionWords, expected, String(input));
    }
});
