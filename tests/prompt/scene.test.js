import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_INSTRUCTION, LEGACY_DEFAULT_INSTRUCTIONS, LIMITS, cleanMessageText, truncateText, collectContext, buildSceneBlock,
    buildLlmRequest, buildDirectPrompt, cleanLlmOutput, finalizePrompt,
} from '../../src/prompt/scene.js';

function snapshotsFrom(messages) {
    return (index) => {
        const m = messages[index];
        if (m === undefined || m === null) return null;
        return { index, name: m.name, isUser: !!m.isUser, isSystem: !!m.isSystem, text: m.text };
    };
}

function chat(count) {
    return Array.from({ length: count }, (_, i) => ({ name: i % 2 ? 'Anna' : 'Bob', text: `msg ${i}` }));
}

const BG = '[Background, reference only: looks and world]';
const EARLIER = '[Earlier messages, context only]';
const CURRENT = '[Current moment, depict this]';

test('DEFAULT_INSTRUCTION is the exact single-line text', () => {
    assert.ok(!DEFAULT_INSTRUCTION.includes('\n'));
    assert.equal(DEFAULT_INSTRUCTION, 'Depict the current moment of this roleplay as one image: what happens in the latest message. The picture shows {{char}}, seen through the eyes of {{user}}. {{user}} is not in the picture.');
});

test('LEGACY_DEFAULT_INSTRUCTIONS holds the version 1.0 and 1.1 defaults exactly', () => {
    assert.deepEqual([...LEGACY_DEFAULT_INSTRUCTIONS], [
        'Depict the current moment of this roleplay as one image: the characters present with their appearance (hair, eyes, build, clothing), their pose and expression, the location, lighting and mood. Take the characters\' looks and the setting from the first message and the current action from the latest messages.',
        'Depict the current moment of this roleplay as one image: what happens in the latest message. Show the characters who are present with their appearance (hair, eyes, build, clothing), their pose and expression, the place where they are now, the lighting and the mood.',
    ]);
    assert.ok(Object.isFrozen(LEGACY_DEFAULT_INSTRUCTIONS));
});

test('collectContext always includes message 0 and never repeats it in recent', () => {
    const messages = chat(3);
    const ctx = collectContext({ chatLength: 3, replyIndex: 2, recentCount: 10, getSnapshot: snapshotsFrom(messages) });
    assert.deepEqual(ctx.first, { name: 'Bob', text: 'msg 0' });
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 1', 'msg 2']);
});

test('collectContext keeps message 0 far behind the recent window', () => {
    const messages = chat(50);
    const ctx = collectContext({ chatLength: 50, replyIndex: 49, recentCount: 4, getSnapshot: snapshotsFrom(messages) });
    assert.equal(ctx.first.text, 'msg 0');
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 46', 'msg 47', 'msg 48', 'msg 49']);
});

test('collectContext uses a hidden message 0 (snapshot flags it as system-ish but it stays first)', () => {
    const messages = chat(3);
    messages[0] = { name: 'Bob', text: 'hidden greeting', isSystem: true };
    const ctx = collectContext({ chatLength: 3, replyIndex: 2, recentCount: 4, getSnapshot: snapshotsFrom(messages) });
    assert.deepEqual(ctx.first, { name: 'Bob', text: 'hidden greeting' });
});

test('collectContext skips system, empty and missing messages in recent and respects recentCount', () => {
    const messages = chat(8);
    messages[7] = { name: 'Sys', text: 'note', isSystem: true };
    messages[6] = { name: 'Anna', text: '  <think>only thoughts</think>  ' };
    messages[5] = null;
    const ctx = collectContext({ chatLength: 8, replyIndex: 7, recentCount: 2, getSnapshot: snapshotsFrom(messages) });
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 3', 'msg 4']);
});

test('collectContext starts at replyIndex, not at the chat end', () => {
    const ctx = collectContext({ chatLength: 10, replyIndex: 5, recentCount: 2, getSnapshot: snapshotsFrom(chat(10)) });
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 4', 'msg 5']);
});

test('collectContext with replyIndex 0 has an empty recent list', () => {
    const ctx = collectContext({ chatLength: 1, replyIndex: 0, recentCount: 4, getSnapshot: snapshotsFrom(chat(1)) });
    assert.equal(ctx.first.text, 'msg 0');
    assert.deepEqual(ctx.recent, []);
});

test('collectContext on an empty chat or empty first message gives first = null', () => {
    const empty = collectContext({ chatLength: 0, replyIndex: 0, recentCount: 4, getSnapshot: () => null });
    assert.deepEqual(empty, { first: null, recent: [] });
    const messages = [{ name: 'Bob', text: '   ' }, { name: 'Anna', text: 'hi' }];
    const ctx = collectContext({ chatLength: 2, replyIndex: 1, recentCount: 4, getSnapshot: snapshotsFrom(messages) });
    assert.equal(ctx.first, null);
    assert.deepEqual(ctx.recent, [{ name: 'Anna', text: 'hi' }]);
});

test('collectContext truncates first and recent messages to LIMITS', () => {
    const long = 'word '.repeat(2000);
    const messages = [{ name: 'Bob', text: long }, { name: 'Anna', text: long }];
    const ctx = collectContext({ chatLength: 2, replyIndex: 1, recentCount: 4, getSnapshot: snapshotsFrom(messages) });
    assert.ok(ctx.first.text.length <= LIMITS.firstMessageChars);
    assert.ok(ctx.first.text.length > LIMITS.firstMessageChars - 10);
    assert.ok(ctx.recent[0].text.length <= LIMITS.messageChars);
    assert.deepEqual(LIMITS, { firstMessageChars: 2500, messageChars: 1500, characterChars: 1200, characterCount: 4 });
});

test('truncateText cuts at a nearby word boundary, else hard, never adds an ellipsis', () => {
    assert.equal(truncateText('short', 10), 'short');
    assert.equal(truncateText('hello wonderful world', 18), 'hello wonderful');
    assert.equal(truncateText('abcdefghijklmnop', 5), 'abcde');
    assert.equal(truncateText('a bcdefghijklmnop', 10), 'a bcdefghi');
    assert.ok(!truncateText('one two three four five', 12).endsWith('…'));
});

test('cleanMessageText removes think, style, script, comments and tags', () => {
    const raw = '<think>secret</think><thinking a="1">x</thinking><reasoning>y</reasoning>'
        + '<style>.a{}</style><script>alert(1)</script><!-- note -->She <b>smiles</b>.<br>';
    assert.equal(cleanMessageText(raw), 'She smiles.');
});

test('cleanMessageText turns markdown images and links into their text', () => {
    assert.equal(cleanMessageText('Look ![a red door](http://x/y.png) and [the map](http://m)'), 'Look a red door and the map');
});

test('cleanMessageText decodes entities once and normalises whitespace', () => {
    assert.equal(cleanMessageText('Tom &amp; Jerry &lt;3 &quot;hi&quot; it&#39;s&nbsp;ok &amp;lt;'), 'Tom & Jerry <3 "hi" it\'s ok &lt;');
    assert.equal(cleanMessageText('  a \t  b\n\n\n  c  \n\n'), 'a b\nc');
    assert.equal(cleanMessageText(undefined), '');
});

const SCENE = {
    first: { name: 'Bob', text: 'Hello' },
    recent: [{ name: 'Anna', text: 'One' }, { name: 'Bob', text: 'Two' }, { name: 'Anna', text: 'Three' }],
};

test('buildSceneBlock default order: background, earlier, current (chat model weighs the end)', () => {
    const expected = `${BG}\nBob: Hello\n\n${EARLIER}\nAnna: One\n\nBob: Two\n\n${CURRENT}\nAnna: Three`;
    assert.equal(buildSceneBlock(SCENE), expected);
    assert.equal(buildSceneBlock(SCENE, { currentFirst: false }), expected);
});

test('buildSceneBlock currentFirst order: current, earlier, background (image model weighs the start)', () => {
    assert.equal(
        buildSceneBlock(SCENE, { currentFirst: true }),
        `${CURRENT}\nAnna: Three\n\n${EARLIER}\nAnna: One\n\nBob: Two\n\n${BG}\nBob: Hello`,
    );
});

test('buildSceneBlock: a single recent entry is the current moment and there is no earlier section', () => {
    const scene = { first: { name: 'Bob', text: 'Hello' }, recent: [{ name: 'A', text: 'x' }] };
    assert.equal(buildSceneBlock(scene), `${BG}\nBob: Hello\n\n${CURRENT}\nA: x`);
    assert.equal(buildSceneBlock(scene, { currentFirst: true }), `${CURRENT}\nA: x\n\n${BG}\nBob: Hello`);
    assert.ok(!buildSceneBlock(scene).includes(EARLIER));
});

test('buildSceneBlock omits empty sections (no background, no recent, nothing)', () => {
    assert.equal(buildSceneBlock({ first: { name: 'Bob', text: 'Hello' }, recent: [] }), `${BG}\nBob: Hello`);
    assert.equal(buildSceneBlock({ first: null, recent: [{ name: 'A', text: 'x' }] }), `${CURRENT}\nA: x`);
    const noBackground = { first: null, recent: [{ name: 'A', text: 'x' }, { name: 'B', text: 'y' }] };
    assert.equal(buildSceneBlock(noBackground), `${EARLIER}\nA: x\n\n${CURRENT}\nB: y`);
    assert.equal(buildSceneBlock(noBackground, { currentFirst: true }), `${CURRENT}\nB: y\n\n${EARLIER}\nA: x`);
    assert.ok(!buildSceneBlock(noBackground).includes(BG));
    assert.equal(buildSceneBlock({ first: null, recent: [] }), '');
    assert.equal(buildSceneBlock({ first: null, recent: [] }, { currentFirst: true }), '');
});

test('buildLlmRequest and buildDirectPrompt use the exact templates', () => {
    const req = buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE' });
    assert.equal(req.prompt, 'Task: Do it\n\nSCENE\n\nImage prompt:');
    assert.equal(req.systemPrompt, 'You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The character notes and the background information are a reference for what the characters and the world look like: take appearance details from them, never depict their events, and use their location only when the messages give no other place. Write one short description in plain English, at most 45 words. Start with how many people are in the picture, for example "One girl, solo:" or "One girl and one boy:". Then, in this order: who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light. Name a character from a published work (anime, game, book, film, series) with the full canonical name and the title of the work, for example "Hermione Granger from Harry Potter"; use no other names. Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen. No dialogue, no explanations. Output only the image prompt.');
    assert.ok(!req.systemPrompt.includes('\n'), 'system prompt is a single line');
    assert.equal(buildDirectPrompt({ instruction: 'Do it', sceneBlock: 'SCENE' }), 'Do it\n\nSCENE');
});

test('cleanLlmOutput strips labels, fences, quotes and think blocks', () => {
    assert.equal(cleanLlmOutput('Image prompt: a red fox'), 'a red fox');
    assert.equal(cleanLlmOutput('prompt:a red fox'), 'a red fox');
    assert.equal(cleanLlmOutput('Sure!\n```text\na red\n  fox in snow\n```\nEnjoy'), 'a red fox in snow');
    assert.equal(cleanLlmOutput('"**a red fox**"'), 'a red fox');
    assert.equal(cleanLlmOutput('`a red fox`'), 'a red fox');
    assert.equal(cleanLlmOutput('<think>plan the scene</think>\n\nPrompt: "a red fox,\n\nsnow"'), 'a red fox, snow');
    assert.equal(cleanLlmOutput('half thought</think> a red fox'), 'a red fox');
    assert.equal(cleanLlmOutput(null), '');
});

test('finalizePrompt puts the style first and keeps it intact while fitting maxChars', () => {
    const text = 'word '.repeat(100).trim();
    const result = finalizePrompt(text, { styleSuffix: '  anime style  ', maxChars: 100 });
    assert.ok(result.length <= 100);
    assert.ok(result.startsWith('anime style, word word'));
    assert.ok(result.endsWith('word'));
});

test('finalizePrompt without style only truncates', () => {
    assert.equal(finalizePrompt('  a cat  '), 'a cat');
    assert.equal(finalizePrompt('a cat', { styleSuffix: '   ' }), 'a cat');
    assert.equal(finalizePrompt('a cat', { styleSuffix: 'oil' }), 'oil, a cat');
    assert.equal(finalizePrompt('x'.repeat(3000)).length, 1800);
});
