import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PICTURE_PROMPT_LIMIT, assignPrompts, splitPictureLines } from '../../src/prompt/pictures.js';

test('PICTURE_PROMPT_LIMIT is 8', () => {
    assert.equal(PICTURE_PROMPT_LIMIT, 8);
});

test('splitPictureLines: plain picture lines in order', () => {
    const text = 'Picture 1: One girl, solo: Anna in a polaroid.\nPicture 2: One girl, solo: Anna from the front.';
    assert.deepEqual(splitPictureLines(text), ['One girl, solo: Anna in a polaroid.', 'One girl, solo: Anna from the front.']);
});

test('splitPictureLines: case is ignored, every separator : . ) - is accepted, CRLF works', () => {
    const text = 'picture 1. a\r\nPICTURE 2) b\r\nPicture 3 - c\r\nPicture4: d';
    assert.deepEqual(splitPictureLines(text), ['a', 'b', 'c', 'd']);
});

test('splitPictureLines: markdown and list decoration in front of the word', () => {
    const text = [
        '**Picture 1:** bold one',
        '- Picture 2: dashed one',
        '* Picture 3: starred one',
        '> Picture 4: quoted one',
        '### Picture 5: heading one',
        '`Picture 6:` code one',
        '"Picture 7: quoted text"',
        '  __Picture 8: underscored one',
    ].join('\n');
    assert.deepEqual(splitPictureLines(text), [
        'bold one', 'dashed one', 'starred one', 'quoted one', 'heading one', 'code one', 'quoted text', 'underscored one',
    ]);
});

test('splitPictureLines: wrapped lines belong to the picture above, cleaned to one line', () => {
    const text = 'Picture 1: One girl, solo:\nAnna on a movie set,\n\n  spotlights.\nPicture 2: One girl, solo: Anna walking by.';
    assert.deepEqual(splitPictureLines(text), ['One girl, solo: Anna on a movie set, spotlights.', 'One girl, solo: Anna walking by.']);
});

test('splitPictureLines: numbers out of order keep the order of appearance', () => {
    const text = 'Picture 3: third\nPicture 1: first\nPicture 3: again';
    assert.deepEqual(splitPictureLines(text), ['third', 'first', 'again']);
});

test('splitPictureLines: empty pictures are dropped', () => {
    const text = 'Picture 1:\nPicture 2: **  **\nPicture 3: real';
    assert.deepEqual(splitPictureLines(text), ['real']);
});

test('splitPictureLines: text in front of the first picture line is ignored', () => {
    const text = 'Here are your prompts:\nOne girl, solo: stray line.\nPicture 1: kept';
    assert.deepEqual(splitPictureLines(text), ['kept']);
});

test('splitPictureLines: at most max pictures, default PICTURE_PROMPT_LIMIT', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Picture ${i + 1}: p${i + 1}`).join('\n');
    assert.equal(splitPictureLines(text).length, PICTURE_PROMPT_LIMIT);
    assert.deepEqual(splitPictureLines(text, { max: 3 }), ['p1', 'p2', 'p3']);
});

test('splitPictureLines: no picture line gives an empty list', () => {
    assert.deepEqual(splitPictureLines('One girl, solo: Anna in the rain.'), []);
    assert.deepEqual(splitPictureLines('The pictures: Picture 1: not at line start'), []);
    assert.deepEqual(splitPictureLines('Pictures 1: plural is no marker'), []);
    assert.deepEqual(splitPictureLines('Picture one: no number'), []);
    assert.deepEqual(splitPictureLines(''), []);
    assert.deepEqual(splitPictureLines(undefined), []);
});

test('assignPrompts: the owner\'s example, 2 prompts on "HiDream x8, Seedream x8"', () => {
    const result = assignPrompts(16, 2);
    assert.deepEqual(result, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    for (const half of [result.slice(0, 8), result.slice(8)]) {
        assert.equal(half.filter((p) => p === 0).length, 4);
        assert.equal(half.filter((p) => p === 1).length, 4);
    }
});

test('assignPrompts: 4 prompts on 16 jobs, each model draws each prompt twice', () => {
    const result = assignPrompts(16, 4);
    assert.deepEqual(result, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    for (const half of [result.slice(0, 8), result.slice(8)]) {
        for (const prompt of [0, 1, 2, 3]) assert.equal(half.filter((p) => p === prompt).length, 2);
    }
});

test('assignPrompts: 3 prompts on 16 jobs cover every prompt', () => {
    const result = assignPrompts(16, 3);
    assert.equal(result.length, 16);
    assert.deepEqual(result.slice(0, 4), [0, 1, 2, 0]);
    assert.deepEqual([...new Set(result)].sort(), [0, 1, 2]);
    for (const half of [result.slice(0, 8), result.slice(8)]) assert.deepEqual([...new Set(half)].sort(), [0, 1, 2]);
});

test('assignPrompts: more prompts than jobs uses the first prompts once each', () => {
    assert.deepEqual(assignPrompts(3, 8), [0, 1, 2]);
    assert.deepEqual(assignPrompts(1, 5), [0]);
});

test('assignPrompts: zero and garbage counts', () => {
    assert.deepEqual(assignPrompts(0, 2), []);
    assert.deepEqual(assignPrompts(-3, 2), []);
    for (const jobs of [NaN, undefined, null, '4', {}]) assert.deepEqual(assignPrompts(jobs, 2), [], String(jobs));
    for (const prompts of [0, -1, NaN, undefined, null, '2', {}]) {
        assert.deepEqual(assignPrompts(4, prompts), [0, 0, 0, 0], String(prompts));
    }
    assert.deepEqual(assignPrompts(4.9, 2.9), [0, 1, 0, 1]);
});
