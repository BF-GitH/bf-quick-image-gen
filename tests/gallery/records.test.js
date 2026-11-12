import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GALLERY_LIMIT, addRecord, removeRecord, updateRecord } from '../../src/gallery/records.js';

function record(n, extra = {}) {
    return { url: `user/images/x/${n}.png`, prompt: `p${n}`, provider: 'nanogpt', model: 'm', character: 'C', timestamp: n, ...extra };
}

test('addRecord puts the newest first and does not mutate the input', () => {
    const list = [record(1)];
    const next = addRecord(list, record(2));
    assert.deepEqual(next.map((r) => r.timestamp), [2, 1]);
    assert.equal(list.length, 1);
    assert.notEqual(next, list);
});

test('addRecord caps the list at GALLERY_LIMIT', () => {
    assert.equal(GALLERY_LIMIT, 200);
    let list = [];
    for (let i = 0; i < GALLERY_LIMIT + 5; i++) list = addRecord(list, record(i));
    assert.equal(list.length, GALLERY_LIMIT);
    assert.equal(list[0].timestamp, GALLERY_LIMIT + 4);
    assert.equal(list.at(-1).timestamp, 5);
});

test('addRecord truncates the prompt to 400 characters', () => {
    const [stored] = addRecord([], record(1, { prompt: 'x'.repeat(1000) }));
    assert.equal(stored.prompt.length, 400);
    assert.equal(addRecord([], record(2, { prompt: undefined }))[0].prompt, '');
});

test('addRecord replaces a record with the same url', () => {
    const list = [record(3), record(2), record(1)];
    const next = addRecord(list, record(2, { prompt: 'new', timestamp: 9 }));
    assert.equal(next.length, 3);
    assert.deepEqual(next.map((r) => r.timestamp), [9, 3, 1]);
    assert.equal(next[0].prompt, 'new');
});

test('addRecord tolerates a non-array list', () => {
    assert.equal(addRecord(undefined, record(1)).length, 1);
});

test('addRecord keeps names (normalised) and enabled (boolean, default true)', () => {
    const [plain] = addRecord([], record(1));
    assert.deepEqual(plain.names, []);
    assert.equal(plain.enabled, true);
    const [tagged] = addRecord([], record(2, { names: [' Kyouko ', 'Yuki', 'kyouko', ''], enabled: false }));
    assert.deepEqual(tagged.names, ['Kyouko', 'Yuki']);
    assert.equal(tagged.enabled, false);
    assert.equal(addRecord([], record(3, { enabled: 'no' }))[0].enabled, true);
    assert.deepEqual(addRecord([], record(4, { names: 'A, B' }))[0].names, ['A', 'B']);
});

test('updateRecord applies only names and enabled to the matching url, without mutating', () => {
    const list = [record(1, { names: ['A'], enabled: true }), record(2, { names: ['B'], enabled: true })];
    const next = updateRecord(list, record(2).url, { names: 'Kyouko, Yuki', enabled: false, prompt: 'hack', url: 'x' });
    assert.notEqual(next, list);
    assert.equal(next[0], list[0]);
    assert.deepEqual(next[1], { ...list[1], names: ['Kyouko', 'Yuki'], enabled: false });
    assert.deepEqual(list[1].names, ['B']);
    assert.equal(list[1].enabled, true);
    assert.deepEqual(updateRecord(list, record(1).url, { enabled: false })[0].names, ['A']);
    assert.deepEqual(updateRecord(list, record(1).url, { names: ['C'] })[0].enabled, true);
    assert.deepEqual(updateRecord(list, 'nope', { enabled: false }), list);
    assert.deepEqual(updateRecord(null, 'x', {}), []);
});

test('removeRecord drops only the matching url', () => {
    const list = [record(1), record(2)];
    const next = removeRecord(list, record(1).url);
    assert.deepEqual(next.map((r) => r.timestamp), [2]);
    assert.equal(list.length, 2);
    assert.deepEqual(removeRecord(list, 'nope').length, 2);
    assert.deepEqual(removeRecord(null, 'x'), []);
});
