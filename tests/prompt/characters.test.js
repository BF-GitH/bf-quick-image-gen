import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LIMITS, collectCharacters, buildCharacterBlock, buildLlmRequest, finalizePrompt,
} from '../../src/prompt/scene.js';

const HEADING = '[Characters, reference only: who they are and what they look like]';

test('collectCharacters cleans and trims, keeps an empty text', () => {
    const notes = [
        { name: '  Hermione Granger ', description: '<b>Bushy</b> brown hair &amp; brown eyes.<!-- x -->' },
        { name: 'Ron', description: undefined },
    ];
    assert.deepEqual(collectCharacters(notes), [
        { name: 'Hermione Granger', text: 'Bushy brown hair & brown eyes.' },
        { name: 'Ron', text: '' },
    ]);
});

test('collectCharacters truncates descriptions to LIMITS.characterChars', () => {
    const [entry] = collectCharacters([{ name: 'A', description: 'word '.repeat(1000) }]);
    assert.ok(entry.text.length <= LIMITS.characterChars);
    assert.ok(entry.text.length > LIMITS.characterChars - 10);
});

test('collectCharacters drops entries without a name', () => {
    const notes = [{ name: '   ', description: 'x' }, { description: 'y' }, null, 'str', { name: 'B', description: 'z' }];
    assert.deepEqual(collectCharacters(notes), [{ name: 'B', text: 'z' }]);
});

test('collectCharacters keeps at most LIMITS.characterCount entries, in order', () => {
    const notes = Array.from({ length: 7 }, (_, i) => ({ name: `C${i}`, description: `d${i}` }));
    const result = collectCharacters(notes);
    assert.equal(result.length, LIMITS.characterCount);
    assert.deepEqual(result.map((c) => c.name), ['C0', 'C1', 'C2', 'C3']);
});

test('collectCharacters on non-array input gives []', () => {
    for (const input of [undefined, null, 'x', 5, { name: 'A' }]) {
        assert.deepEqual(collectCharacters(input), [], String(input));
    }
});

test('buildCharacterBlock: heading, entries with and without text, user line, blank-line separated', () => {
    const block = buildCharacterBlock({
        characters: [{ name: 'Hermione Granger', text: 'Bushy brown hair.' }, { name: 'Ron', text: '' }],
        userName: '  Harry ',
    });
    assert.equal(block, `${HEADING}\nHermione Granger (character): Bushy brown hair.\n\nRon (character)\n\nHarry (user)`);
});

test('buildCharacterBlock leaves out an empty user name', () => {
    assert.equal(buildCharacterBlock({ characters: [{ name: 'A', text: 't' }], userName: '  ' }), `${HEADING}\nA (character): t`);
    assert.equal(buildCharacterBlock({ characters: [{ name: 'A', text: 't' }] }), `${HEADING}\nA (character): t`);
});

test('buildCharacterBlock without characters is empty, the user alone is no block', () => {
    assert.equal(buildCharacterBlock({ characters: [], userName: 'Harry' }), '');
    assert.equal(buildCharacterBlock({ characters: undefined, userName: 'Harry' }), '');
});

test('buildLlmRequest puts the character block between task and scene', () => {
    const req = buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', characterBlock: 'CHARS' });
    assert.equal(req.prompt, 'Task: Do it\n\nCHARS\n\nSCENE\n\nImage prompt:');
});

test('buildLlmRequest without a character block leaves block and separator out', () => {
    const expected = 'Task: Do it\n\nSCENE\n\nImage prompt:';
    assert.equal(buildLlmRequest({ instruction: 'Do it', sceneBlock: 'SCENE', characterBlock: '' }).prompt, expected);
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
