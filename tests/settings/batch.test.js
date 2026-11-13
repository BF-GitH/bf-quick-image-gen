import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BATCH_LIMITS,
    DEFAULT_SETTINGS,
    addToBatch,
    batchTotal,
    expandImageJobs,
    normalizeBatch,
    normalizeSettings,
    removeFromBatch,
    setBatchCount,
} from '../../src/settings/defaults.js';

test('BATCH_LIMITS is 4 per model and 8 in total, frozen', () => {
    assert.deepEqual(BATCH_LIMITS, { perModel: 4, total: 8 });
    assert.ok(Object.isFrozen(BATCH_LIMITS));
});

test('normalizeBatch: garbage roots give an empty list', () => {
    for (const value of [undefined, null, 42, 'x', {}, true]) {
        assert.deepEqual(normalizeBatch(value), [], String(value));
    }
});

test('normalizeBatch: entries without a non-empty string model are dropped, models are trimmed', () => {
    const list = [null, 'a', 7, { model: '' }, { model: '   ' }, { model: 5, count: 2 }, { count: 2 }, { model: '  m1  ', count: 2 }];
    assert.deepEqual(normalizeBatch(list), [{ model: 'm1', count: 2 }]);
});

test('normalizeBatch: a model listed twice keeps its first entry, also after trimming', () => {
    const list = [{ model: 'a', count: 2 }, { model: 'b', count: 1 }, { model: ' a ', count: 4 }];
    assert.deepEqual(normalizeBatch(list), [{ model: 'a', count: 2 }, { model: 'b', count: 1 }]);
});

test('normalizeBatch: count is an integer clamped to 1..4, no finite number gives 1', () => {
    const list = [
        { model: 'a', count: 0 }, { model: 'b', count: -3 }, { model: 'c', count: 9 },
        { model: 'd', count: 2.7 }, { model: 'e', count: NaN }, { model: 'f', count: '3' },
        { model: 'g', count: Infinity }, { model: 'h' },
    ];
    assert.deepEqual(normalizeBatch(list).map((entry) => entry.count), [1, 1, 4, 2]);
    const rest = normalizeBatch(list.slice(4));
    assert.deepEqual(rest, [{ model: 'e', count: 1 }, { model: 'f', count: 1 }, { model: 'g', count: 1 }, { model: 'h', count: 1 }]);
});

test('normalizeBatch: an entry beyond the total is cut to what is left, entries with nothing left are dropped', () => {
    const list = [{ model: 'a', count: 4 }, { model: 'b', count: 3 }, { model: 'c', count: 3 }, { model: 'd', count: 1 }];
    assert.deepEqual(normalizeBatch(list), [{ model: 'a', count: 4 }, { model: 'b', count: 3 }, { model: 'c', count: 1 }]);
});

test('addToBatch: a new model is appended with count 1', () => {
    assert.deepEqual(addToBatch([{ model: 'a', count: 2 }], 'b'), [{ model: 'a', count: 2 }, { model: 'b', count: 1 }]);
    assert.deepEqual(addToBatch(undefined, 'a'), [{ model: 'a', count: 1 }]);
});

test('addToBatch: a listed model gets count + 1', () => {
    assert.deepEqual(addToBatch([{ model: 'a', count: 2 }, { model: 'b', count: 1 }], 'a'), [{ model: 'a', count: 3 }, { model: 'b', count: 1 }]);
});

test('addToBatch: a model at 4 stays unchanged', () => {
    const list = [{ model: 'a', count: 4 }];
    assert.deepEqual(addToBatch(list, 'a'), list);
});

test('addToBatch: a list at 8 stays unchanged, for a new and a listed model', () => {
    const list = [{ model: 'a', count: 4 }, { model: 'b', count: 3 }, { model: 'c', count: 1 }];
    assert.equal(batchTotal(list), 8);
    assert.deepEqual(addToBatch(list, 'd'), list);
    assert.deepEqual(addToBatch(list, 'c'), list);
});

test('addToBatch returns a new list and leaves the input alone', () => {
    const list = [{ model: 'a', count: 1 }];
    const result = addToBatch(list, 'a');
    assert.notEqual(result, list);
    assert.deepEqual(list, [{ model: 'a', count: 1 }]);
});

test('setBatchCount sets the count of a listed model, normalised', () => {
    const list = [{ model: 'a', count: 1 }, { model: 'b', count: 1 }];
    assert.deepEqual(setBatchCount(list, 'b', 3), [{ model: 'a', count: 1 }, { model: 'b', count: 3 }]);
    assert.deepEqual(setBatchCount(list, 'a', 9), [{ model: 'a', count: 4 }, { model: 'b', count: 1 }]);
    assert.deepEqual(setBatchCount(list, 'a', NaN), [{ model: 'a', count: 1 }, { model: 'b', count: 1 }]);
    assert.deepEqual(setBatchCount(list, 'x', 3), list);
    const full = [{ model: 'a', count: 4 }, { model: 'b', count: 4 }];
    assert.deepEqual(setBatchCount([{ model: 'a', count: 2 }, { model: 'b', count: 4 }], 'a', 4), full);
    assert.deepEqual(setBatchCount(full, 'a', 1), [{ model: 'a', count: 1 }, { model: 'b', count: 4 }]);
});

test('removeFromBatch drops the model', () => {
    const list = [{ model: 'a', count: 2 }, { model: 'b', count: 1 }];
    assert.deepEqual(removeFromBatch(list, 'a'), [{ model: 'b', count: 1 }]);
    assert.deepEqual(removeFromBatch(list, 'x'), list);
});

test('batchTotal counts the pictures of the normalised list', () => {
    assert.equal(batchTotal([]), 0);
    assert.equal(batchTotal(undefined), 0);
    assert.equal(batchTotal([{ model: 'a', count: 2 }, { model: 'b', count: 3 }]), 5);
    assert.equal(batchTotal([{ model: 'a', count: 4 }, { model: 'b', count: 4 }, { model: 'c', count: 4 }]), 8);
});

test('expandImageJobs: an empty list gives the fallback model', () => {
    assert.deepEqual(expandImageJobs([], 'fallback'), ['fallback']);
    assert.deepEqual(expandImageJobs(undefined, 'fallback'), ['fallback']);
    assert.deepEqual(expandImageJobs([{ model: '' }], 'fallback'), ['fallback']);
});

test('expandImageJobs: model ids repeated count times, in list order', () => {
    const list = [{ model: 'model-a', count: 2 }, { model: 'model-b', count: 1 }, { model: 'model-c', count: 3 }];
    assert.deepEqual(expandImageJobs(list, 'fallback'), ['model-a', 'model-a', 'model-b', 'model-c', 'model-c', 'model-c']);
});

test('DEFAULT_SETTINGS.batch is an empty frozen list per provider', () => {
    assert.deepEqual(DEFAULT_SETTINGS.batch, { nanogpt: [], openrouter: [] });
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS.batch));
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS.batch.nanogpt));
    assert.ok(Object.isFrozen(DEFAULT_SETTINGS.batch.openrouter));
});

test('normalizeSettings: batch defaults to an empty list per provider', () => {
    for (const batch of [undefined, null, 'x', [], { nanogpt: 'x' }]) {
        assert.deepEqual(normalizeSettings({ batch }).batch, { nanogpt: [], openrouter: [] }, JSON.stringify(batch));
    }
});

test('normalizeSettings normalises batch per provider and drops unknown providers', () => {
    const batch = {
        nanogpt: [{ model: ' a ', count: 9 }, { model: 'a', count: 1 }, { model: 'b', count: 2 }],
        openrouter: [{ model: 'x', count: 5 }, { model: 'y', count: 5 }],
        other: [{ model: 'z', count: 1 }],
    };
    assert.deepEqual(normalizeSettings({ batch }).batch, {
        nanogpt: [{ model: 'a', count: 4 }, { model: 'b', count: 2 }],
        openrouter: [{ model: 'x', count: 4 }, { model: 'y', count: 4 }],
    });
});
