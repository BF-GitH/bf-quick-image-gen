import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    POV_SENTENCE, USER_SHOWN_SENTENCE, DEFAULT_INSTRUCTION, splitShownLine, buildLlmRequest, cleanLlmOutput,
} from '../../src/prompt/scene.js';
import { NAME_LIMIT } from '../../src/references/select.js';

test('POV_SENTENCE and USER_SHOWN_SENTENCE are exact and start with one space', () => {
    assert.equal(POV_SENTENCE, ' The picture is seen through the eyes of {{user}}: {{user}} is not in the picture.');
    assert.equal(USER_SHOWN_SENTENCE, ' {{user}} has a reference picture and is shown in the picture when {{user}} takes part in the moment.');
    assert.ok(!DEFAULT_INSTRUCTION.includes('eyes of'), 'the view sentence is appended by build.js, not part of the default');
});

test('buildLlmRequest asks for the Shown line in a single-line system prompt', () => {
    const { systemPrompt } = buildLlmRequest({ instruction: 'x', sceneBlock: 'y' });
    assert.ok(!systemPrompt.includes('\n'));
    assert.ok(systemPrompt.includes('Line 1: the word "Shown:"'));
    assert.ok(systemPrompt.endsWith('Output only these two lines.'));
});

test('splitShownLine: plain answer', () => {
    const answer = 'Shown: Kyouko, Yuki\nTwo girls: Kyouko and Yuki laugh in a classroom.';
    assert.deepEqual(splitShownLine(answer), { names: ['Kyouko', 'Yuki'], text: 'Two girls: Kyouko and Yuki laugh in a classroom.' });
});

test('splitShownLine: trailing spaces, quotes, markdown and a trailing period', () => {
    const answer = '**Shown:**   "Kyouko" ,  `Yuki`.  ,  *Tooru*  \nOne scene.';
    assert.deepEqual(splitShownLine(answer).names, ['Kyouko', 'Yuki', 'Tooru']);
    assert.equal(splitShownLine(answer).text, 'One scene.');
    assert.deepEqual(splitShownLine('> shown : Kyouko Hori from Horimiya.\ntext').names, ['Kyouko Hori from Horimiya']);
    assert.deepEqual(splitShownLine('Shown: A\r\nOne girl, solo.'), { names: ['A'], text: 'One girl, solo.' });
});

test('splitShownLine: behind a closed or an unclosed think block', () => {
    const closed = '<think>Shown: Wrong\nplanning</think>\nShown: Kyouko\nOne girl, solo: Kyouko reads.';
    assert.deepEqual(splitShownLine(closed), { names: ['Kyouko'], text: '\nOne girl, solo: Kyouko reads.' });
    assert.equal(cleanLlmOutput(splitShownLine(closed).text), 'One girl, solo: Kyouko reads.');
    const unclosed = 'Shown: Wrong, half thought</think>Shown: Yuki\nOne girl, solo.';
    assert.deepEqual(splitShownLine(unclosed).names, ['Yuki']);
});

test('splitShownLine: Shown none and its variants give no names', () => {
    for (const empty of ['none', 'None.', 'nobody', 'No one', '-', '']) {
        const result = splitShownLine(`Shown: ${empty}\nAn empty street at night.`);
        assert.deepEqual(result, { names: [], text: 'An empty street at night.' }, empty);
    }
    assert.deepEqual(splitShownLine('Shown: none, Kyouko\nx').names, ['Kyouko']);
});

test('splitShownLine: no Shown line keeps the text without think blocks', () => {
    assert.deepEqual(splitShownLine('<think>hm</think>One girl, solo: Kyouko.'), { names: [], text: 'One girl, solo: Kyouko.' });
    assert.deepEqual(splitShownLine('Showing: Kyouko'), { names: [], text: 'Showing: Kyouko' });
    assert.deepEqual(splitShownLine(null), { names: [], text: '' });
});

test('splitShownLine caps the names at NAME_LIMIT', () => {
    const names = Array.from({ length: NAME_LIMIT + 3 }, (_, i) => `N${i}`);
    assert.equal(splitShownLine(`Shown: ${names.join(', ')}\nx`).names.length, NAME_LIMIT);
});

test('buildLlmRequest with known names puts them first, then the scene', () => {
    const req = buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', knownNames: ['Kyouko', 'Yuki'] });
    assert.equal(req.prompt, 'Task: Do it\n\n[Known names, for spelling only]\nKyouko, Yuki\n\nSCENE\n\nImage prompt:');
    const one = buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', knownNames: ['Kyouko'] });
    assert.equal(one.prompt, 'Task: Do it\n\n[Known names, for spelling only]\nKyouko\n\nSCENE\n\nImage prompt:');
});

test('buildLlmRequest without names leaves the names block and its separator out', () => {
    const expected = 'Task: Do it\n\nSCENE\n\nImage prompt:';
    assert.equal(buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', knownNames: [] }).prompt, expected);
    assert.equal(buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE' }).prompt, expected);
    assert.equal(buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', knownNames: null }).prompt, expected);
});
