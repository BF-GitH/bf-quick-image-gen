import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_INSTRUCTION, LIMITS, cleanMessageText, truncateText, collectContext, buildSceneBlock,
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

test('DEFAULT_INSTRUCTION is one line and starts as specified', () => {
    assert.ok(!DEFAULT_INSTRUCTION.includes('\n'));
    assert.ok(DEFAULT_INSTRUCTION.startsWith('Depict the current moment of this roleplay as one image:'));
    assert.ok(DEFAULT_INSTRUCTION.endsWith('the current action from the latest messages.'));
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
    assert.deepEqual(LIMITS, { firstMessageChars: 2500, messageChars: 1500 });
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

test('buildSceneBlock formats both sections', () => {
    const block = buildSceneBlock({
        first: { name: 'Bob', text: 'Hello' },
        recent: [{ name: 'Anna', text: 'One' }, { name: 'Bob', text: 'Two' }],
    });
    assert.equal(block, '[First message of the chat]\nBob: Hello\n\n[Latest messages, oldest first]\nAnna: One\n\nBob: Two');
});

test('buildSceneBlock omits empty sections', () => {
    assert.equal(buildSceneBlock({ first: { name: 'Bob', text: 'Hello' }, recent: [] }), '[First message of the chat]\nBob: Hello');
    assert.equal(buildSceneBlock({ first: null, recent: [{ name: 'A', text: 'x' }] }), '[Latest messages, oldest first]\nA: x');
    assert.equal(buildSceneBlock({ first: null, recent: [] }), '');
});

test('buildLlmRequest and buildDirectPrompt use the exact templates', () => {
    const req = buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE' });
    assert.equal(req.prompt, 'Task: Do it\n\nSCENE\n\nImage prompt:');
    assert.equal(req.systemPrompt, 'You write prompts for an AI image generator. Do not continue the story and do not answer in character. Output only the image prompt: English, one paragraph, at most 120 words, concrete visual details, no dialogue, no explanations.');
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

test('finalizePrompt keeps the style suffix intact while fitting maxChars', () => {
    const text = 'word '.repeat(100).trim();
    const result = finalizePrompt(text, { styleSuffix: '  anime style  ', maxChars: 100 });
    assert.ok(result.length <= 100);
    assert.ok(result.endsWith(' Style: anime style'));
    assert.ok(result.startsWith('word word'));
});

test('finalizePrompt without suffix only truncates', () => {
    assert.equal(finalizePrompt('  a cat  '), 'a cat');
    assert.equal(finalizePrompt('a cat', { styleSuffix: '   ' }), 'a cat');
    assert.equal(finalizePrompt('a cat', { styleSuffix: 'oil' }), 'a cat Style: oil');
    assert.equal(finalizePrompt('x'.repeat(3000)).length, 1800);
});
