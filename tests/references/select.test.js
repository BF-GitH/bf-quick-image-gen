import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PER_NAME_LIMIT, NAME_LIMIT, REFERENCE_LIMIT, normalizeNames, toCandidates, knownNames, matchName,
    resolveShownNames, findNamesInText, selectReferences, buildReferencePreamble,
} from '../../src/references/select.js';

function upload(url, names, extra = {}) {
    return { url, names, enabled: true, source: 'upload', timestamp: 0, ...extra };
}

function generated(url, names, extra = {}) {
    return { url, names, enabled: true, source: 'generated', timestamp: 0, ...extra };
}

const urls = (selected) => selected.map((item) => item.url);

test('constants', () => {
    assert.equal(PER_NAME_LIMIT, 2);
    assert.equal(NAME_LIMIT, 8);
    assert.equal(REFERENCE_LIMIT, 100);
});

test('normalizeNames splits strings, trims, cuts, dedupes ignoring case and caps', () => {
    assert.deepEqual(normalizeNames(' Kyouko , Yuki,, kyouko ,  '), ['Kyouko', 'Yuki']);
    assert.deepEqual(normalizeNames(['Kyouko', ' Yuki ', '', 5, null, 'YUKI']), ['Kyouko', 'Yuki']);
    assert.deepEqual(normalizeNames(['a, b']), ['a, b']);
    assert.equal(normalizeNames('x'.repeat(100))[0].length, 60);
    const many = Array.from({ length: NAME_LIMIT + 4 }, (_, i) => `N${i}`);
    assert.equal(normalizeNames(many.join(',')).length, NAME_LIMIT);
    for (const garbage of [undefined, null, 7, {}, true]) assert.deepEqual(normalizeNames(garbage), []);
});

test('toCandidates: uploads first, then named gallery records; fields normalised', () => {
    const uploads = [
        { url: 'u1', names: ['Kyouko'], enabled: true, timestamp: 5 },
        { url: 'u2', names: 'Yuki, Tooru', enabled: false },
        { url: '', names: ['X'] }, { names: ['Y'] }, null,
        { url: 'u3', names: [], timestamp: NaN },
    ];
    const gallery = [
        { url: 'g1', names: ['Kyouko', 'Yuki'], timestamp: 9, prompt: 'p' },
        { url: 'g2', names: [], timestamp: 8 },
        { url: 'g3', prompt: 'no names' },
        { url: 'g4', names: 'Kyouko' },
        { url: 'g5', names: ['Tooru'], enabled: false, timestamp: 'x' },
    ];
    assert.deepEqual(toCandidates({ uploads, gallery }), [
        { url: 'u1', names: ['Kyouko'], enabled: true, source: 'upload', timestamp: 5 },
        { url: 'u2', names: ['Yuki', 'Tooru'], enabled: false, source: 'upload', timestamp: 0 },
        { url: 'u3', names: [], enabled: true, source: 'upload', timestamp: 0 },
        { url: 'g1', names: ['Kyouko', 'Yuki'], enabled: true, source: 'generated', timestamp: 9 },
        { url: 'g5', names: ['Tooru'], enabled: false, source: 'generated', timestamp: 0 },
    ]);
    assert.deepEqual(toCandidates({}), []);
    assert.deepEqual(toCandidates({ uploads: 'x', gallery: null }), []);
});

test('knownNames: names of enabled candidates, unique ignoring case, in order', () => {
    const candidates = [
        upload('a', ['Kyouko']), upload('b', ['Tooru'], { enabled: false }),
        generated('c', ['kyouko', 'Yuki']), upload('d', ['Miyamura']),
    ];
    assert.deepEqual(knownNames(candidates), ['Kyouko', 'Yuki', 'Miyamura']);
    assert.deepEqual(knownNames(null), []);
});

test('matchName with the measured chat-model answers', () => {
    const known = ['Kyouko', 'Yuki'];
    assert.equal(matchName('Kyouko Hori from Horimiya', known), 'Kyouko');
    assert.equal(matchName('Yuki Yoshikawa', known), 'Yuki');
    assert.equal(matchName('Izumi Miyamura', known), null);
});

test('matchName: equal wins, word subsets both ways, most words, then the first', () => {
    assert.equal(matchName('kyouko', ['Kyouko Hori', 'Kyouko']), 'Kyouko');
    assert.equal(matchName('Kyouko', ['Kyouko Hori']), 'Kyouko Hori');
    assert.equal(matchName('Kyouko Hori', ['Kyouko', 'Hori Kyouko']), 'Hori Kyouko');
    assert.equal(matchName('Kyouko Hori', ['Kyouko', 'Kyouko Hori Senpai', 'Hori Kyouko']), 'Kyouko Hori Senpai');
    assert.equal(matchName('Kyouko Hori', ['Hori', 'Kyouko']), 'Hori');
    assert.equal(matchName('Kyou', ['Kyouko']), null);
    assert.equal(matchName('Hermione Granger FROM Harry Potter', ['Hermione Granger']), 'Hermione Granger');
    assert.equal(matchName('   ', ['Kyouko']), null);
    assert.equal(matchName(' from Horimiya', ['Kyouko']), null);
    assert.equal(matchName(null, ['Kyouko']), null);
    assert.equal(matchName('Kyouko', null), null);
});

test('resolveShownNames maps to known spellings, keeps unknown names, dedupes', () => {
    const known = ['Kyouko', 'Yuki'];
    assert.deepEqual(
        resolveShownNames(['Kyouko Hori from Horimiya', 'Izumi Miyamura from Horimiya', 'kyouko', ' ', 'Yuki Yoshikawa'], known),
        ['Kyouko', 'Izumi Miyamura', 'Yuki'],
    );
    assert.deepEqual(resolveShownNames(null, known), []);
});

test('findNamesInText: whole words, phrases, ignoring case, ordered by first position', () => {
    const known = ['Yuki', 'Kyouko', 'Tooru Ishikawa', 'Ann'];
    const text = 'Kyouko waves. Later tooru   ishikawa and YUKI arrive; Anna stays home.';
    assert.deepEqual(findNamesInText(text, known), ['Kyouko', 'Tooru Ishikawa', 'Yuki']);
    assert.deepEqual(findNamesInText('Tooru waits.', known), []);
    assert.deepEqual(findNamesInText('Kyoukos bag', known), []);
    assert.deepEqual(findNamesInText(null, known), []);
    assert.deepEqual(findNamesInText('Süßer Ümit', ['Ümit']), ['Ümit']);
});

test('selectReferences: group picture first, then the singles (owner example)', () => {
    const candidates = [upload('kyouko', ['Kyouko']), upload('yuki', ['Yuki']), generated('pair', ['Kyouko', 'Yuki'], { timestamp: 9 })];
    const selected = selectReferences({ candidates, sceneNames: ['Kyouko', 'Yuki'], maxImages: 10 });
    assert.deepEqual(urls(selected), ['pair', 'kyouko', 'yuki']);
    assert.deepEqual(selected[0], { url: 'pair', names: ['Kyouko', 'Yuki'] });
});

test('selectReferences: four people, maxImages 3 -> group picture plus two singles', () => {
    const candidates = [
        upload('a', ['A']), upload('b', ['B']), upload('c', ['C']), upload('d', ['D']), generated('ab', ['A', 'B']),
    ];
    assert.deepEqual(urls(selectReferences({ candidates, sceneNames: ['A', 'B', 'C', 'D'], maxImages: 3 })), ['ab', 'c', 'd']);
});

test('selectReferences: the Horimiya library for 3 and for 10 pictures', () => {
    const candidates = [
        upload('yuki+tooru', ['Yuki', 'Tooru']), upload('kyouko', ['Kyouko']), upload('yuki', ['Yuki']),
        upload('trio', ['Yuki', 'Tooru', 'Kyouko']), upload('miyamura', ['Miyamura']), upload('sengoku', ['Sengoku']),
    ];
    const sceneNames = ['Kyouko', 'Yuki', 'Tooru', 'Miyamura', 'Sengoku'];
    assert.deepEqual(urls(selectReferences({ candidates, sceneNames, maxImages: 3 })), ['trio', 'miyamura', 'sengoku']);
    assert.deepEqual(
        urls(selectReferences({ candidates, sceneNames, maxImages: 10 })),
        ['trio', 'miyamura', 'sengoku', 'kyouko', 'yuki'],
    );
});

test('selectReferences: two uploads each, maxImages 4 -> one each, then the first person\'s second', () => {
    const candidates = [
        upload('a1', ['A']), upload('a2', ['A']), upload('b1', ['B']), upload('b2', ['B']), upload('c1', ['C']), upload('c2', ['C']),
    ];
    assert.deepEqual(urls(selectReferences({ candidates, sceneNames: ['A', 'B', 'C'], maxImages: 4 })), ['a1', 'b1', 'c1', 'a2']);
    assert.deepEqual(
        urls(selectReferences({ candidates, sceneNames: ['A', 'B', 'C'], maxImages: 99 })),
        ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'],
    );
});

test('selectReferences never takes outsiders, disabled pictures, or anything for maxImages 0', () => {
    const candidates = [
        generated('with-outsider', ['A', 'Z'], { timestamp: 99 }), upload('off', ['A'], { enabled: false }),
        upload('nameless', []), generated('a', ['a']),
    ];
    assert.deepEqual(urls(selectReferences({ candidates, sceneNames: ['A'], maxImages: 5 })), ['a']);
    assert.deepEqual(selectReferences({ candidates, sceneNames: ['A'], maxImages: 0 }), []);
    assert.deepEqual(selectReferences({ candidates, sceneNames: [], maxImages: 5 }), []);
    assert.deepEqual(selectReferences({ candidates, sceneNames: ['A'], maxImages: undefined }), []);
});

test('selectReferences tie-breaks: upload before generated, fewer names, list order', () => {
    // List order as toCandidates builds it: uploads oldest first, generated pictures newest first.
    const single = [upload('first', ['A'], { timestamp: 1 }), upload('second', ['A'], { timestamp: 2 }), generated('gen', ['A'], { timestamp: 50 })];
    assert.deepEqual(urls(selectReferences({ candidates: single, sceneNames: ['A'], maxImages: 1 })), ['first']);
    assert.deepEqual(urls(selectReferences({ candidates: single, sceneNames: ['A'], maxImages: 2 })), ['first', 'second']);
    const groups = [upload('abc', ['A', 'B', 'C']), generated('ab-new', ['A', 'B'], { timestamp: 2 }), generated('ab-old', ['A', 'B'], { timestamp: 1 })];
    assert.deepEqual(urls(selectReferences({ candidates: groups, sceneNames: ['A', 'B'], maxImages: 1 })), ['ab-new']);
    const sameCover = [upload('ab', ['A', 'B']), upload('a', ['A'])];
    assert.deepEqual(urls(selectReferences({ candidates: sameCover, sceneNames: ['A', 'B'], maxImages: 5 })), ['ab', 'a']);
    assert.deepEqual(urls(selectReferences({ candidates: single, sceneNames: ['a', 'A'], maxImages: 5, perNameLimit: 1 })), ['first']);
});

test('buildReferencePreamble: exact text, name joining, empty list', () => {
    assert.equal(
        buildReferencePreamble([{ url: 'x', names: ['Kyouko', 'Yuki'] }, { url: 'y', names: ['Tooru'] }]),
        'Reference images: image 1 shows Kyouko and Yuki; image 2 shows Tooru. Draw these people exactly as in their reference images: same face, eyes, hair and drawing style. Where the description differs from a reference image, the reference image wins. Scene: ',
    );
    assert.ok(buildReferencePreamble([{ url: 'x', names: ['A', 'B', 'C'] }]).startsWith('Reference images: image 1 shows A, B and C. Draw'));
    assert.equal(buildReferencePreamble([]), '');
    assert.equal(buildReferencePreamble(undefined), '');
});
