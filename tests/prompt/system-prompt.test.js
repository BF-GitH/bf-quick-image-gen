import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmRequest, buildSystemPrompt, DEFAULT_DESCRIPTION, DESCRIPTION_WORDS } from '../../src/prompt/scene.js';

// Section 12.3 verbatim: the defaults must keep reproducing the prompt that was tuned against real chat models.
const TUNED_PROMPT = 'You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The character notes and the background information are a reference for what the characters and the world look like: take appearance details from them, never depict their events, and use their location only when the messages give no other place. Answer in exactly two lines. Line 1: the word "Shown:" followed by the names of the people who are visible in this picture and nobody else, separated by commas, the most important first. The list of known names only fixes the spelling: when a visible person is on it, copy the name from the list, otherwise write the name the chat uses. Most people on that list are usually not in the picture. Line 2: one short description in plain English, at most 45 words. Start with how many people are in the picture, for example "One girl, solo:" or "One girl and one boy:". Then, in this order: who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light. Refer to each person by the name from line 1; for a character from a published work (anime, game, book, film, series) write the full canonical name and the title of the work instead at the first mention, for example "Hermione Granger from Harry Potter". Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen. No dialogue, no explanations. Output only these two lines.';

const SHORT_LINE = (n) => `Line 2: one short description in plain English, at most ${n} words.`;
const LONG_LINE = (n) => `Line 2: one description in plain English, at most ${n} words.`;
const SHORT_WEIGHT = 'Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen.';
const LONG_WEIGHT = ' Harry Potter". The most important things come first and nothing is mentioned that cannot be seen. No dialogue';

test('DEFAULT_DESCRIPTION and DESCRIPTION_WORDS have the spec values', () => {
    assert.equal(DEFAULT_DESCRIPTION, 'who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light');
    assert.deepEqual({ ...DESCRIPTION_WORDS }, { min: 20, max: 200, fallback: 45 });
});

test('buildSystemPrompt with defaults gives the tuned 12.3 text exactly', () => {
    assert.equal(buildSystemPrompt(), TUNED_PROMPT);
    assert.equal(buildSystemPrompt({}), TUNED_PROMPT);
    assert.equal(buildSystemPrompt({ description: DEFAULT_DESCRIPTION, maxWords: 45 }), TUNED_PROMPT);
    assert.equal(buildLlmRequest({ instruction: 'x', sceneBlock: 'y' }).systemPrompt, TUNED_PROMPT);
});

test('a custom description and word count land in their places, the frame stays', () => {
    const prompt = buildSystemPrompt({ description: 'their emotions, their body language, the movement', maxWords: 40 });
    assert.ok(prompt.includes(`${SHORT_LINE(40)} Start with how many people are in the picture,`));
    assert.ok(prompt.includes('"One girl and one boy:". Then, in this order: their emotions, their body language, the movement. Refer to each person'));
    assert.ok(!prompt.includes(DEFAULT_DESCRIPTION));
    assert.ok(prompt.includes('Line 1: the word "Shown:"'));
    assert.ok(prompt.includes(SHORT_WEIGHT));
    assert.ok(prompt.endsWith('Output only these two lines.'));
    assert.equal(prompt, TUNED_PROMPT.replace(SHORT_LINE(45), SHORT_LINE(40)).replace(DEFAULT_DESCRIPTION, 'their emotions, their body language, the movement'));
});

test('buildLlmRequest passes description and maxWords to the system prompt', () => {
    const req = buildLlmRequest({ instruction: 'x', sceneBlock: 'y', description: 'the mood', maxWords: 90 });
    assert.equal(req.systemPrompt, buildSystemPrompt({ description: 'the mood', maxWords: 90 }));
    assert.ok(req.systemPrompt.includes('Then, in this order: the mood. Refer'));
    assert.equal(req.prompt, buildLlmRequest({ instruction: 'x', sceneBlock: 'y' }).prompt);
});

test('description cleaning: trailing periods, line breaks, whitespace runs', () => {
    const expected = 'Then, in this order: the face, the hands. Refer';
    for (const description of ['the face, the hands.', 'the face, the hands...', '  the face,\n  the hands. \n', 'the face,\r\n\tthe hands . ']) {
        const prompt = buildSystemPrompt({ description });
        assert.ok(prompt.includes(expected), JSON.stringify(description));
        assert.ok(!prompt.includes('\n'));
    }
});

test('an empty or non-string description falls back to the default', () => {
    for (const description of ['', '   ', '\n\t', '...', ' . ', undefined, null, 5, {}, ['a']]) {
        assert.equal(buildSystemPrompt({ description }), TUNED_PROMPT, JSON.stringify(description));
    }
});

test('maxWords is rounded and clamped to 20..200, garbage gives 45', () => {
    const cases = [[19, 20], [0, 20], [-100, 20], [20.4, 20], [44.6, 45], [50, 50], [201, 200], [1e9, 200],
        [NaN, 45], [Infinity, 45], [-Infinity, 45], ['90', 45], [null, 45], [undefined, 45], [{}, 45]];
    for (const [maxWords, words] of cases) {
        const prompt = buildSystemPrompt({ maxWords });
        const line = words > 50 ? LONG_LINE(words) : SHORT_LINE(words);
        assert.ok(prompt.includes(line), `${String(maxWords)} -> ${words}`);
    }
});

test('up to 50 words keeps the short sentences, above 50 both sentences change', () => {
    const at50 = buildSystemPrompt({ maxWords: 50 });
    assert.ok(at50.includes(SHORT_LINE(50)));
    assert.ok(at50.includes(SHORT_WEIGHT));
    for (const maxWords of [51, 90, 200]) {
        const prompt = buildSystemPrompt({ maxWords });
        assert.ok(prompt.includes(LONG_LINE(maxWords)), String(maxWords));
        assert.ok(prompt.includes(LONG_WEIGHT), String(maxWords));
        assert.ok(!prompt.includes('short description'));
        assert.ok(!prompt.includes('Many image generators'));
        assert.equal(prompt, TUNED_PROMPT.replace(SHORT_LINE(45), LONG_LINE(maxWords)).replace(`${SHORT_WEIGHT}`, LONG_WEIGHT.slice(' Harry Potter". '.length, -' No dialogue'.length)));
    }
});

test('the system prompt is always one line', () => {
    const inputs = [{}, { description: 'a\nb\nc', maxWords: 120 }, { description: '\n\n', maxWords: 'x' }, { description: 'x\r\ny.', maxWords: 30 }];
    for (const input of inputs) assert.ok(!/[\r\n]/.test(buildSystemPrompt(input)), JSON.stringify(input));
});
