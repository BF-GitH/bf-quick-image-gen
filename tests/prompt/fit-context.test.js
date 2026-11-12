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

const FIRST = { name: 'Bob', text: words('opening', 2600) };
const USER = { name: 'Anna', text: 'Anna opens the red door and steps into the rain-soaked courtyard.' };
const REPLY = { name: 'Bob', text: 'Bob follows her outside, lantern raised, the wet cobblestones gleaming in its light.' };

test('direct prompt with a 2600-char first message keeps the full reply and user message', () => {
    const styleSuffix = 'anime style, soft lighting';
    const context = { first: FIRST, recent: [USER, REPLY] };
    const budget = directSceneBudget({ instruction: DEFAULT_INSTRUCTION, styleSuffix, maxChars: 1800 });
    const text = buildDirectPrompt({ instruction: DEFAULT_INSTRUCTION, sceneBlock: buildSceneBlock(fitContext(context, budget)) });
    const prompt = finalizePrompt(text, { styleSuffix, maxChars: 1800 });
    assert.ok(prompt.length <= 1800);
    assert.ok(prompt.includes(USER.text));
    assert.ok(prompt.includes(REPLY.text));
    assert.ok(prompt.includes('opening0'), 'first message still contributes');
    assert.ok(prompt.endsWith(` Style: ${styleSuffix}`));
});

test('a tiny budget still carries the reply text', () => {
    const fitted = fitContext({ first: FIRST, recent: [USER, REPLY] }, 300);
    const block = buildSceneBlock(fitted);
    assert.ok(block.length <= 300);
    assert.ok(block.includes(REPLY.text));
});

test('the result never exceeds the budget', () => {
    const long = (name, n) => ({ name, text: words(name, n) });
    const recent = [long('a', 1500), long('b', 900), long('c', 1500), long('d', 40), long('e', 1200)];
    for (let budget = 80; budget <= 4000; budget += 37) {
        for (const first of [FIRST, null, { name: 'X', text: 'short opening' }]) {
            const block = buildSceneBlock(fitContext({ first, recent }, budget));
            assert.ok(block.length <= budget, `budget ${budget}: ${block.length}`);
        }
    }
});

test('the newest entry is always kept, truncated when needed', () => {
    const reply = { name: 'Bob', text: words('reply', 1500) };
    const fitted = fitContext({ first: null, recent: [USER, reply] }, 200);
    assert.equal(fitted.recent.length, 1);
    assert.ok(reply.text.startsWith(fitted.recent[0].text));
    assert.ok(fitted.recent[0].text.length > 0);
});

test('without a first message the latest messages may use the whole budget', () => {
    const recent = [{ name: 'A', text: words('x', 900) }, { name: 'B', text: words('y', 900) }];
    const fitted = fitContext({ first: null, recent }, 1000);
    assert.equal(fitted.first, null);
    assert.ok(buildSceneBlock(fitted).length > 800);
});

test('without recent messages the first message gets the budget', () => {
    const fitted = fitContext({ first: FIRST, recent: [] }, 500);
    assert.deepEqual(fitted.recent, []);
    assert.ok(fitted.first.text.length > 400);
    assert.ok(buildSceneBlock(fitted).length <= 500);
});

test('entries stay oldest first and untouched when everything fits', () => {
    const context = { first: { name: 'X', text: 'start' }, recent: [{ name: 'A', text: 'one' }, { name: 'B', text: 'two' }, { name: 'C', text: 'three' }] };
    assert.deepEqual(fitContext(context, 1000), context);
    const cut = fitContext({ first: null, recent: [USER, REPLY, { name: 'C', text: 'last' }] }, 1000);
    assert.deepEqual(cut.recent.map((e) => e.name), ['Anna', 'Bob', 'C']);
});

test('with a first message the latest messages take at most 60 percent', () => {
    const recent = [{ name: 'A', text: words('x', 1500) }, { name: 'B', text: words('y', 1500) }];
    const fitted = fitContext({ first: FIRST, recent }, 1000);
    const recentLength = buildSceneBlock({ first: null, recent: fitted.recent }).length;
    assert.ok(recentLength <= 600, `recent ${recentLength}`);
    assert.ok(recentLength > 500, 'the share is used');
    assert.ok(fitted.first, 'the rest goes to the first message');
    assert.ok(buildSceneBlock(fitted).length <= 1000);
});

test('an older entry is cut only when at least 80 characters of it remain', () => {
    // Reply takes almost everything; less than 80 chars remain for the older one, so it is dropped.
    const reply = { name: 'B', text: 'r'.repeat(300) };
    const older = { name: 'A', text: words('o', 500) };
    const block = (budget) => fitContext({ first: null, recent: [older, reply] }, budget);
    const header = '[Latest messages, oldest first]\n'.length;
    const replyLength = 'B: '.length + 300;
    assert.deepEqual(block(header + replyLength + 2 + 3 + 79).recent, [reply]);
    const kept = block(header + replyLength + 2 + 3 + 120).recent;
    assert.equal(kept.length, 2);
    assert.ok(kept[0].text.length >= 80 * 0.8 && older.text.startsWith(kept[0].text));
});

test('an entry dropped for room drops everything older too', () => {
    const recent = [{ name: 'A', text: 'tiny' }, { name: 'B', text: 'b'.repeat(400) }, { name: 'C', text: 'c'.repeat(200) }];
    const fitted = fitContext({ first: null, recent }, 32 + 203 + 2 + 50);
    assert.deepEqual(fitted.recent.map((e) => e.name), ['C']);
});

test('a first message that would get fewer than 80 characters is dropped', () => {
    const recent = [{ name: 'B', text: 'b'.repeat(80) }];
    // 60 % of 250 = 150 holds the reply (32 + 83 = 115); the first gets 250 - 115 - 2 - 28 - 5 = 100 chars.
    assert.ok(fitContext({ first: FIRST, recent }, 250).first);
    // At 200 the first would get 200 - 115 - 2 - 28 - 5 = 50 chars: dropped.
    const fitted = fitContext({ first: FIRST, recent }, 200);
    assert.equal(fitted.first, null);
    assert.deepEqual(fitted.recent, recent);
    // A short first message that fits completely is kept even in a small room.
    assert.ok(fitContext({ first: { name: 'X', text: 'hi' }, recent }, 160).first);
});

test('a budget below 80 characters gives an empty context', () => {
    assert.deepEqual(fitContext({ first: FIRST, recent: [USER, REPLY] }, 79), { first: null, recent: [] });
    assert.deepEqual(fitContext({ first: FIRST, recent: [REPLY] }, -10), { first: null, recent: [] });
});

test('directSceneBudget subtracts instruction, separator and style suffix', () => {
    assert.equal(directSceneBudget({ instruction: 'abc', styleSuffix: '', maxChars: 100 }), 95);
    assert.equal(directSceneBudget({ instruction: 'abc', styleSuffix: ' x ', maxChars: 100 }), 95 - ' Style: x'.length);
});
