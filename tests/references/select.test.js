import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PER_NAME_LIMIT, NAME_LIMIT, REFERENCE_LIMIT, normalizeNames, toCandidates, knownNames, matchName,
    resolveShownNames, findNamesInText, selectReferences, buildReferencePreamble,
    groupKey, groupCandidates, allNames, moveInList,
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

test('toCandidates: named uploads and gallery records in group order; fields normalised', () => {
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
    // Spec 14.2: pictures without a name (u3) are left out; groups by number of names, then key.
    assert.deepEqual(toCandidates({ uploads, gallery }), [
        { url: 'u1', names: ['Kyouko'], enabled: true, source: 'upload', timestamp: 5 },
        { url: 'g5', names: ['Tooru'], enabled: false, source: 'generated', timestamp: 0 },
        { url: 'g1', names: ['Kyouko', 'Yuki'], enabled: true, source: 'generated', timestamp: 9 },
        { url: 'u2', names: ['Yuki', 'Tooru'], enabled: false, source: 'upload', timestamp: 0 },
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

test('selectReferences tie-breaks: fewer names, then list order', () => {
    // Default list order as toCandidates builds it: uploads oldest first, generated pictures newest first.
    const single = [upload('first', ['A'], { timestamp: 1 }), upload('second', ['A'], { timestamp: 2 }), generated('gen', ['A'], { timestamp: 50 })];
    assert.deepEqual(urls(selectReferences({ candidates: single, sceneNames: ['A'], maxImages: 1 })), ['first']);
    assert.deepEqual(urls(selectReferences({ candidates: single, sceneNames: ['A'], maxImages: 2 })), ['first', 'second']);
    const groups = [upload('abc', ['A', 'B', 'C']), generated('ab-new', ['A', 'B'], { timestamp: 2 }), generated('ab-old', ['A', 'B'], { timestamp: 1 })];
    assert.deepEqual(urls(selectReferences({ candidates: groups, sceneNames: ['A', 'B'], maxImages: 1 })), ['ab-new']);
    const sameCover = [upload('ab', ['A', 'B']), upload('a', ['A'])];
    assert.deepEqual(urls(selectReferences({ candidates: sameCover, sceneNames: ['A', 'B'], maxImages: 5 })), ['ab', 'a']);
    assert.deepEqual(urls(selectReferences({ candidates: single, sceneNames: ['a', 'A'], maxImages: 5, perNameLimit: 1 })), ['first']);
    // The source is no tie-break of its own any more (spec 14.2): list order decides.
    const genFirst = [generated('gen', ['A']), upload('up', ['A'])];
    assert.deepEqual(urls(selectReferences({ candidates: genFirst, sceneNames: ['A'], maxImages: 1 })), ['gen']);
});

test('groupKey: names normalised, case and order ignored, empty for no names', () => {
    assert.equal(groupKey(['Yuki', 'Kyouko']), 'kyouko|yuki');
    assert.equal(groupKey(' kyouko , YUKI, Kyouko'), 'kyouko|yuki');
    assert.equal(groupKey(['Kyouko']), 'kyouko');
    assert.equal(groupKey([]), '');
    assert.equal(groupKey(undefined), '');
    assert.equal(groupKey(' , '), '');
});

const LIBRARY = {
    uploads: [
        { url: 'u-kyouko-1', names: ['Kyouko'] },
        { url: 'u-pair', names: ['Yuki', 'Kyouko'] },
        { url: 'u-kyouko-2', names: ['kyouko'] },
        { url: 'u-nameless', names: [] },
        { url: 'u-tooru', names: ['Tooru'], enabled: false },
    ],
    gallery: [
        { url: 'g-kyouko-new', names: ['Kyouko'], timestamp: 9 },
        { url: 'g-pair', names: ['kyouko', 'yuki'], timestamp: 8 },
        { url: 'g-plain', prompt: 'no names' },
        { url: 'g-kyouko-old', names: ['KYOUKO'], timestamp: 7 },
    ],
};

const groupUrls = (groups) => groups.map((group) => [group.key, group.items.map((item) => item.url)]);

test('groupCandidates: uploads and generated pictures of the same people share a group, default order, sorting', () => {
    const groups = groupCandidates(LIBRARY);
    assert.deepEqual(groupUrls(groups), [
        ['kyouko', ['u-kyouko-1', 'u-kyouko-2', 'g-kyouko-new', 'g-kyouko-old']],
        ['tooru', ['u-tooru']],
        ['kyouko|yuki', ['u-pair', 'g-pair']],
    ]);
    assert.deepEqual(groups[0].names, ['Kyouko']);
    assert.deepEqual(groups[2].names, ['Yuki', 'Kyouko']);
    assert.deepEqual(groups[1].items[0], { url: 'u-tooru', names: ['Tooru'], enabled: false, source: 'upload', timestamp: 0 });
    assert.equal(groups[0].items[2].source, 'generated');
    assert.deepEqual(groupCandidates({}), []);
    assert.deepEqual(groupCandidates(), []);
});

test('groupCandidates: a stored order wins, new pictures go to the end, stale urls and garbage are ignored', () => {
    const order = { kyouko: ['g-kyouko-old', 'gone.jpg', 'u-kyouko-2', 'g-kyouko-old', 7] };
    assert.deepEqual(groupUrls(groupCandidates({ ...LIBRARY, order }))[0],
        ['kyouko', ['g-kyouko-old', 'u-kyouko-2', 'u-kyouko-1', 'g-kyouko-new']]);
    // A full stored order, then a newer generated picture arrives: it goes to the end, the pinned one stays on top.
    const full = { kyouko: ['g-kyouko-old', 'u-kyouko-1', 'u-kyouko-2', 'g-kyouko-new'] };
    const later = { ...LIBRARY, gallery: [{ url: 'g-kyouko-newest', names: ['Kyouko'], timestamp: 10 }, ...LIBRARY.gallery], order: full };
    assert.deepEqual(groupUrls(groupCandidates(later))[0],
        ['kyouko', ['g-kyouko-old', 'u-kyouko-1', 'u-kyouko-2', 'g-kyouko-new', 'g-kyouko-newest']]);
    const unsorted = groupUrls(groupCandidates(LIBRARY));
    for (const garbage of [null, 'x', ['kyouko'], { kyouko: [] }, { kyouko: 'g-kyouko-old' }, { kyouko: null }, { other: ['g-kyouko-old'] }]) {
        assert.deepEqual(groupUrls(groupCandidates({ ...LIBRARY, order: garbage })), unsorted, JSON.stringify(garbage));
    }
});

test('toCandidates with order: flattened group order', () => {
    const order = { 'kyouko|yuki': ['g-pair'] };
    assert.deepEqual(toCandidates({ ...LIBRARY, order }).map((item) => item.url), [
        'u-kyouko-1', 'u-kyouko-2', 'g-kyouko-new', 'g-kyouko-old', 'u-tooru', 'g-pair', 'u-pair',
    ]);
});

test('allNames: every name, enabled or not, unique ignoring case (first spelling), sorted', () => {
    assert.deepEqual(allNames(groupCandidates(LIBRARY)), ['Kyouko', 'Tooru', 'Yuki']);
    const groups = [
        { items: [{ names: ['zoe'] }, { names: ['Zoe'] }] },
        { items: [{ names: ['Ümit', 'anna'] }] },
    ];
    assert.deepEqual(allNames(groups), ['anna', 'Ümit', 'zoe']);
    assert.deepEqual(allNames(null), []);
    assert.deepEqual(allNames([null, {}]), []);
});

test('moveInList: both directions, both ends, missing value; always a copy', () => {
    const list = ['a', 'b', 'c'];
    assert.deepEqual(moveInList(list, 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(moveInList(list, 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(moveInList(list, 'a', -1), ['a', 'b', 'c']);
    assert.deepEqual(moveInList(list, 'c', 1), ['a', 'b', 'c']);
    assert.deepEqual(moveInList(list, 'x', 1), ['a', 'b', 'c']);
    assert.deepEqual(list, ['a', 'b', 'c']);
    assert.notEqual(moveInList(list, 'x', 1), list);
    assert.deepEqual(moveInList(null, 'a', 1), []);
});

test('selectReferences: the 12.7 examples still hold when the candidates come from toCandidates', () => {
    const pair = toCandidates({
        uploads: [{ url: 'kyouko', names: ['Kyouko'] }, { url: 'yuki', names: ['Yuki'] }],
        gallery: [{ url: 'pair', names: ['Kyouko', 'Yuki'] }],
    });
    assert.deepEqual(urls(selectReferences({ candidates: pair, sceneNames: ['Kyouko', 'Yuki'], maxImages: 10 })), ['pair', 'kyouko', 'yuki']);
    const four = toCandidates({
        uploads: ['A', 'B', 'C', 'D'].map((name) => ({ url: name.toLowerCase(), names: [name] })),
        gallery: [{ url: 'ab', names: ['A', 'B'] }],
    });
    assert.deepEqual(urls(selectReferences({ candidates: four, sceneNames: ['A', 'B', 'C', 'D'], maxImages: 3 })), ['ab', 'c', 'd']);
    const horimiya = toCandidates({
        uploads: [
            { url: 'yuki+tooru', names: ['Yuki', 'Tooru'] }, { url: 'kyouko', names: ['Kyouko'] }, { url: 'yuki', names: ['Yuki'] },
            { url: 'trio', names: ['Yuki', 'Tooru', 'Kyouko'] }, { url: 'miyamura', names: ['Miyamura'] }, { url: 'sengoku', names: ['Sengoku'] },
        ],
    });
    const sceneNames = ['Kyouko', 'Yuki', 'Tooru', 'Miyamura', 'Sengoku'];
    assert.deepEqual(urls(selectReferences({ candidates: horimiya, sceneNames, maxImages: 3 })), ['trio', 'miyamura', 'sengoku']);
    assert.deepEqual(urls(selectReferences({ candidates: horimiya, sceneNames, maxImages: 10 })), ['trio', 'miyamura', 'sengoku', 'kyouko', 'yuki']);
    const twoEach = toCandidates({
        uploads: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((url) => ({ url, names: [url[0].toUpperCase()] })),
    });
    assert.deepEqual(urls(selectReferences({ candidates: twoEach, sceneNames: ['A', 'B', 'C'], maxImages: 4 })), ['a1', 'b1', 'c1', 'a2']);
});

test('selectReferences: a generated picture moved in front of an upload by a stored order is chosen first', () => {
    const uploads = [{ url: 'up', names: ['Kyouko'] }];
    const gallery = [{ url: 'gen', names: ['Kyouko'] }];
    const unsorted = toCandidates({ uploads, gallery });
    assert.deepEqual(urls(selectReferences({ candidates: unsorted, sceneNames: ['Kyouko'], maxImages: 1 })), ['up']);
    const sorted = toCandidates({ uploads, gallery, order: { kyouko: ['gen', 'up'] } });
    assert.deepEqual(urls(selectReferences({ candidates: sorted, sceneNames: ['Kyouko'], maxImages: 1 })), ['gen']);
    assert.deepEqual(urls(selectReferences({ candidates: sorted, sceneNames: ['Kyouko'], maxImages: 2 })), ['gen', 'up']);
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
