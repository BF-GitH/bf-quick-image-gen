import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_INSTRUCTION, LEGACY_DEFAULT_INSTRUCTIONS, TRIGGER_LOOKBACK, cleanMessageText, truncateText, collectContext, buildSceneBlock,
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
    assert.equal(DEFAULT_INSTRUCTION, 'Depict the current moment of this roleplay as one image: what happens in the latest message. Show {{char}} and everyone else who is present in that moment.');
});

test('LEGACY_DEFAULT_INSTRUCTIONS holds the version 1.0, 1.1 and 1.2 defaults exactly', () => {
    assert.deepEqual([...LEGACY_DEFAULT_INSTRUCTIONS], [
        'Depict the current moment of this roleplay as one image: the characters present with their appearance (hair, eyes, build, clothing), their pose and expression, the location, lighting and mood. Take the characters\' looks and the setting from the first message and the current action from the latest messages.',
        'Depict the current moment of this roleplay as one image: what happens in the latest message. Show the characters who are present with their appearance (hair, eyes, build, clothing), their pose and expression, the place where they are now, the lighting and the mood.',
        'Depict the current moment of this roleplay as one image: what happens in the latest message. The picture shows {{char}}, seen through the eyes of {{user}}. {{user}} is not in the picture.',
    ]);
    assert.ok(Object.isFrozen(LEGACY_DEFAULT_INSTRUCTIONS));
});

// The user (Harry) writes at `userAt`, everyone else is a character; message 0 is the greeting.
function userChat(count, userAt) {
    return Array.from({ length: count }, (_, i) => (
        userAt.includes(i) ? { name: 'Harry', text: `msg ${i}`, isUser: true } : { name: i % 2 ? 'Anna' : 'Bob', text: `msg ${i}` }
    ));
}

function context(messages, replyIndex = messages.length - 1) {
    return collectContext({ chatLength: messages.length, replyIndex, getSnapshot: snapshotsFrom(messages) });
}

test('TRIGGER_LOOKBACK is 10', () => {
    assert.equal(TRIGGER_LOOKBACK, 10);
});

test('collectContext: a hidden user message is no trigger, the visible one before it is', () => {
    const messages = userChat(5, [1, 3]);
    messages[3].isSystem = true;
    const ctx = context(messages);
    assert.deepEqual(ctx.trigger, { name: 'Harry', text: 'msg 1' });
    assert.deepEqual(ctx.recent.map((entry) => entry.text), ['msg 1', 'msg 2', 'msg 4']);
});

test('collectContext: the user message plus the reply, message 0 as first, trigger returned', () => {
    const ctx = context(userChat(6, [4]));
    assert.deepEqual(ctx.first, { name: 'Bob', text: 'msg 0' });
    assert.deepEqual(ctx.recent, [{ name: 'Harry', text: 'msg 4' }, { name: 'Anna', text: 'msg 5' }]);
    assert.deepEqual(ctx.trigger, { name: 'Harry', text: 'msg 4' });
});

test('collectContext keeps message 0 far behind the trigger', () => {
    const ctx = context(userChat(50, [2, 48]));
    assert.equal(ctx.first.text, 'msg 0');
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 48', 'msg 49']);
});

test('collectContext keeps messages of other characters between trigger and reply, in chat order', () => {
    const messages = userChat(8, [3]);
    const ctx = context(messages);
    assert.deepEqual(ctx.recent.map((e) => `${e.name}: ${e.text}`), ['Harry: msg 3', 'Bob: msg 4', 'Anna: msg 5', 'Bob: msg 6', 'Anna: msg 7']);
    assert.deepEqual(ctx.trigger, { name: 'Harry', text: 'msg 3' });
});

test('collectContext without a user message in the look-back gives only the current message', () => {
    const ctx = context(userChat(20, []));
    assert.deepEqual(ctx.recent, [{ name: 'Anna', text: 'msg 19' }]);
    assert.equal(ctx.trigger, null);
    assert.equal(ctx.first.text, 'msg 0');
});

test('collectContext finds a trigger exactly TRIGGER_LOOKBACK messages back, not one further', () => {
    const at = context(userChat(30, [29 - TRIGGER_LOOKBACK]));
    assert.deepEqual(at.trigger, { name: 'Harry', text: `msg ${29 - TRIGGER_LOOKBACK}` });
    assert.equal(at.recent.length, TRIGGER_LOOKBACK + 1);
    assert.equal(at.recent[0].text, `msg ${29 - TRIGGER_LOOKBACK}`);
    assert.equal(at.recent.at(-1).text, 'msg 29');
    const beyond = context(userChat(30, [28 - TRIGGER_LOOKBACK]));
    assert.equal(beyond.trigger, null);
    assert.deepEqual(beyond.recent, [{ name: 'Anna', text: 'msg 29' }]);
});

test('collectContext: the current message is the user\'s own message (parallel mode)', () => {
    const ctx = context(userChat(6, [1, 5]));
    assert.deepEqual(ctx.recent, [{ name: 'Harry', text: 'msg 5' }]);
    assert.deepEqual(ctx.trigger, { name: 'Harry', text: 'msg 5' });
});

test('collectContext takes the nearest user message as the trigger', () => {
    const ctx = context(userChat(10, [3, 6]));
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 6', 'msg 7', 'msg 8', 'msg 9']);
    assert.equal(ctx.trigger.text, 'msg 6');
});

test('collectContext uses a hidden message 0 (snapshot flags it as system-ish but it stays first)', () => {
    const messages = chat(3);
    messages[0] = { name: 'Bob', text: 'hidden greeting', isSystem: true };
    const ctx = collectContext({ chatLength: 3, replyIndex: 2, getSnapshot: snapshotsFrom(messages) });
    assert.deepEqual(ctx.first, { name: 'Bob', text: 'hidden greeting' });
});

test('collectContext leaves out system, empty and missing messages between trigger and reply', () => {
    const messages = userChat(9, [2]);
    messages[3] = { name: 'Sys', text: 'note', isSystem: true };
    messages[4] = { name: 'Anna', text: '  <think>only thoughts</think>  ' };
    messages[5] = null;
    messages[6] = { name: 'Bob', text: '   ' };
    const ctx = context(messages);
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 2', 'msg 7', 'msg 8']);
});

test('collectContext starts at replyIndex, not at the chat end', () => {
    const ctx = context(userChat(10, [4, 8]), 5);
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 4', 'msg 5']);
    assert.equal(ctx.trigger.text, 'msg 4');
});

test('collectContext clamps replyIndex to the last message', () => {
    const ctx = context(userChat(4, [2]), 99);
    assert.deepEqual(ctx.recent.map((e) => e.text), ['msg 2', 'msg 3']);
});

test('collectContext never puts index 0 in recent, nor takes it as the trigger', () => {
    const messages = userChat(3, [0]);
    const ctx = context(messages);
    assert.deepEqual(ctx.first, { name: 'Harry', text: 'msg 0' });
    assert.deepEqual(ctx.recent, [{ name: 'Bob', text: 'msg 2' }]);
    assert.equal(ctx.trigger, null);
    const only = context(userChat(1, [0]), 0);
    assert.equal(only.first.text, 'msg 0');
    assert.deepEqual(only.recent, []);
    assert.equal(only.trigger, null);
});

test('collectContext with replyIndex 0 has an empty recent list', () => {
    const ctx = collectContext({ chatLength: 1, replyIndex: 0, getSnapshot: snapshotsFrom(chat(1)) });
    assert.equal(ctx.first.text, 'msg 0');
    assert.deepEqual(ctx.recent, []);
});

test('collectContext on an empty chat or empty first message gives first = null', () => {
    const empty = collectContext({ chatLength: 0, replyIndex: 0, getSnapshot: () => null });
    assert.deepEqual(empty, { first: null, recent: [], trigger: null });
    const messages = [{ name: 'Bob', text: '   ' }, { name: 'Anna', text: 'hi' }];
    const ctx = collectContext({ chatLength: 2, replyIndex: 1, getSnapshot: snapshotsFrom(messages) });
    assert.equal(ctx.first, null);
    assert.deepEqual(ctx.recent, [{ name: 'Anna', text: 'hi' }]);
});

test('collectContext cuts no text: message 0, the trigger and the reply stay whole at any length', () => {
    for (const words of [1000, 5000, 20000]) {
        const long = `${'word '.repeat(words)}end`;
        const messages = [
            { name: 'Bob', text: long },
            { name: 'Harry', text: long, isUser: true },
            { name: 'Anna', text: long },
        ];
        const ctx = context(messages);
        assert.equal(ctx.first.text, long, String(words));
        assert.deepEqual(ctx.recent.map((e) => e.text), [long, long], String(words));
        assert.equal(ctx.trigger.text, long, String(words));
    }
});

test('collectContext still cleans the texts', () => {
    const messages = [
        { name: 'Bob', text: '<b>Hello</b> <think>x</think>' },
        { name: 'Harry', text: 'Hi &amp; <i>bye</i>', isUser: true },
        { name: 'Anna', text: '<thinking>plan</thinking>She waves.' },
    ];
    const ctx = context(messages);
    assert.deepEqual(ctx.first, { name: 'Bob', text: 'Hello' });
    assert.deepEqual(ctx.recent, [{ name: 'Harry', text: 'Hi & bye' }, { name: 'Anna', text: 'She waves.' }]);
    assert.deepEqual(ctx.trigger, { name: 'Harry', text: 'Hi & bye' });
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
    assert.equal(req.systemPrompt, 'You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The background information is a reference for what the characters and the world look like: take appearance details from it, never depict its events, and use its location only when the messages give no other place. Answer in exactly two lines. Line 1: the word "Shown:" followed by the names of the people who are visible in this picture and nobody else, separated by commas, the most important first. The list of known names only fixes the spelling: when a visible person is on it, copy the name from the list, otherwise write the name the chat uses. Most people on that list are usually not in the picture. Line 2: one short description in plain English, at most 45 words. Start with how many people are in the picture, for example "One girl, solo:" or "One girl and one boy:". Then, in this order: who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light. Refer to each person by the name from line 1; for a character from a published work (anime, game, book, film, series) write the full canonical name and the title of the work instead at the first mention, for example "Hermione Granger from Harry Potter". Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen. No dialogue, no explanations. Output only these two lines.');
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

// Moved from characters.test.js, which went with collectCharacters and buildCharacterBlock.
test('buildLlmRequest has no character block: task, scene, "Image prompt:"', () => {
    const expected = 'Task: Do it\n\nSCENE\n\nImage prompt:';
    assert.equal(buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', characterBlock: 'CHARS' }).prompt, expected);
    assert.equal(buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE' }).prompt, expected);
});

test('finalizePrompt never cuts the style and respects maxChars', () => {
    const style = 'masterpiece, best quality, anime style';
    const result = finalizePrompt('tag, '.repeat(200), { styleSuffix: style, maxChars: 120 });
    assert.ok(result.length <= 120, `length ${result.length}`);
    assert.ok(result.startsWith(`${style}, tag,`));
    assert.equal(finalizePrompt('x'.repeat(3000), { styleSuffix: 'oil' }).length, 1800);
    assert.equal(finalizePrompt('   ', { styleSuffix: ' oil ' }), 'oil');
});
