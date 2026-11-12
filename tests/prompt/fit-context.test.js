import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_INSTRUCTION, fitContext, buildSceneBlock, buildDirectPrompt, finalizePrompt, directSceneBudget,
} from '../../src/prompt/scene.js';

function words(prefix, length) {
    let text = '';
    for (let i = 0; text.length < length; i++) text += `${prefix}${i} `;
    return text.slice(0, length).trim();
}

const BG = '[Background, reference only: looks and world]';
const EARLIER = '[Earlier messages, context only]';
const CURRENT = '[Current moment, depict this]';

const FIRST = { name: 'Bob', text: words('opening', 2600) };
const USER = { name: 'Anna', text: 'Anna opens the red door and steps into the rain-soaked courtyard.' };
const REPLY = { name: 'Bob', text: 'Bob follows her outside, lantern raised, the wet cobblestones gleaming in its light.' };

// Same steps as the direct path in src/prompt/build.js.
function directPrompt(context, { instruction, styleSuffix, maxChars }) {
    const budget = directSceneBudget({ instruction, styleSuffix, maxChars });
    const sceneBlock = buildSceneBlock(fitContext(context, budget), { currentFirst: true });
    return finalizePrompt(buildDirectPrompt({ instruction, sceneBlock }), { styleSuffix, maxChars });
}

test('direct prompt with a 2600-char first message keeps the full reply and user message', () => {
    const styleSuffix = 'anime style, soft lighting';
    const prompt = directPrompt({ first: FIRST, recent: [USER, REPLY] }, { instruction: DEFAULT_INSTRUCTION, styleSuffix, maxChars: 1800 });
    assert.ok(prompt.length <= 1800);
    assert.ok(prompt.includes(USER.text));
    assert.ok(prompt.includes(REPLY.text));
    assert.ok(prompt.includes('opening0'), 'first message still contributes');
    assert.ok(prompt.endsWith(` Style: ${styleSuffix}`));
});

test('end to end, maxChars 800: instruction first, current moment before background, newest message complete', () => {
    const instruction = 'Paint this scene as one image.';
    const prompt = directPrompt({ first: FIRST, recent: [USER, REPLY] }, { instruction, styleSuffix: '', maxChars: 800 });
    assert.ok(prompt.length <= 800, `length ${prompt.length}`);
    assert.ok(prompt.startsWith(`${instruction}\n\n${CURRENT}\n`));
    assert.ok(prompt.includes(`Bob: ${REPLY.text}`), 'the complete newest message is present');
    const current = prompt.indexOf(CURRENT);
    const background = prompt.indexOf(BG);
    assert.ok(background > 0, 'background still contributes');
    assert.ok(current < background, 'current moment comes before the background');
    assert.ok(prompt.indexOf(EARLIER) > current && prompt.indexOf(EARLIER) < background);
});

test('end to end, maxChars 800 with the default instruction keeps the current moment in full', () => {
    const prompt = directPrompt({ first: FIRST, recent: [USER, REPLY] }, { instruction: DEFAULT_INSTRUCTION, styleSuffix: 'oil', maxChars: 800 });
    assert.ok(prompt.length <= 800);
    assert.ok(prompt.startsWith(`${DEFAULT_INSTRUCTION}\n\n${CURRENT}\nBob: ${REPLY.text}`));
    assert.ok(prompt.endsWith(' Style: oil'));
});

test('a tiny budget still carries the current moment', () => {
    const fitted = fitContext({ first: FIRST, recent: [USER, REPLY] }, 300);
    const block = buildSceneBlock(fitted, { currentFirst: true });
    assert.ok(block.length <= 300);
    assert.ok(block.includes(REPLY.text));
});

test('the result never exceeds the budget', () => {
    const long = (name, n) => ({ name, text: words(name, n) });
    const recent = [long('a', 1500), long('b', 900), long('c', 1500), long('d', 40), long('e', 1200)];
    for (let budget = 80; budget <= 4000; budget += 37) {
        for (const first of [FIRST, null, { name: 'X', text: 'short opening' }]) {
            for (const entries of [recent, recent.slice(-1), []]) {
                const fitted = fitContext({ first, recent: entries }, budget);
                for (const currentFirst of [true, false]) {
                    const block = buildSceneBlock(fitted, { currentFirst });
                    assert.ok(block.length <= budget, `budget ${budget}: ${block.length}`);
                }
            }
        }
    }
});

test('the current entry is always kept, truncated when needed', () => {
    const reply = { name: 'Bob', text: words('reply', 1500) };
    const fitted = fitContext({ first: FIRST, recent: [USER, reply] }, 200);
    assert.equal(fitted.recent.length, 1);
    assert.equal(fitted.first, null, 'nothing is left for the background');
    assert.ok(reply.text.startsWith(fitted.recent[0].text));
    assert.ok(fitted.recent[0].text.length > 100);
});

test('a 2600-char background and a small budget: the current entry stays in full, the background takes at most 30 percent', () => {
    for (const budget of [600, 1000, 1500, 4000]) {
        const fitted = fitContext({ first: FIRST, recent: [USER, REPLY] }, budget);
        assert.deepEqual(fitted.recent[fitted.recent.length - 1], REPLY, `budget ${budget}`);
        assert.ok(fitted.first, `budget ${budget}: background kept`);
        const backgroundLength = buildSceneBlock({ first: fitted.first, recent: [] }).length;
        assert.ok(backgroundLength <= Math.floor(budget * 0.3), `budget ${budget}: background ${backgroundLength}`);
        assert.ok(buildSceneBlock(fitted, { currentFirst: true }).length <= budget);
    }
});

test('earlier entries, newest first, take priority over the background', () => {
    const recent = [{ name: 'A', text: words('x', 300) }, { name: 'B', text: words('y', 300) }, REPLY];
    const fitted = fitContext({ first: FIRST, recent }, 700);
    assert.equal(fitted.first, null, 'the earlier entries leave no room for the background');
    assert.equal(fitted.recent.length, 3);
    assert.deepEqual(fitted.recent.slice(1), [recent[1], REPLY], 'newest earlier entry and current kept whole');
    assert.ok(fitted.recent[0].text.length < recent[0].text.length && recent[0].text.startsWith(fitted.recent[0].text));
    assert.ok(buildSceneBlock(fitted).length <= 700);
});

test('without recent messages the background may use the whole budget', () => {
    const fitted = fitContext({ first: FIRST, recent: [] }, 500);
    assert.deepEqual(fitted.recent, []);
    assert.ok(fitted.first.text.length > 400);
    assert.ok(buildSceneBlock(fitted).length <= 500);
});

test('without a background the recent messages may use the whole budget', () => {
    const recent = [{ name: 'A', text: words('x', 900) }, { name: 'B', text: words('y', 900) }];
    const fitted = fitContext({ first: null, recent }, 1000);
    assert.equal(fitted.first, null);
    assert.ok(buildSceneBlock(fitted).length > 800);
});

test('entries stay oldest first and untouched when everything fits', () => {
    const context = { first: { name: 'X', text: 'start' }, recent: [{ name: 'A', text: 'one' }, { name: 'B', text: 'two' }, { name: 'C', text: 'three' }] };
    assert.deepEqual(fitContext(context, 1000), context);
    const cut = fitContext({ first: null, recent: [USER, REPLY, { name: 'C', text: 'last' }] }, 1000);
    assert.deepEqual(cut.recent.map((e) => e.name), ['Anna', 'Bob', 'C']);
});

test('an earlier entry is cut only when at least 80 characters of it remain', () => {
    const reply = { name: 'B', text: 'r'.repeat(300) };
    const older = { name: 'A', text: words('o', 500) };
    const fit = (budget) => fitContext({ first: null, recent: [older, reply] }, budget);
    const current = `${CURRENT}\nB: `.length + 300;
    const earlierOverhead = 2 + `${EARLIER}\n`.length + 'A: '.length;
    assert.deepEqual(fit(current + earlierOverhead + 79).recent, [reply]);
    const kept = fit(current + earlierOverhead + 120).recent;
    assert.equal(kept.length, 2);
    assert.ok(kept[0].text.length >= 80 * 0.8 && older.text.startsWith(kept[0].text));
});

test('an earlier entry dropped for room drops everything older too', () => {
    const recent = [{ name: 'A', text: 'tiny' }, { name: 'B', text: 'b'.repeat(400) }, { name: 'C', text: 'c'.repeat(200) }];
    const budget = `${CURRENT}\nC: `.length + 200 + 2 + `${EARLIER}\n`.length + 50;
    const fitted = fitContext({ first: null, recent }, budget);
    assert.deepEqual(fitted.recent.map((e) => e.name), ['C']);
});

test('a background that would get fewer than 80 characters is dropped', () => {
    const recent = [{ name: 'B', text: 'b'.repeat(80) }];
    const backgroundOverhead = `${BG}\nBob: `.length;
    // The background section may take 30 % of the budget; its text room is that share minus heading and name.
    const roomAt = (budget) => Math.floor(budget * 0.3) - backgroundOverhead;
    assert.ok(roomAt(600) >= 80);
    assert.equal(fitContext({ first: FIRST, recent }, 600).first.text.length <= roomAt(600), true);
    // At 400 the room falls below 80 characters: dropped, the current moment stays.
    assert.ok(roomAt(400) < 80);
    const fitted = fitContext({ first: FIRST, recent }, 400);
    assert.equal(fitted.first, null);
    assert.deepEqual(fitted.recent, recent);
    // A short background that fits completely is kept even in a small room.
    assert.ok(fitContext({ first: { name: 'X', text: 'hi' }, recent }, 400).first);
});

test('a budget below 80 characters gives an empty context', () => {
    assert.deepEqual(fitContext({ first: FIRST, recent: [USER, REPLY] }, 79), { first: null, recent: [] });
    assert.deepEqual(fitContext({ first: FIRST, recent: [REPLY] }, -10), { first: null, recent: [] });
});

test('directSceneBudget subtracts instruction, separator and style suffix', () => {
    assert.equal(directSceneBudget({ instruction: 'abc', styleSuffix: '', maxChars: 100 }), 95);
    assert.equal(directSceneBudget({ instruction: 'abc', styleSuffix: ' x ', maxChars: 100 }), 95 - ' Style: x'.length);
});
