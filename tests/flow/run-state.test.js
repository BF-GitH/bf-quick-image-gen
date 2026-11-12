import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../../src/flow/run-state.js';
import { setup, pushReply, deferred, flush } from './fake-host.js';

// The host pushes the user message, emits MESSAGE_SENT, then starts generating.
async function sendAndStart(ctx) {
    ctx.state.chat.push({ name: 'User', mes: ctx.state.composer, is_user: true });
    const userIndex = ctx.state.chat.length - 1;
    await ctx.bus.emit('MESSAGE_SENT', userIndex);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.state.generating = true;
    return userIndex;
}

function abortingReply(calls) {
    return (index, signal) => new Promise((_resolve, reject) => {
        calls.push({ index, signal });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
}

test('MESSAGES carry the exact German texts', () => {
    assert.deepEqual({ ...MESSAGES }, {
        busy: 'Es läuft bereits ein Bild-Auftrag.',
        noChat: 'Kein Chat geöffnet.',
        generating: 'Es läuft bereits eine Generierung.',
        emptyText: 'Bitte zuerst Text ins Nachrichtenfeld schreiben.',
        slash: 'Slash-Befehle bitte normal senden.',
        noSendButton: 'Senden-Knopf nicht gefunden.',
        notStarted: 'Senden wurde nicht gestartet.',
        statusReply: 'Antwort wird erstellt …',
        statusImage: 'Bild wird generiert …',
        imageTimeout: 'Zeitüberschreitung bei der Bilderstellung.',
    });
});

test('happy path non-streaming: hold, process reply, release', async () => {
    const ctx = setup();
    assert.equal(await ctx.controller.start(), true);
    assert.equal(ctx.state.clicks, 1);
    assert.deepEqual(ctx.log.slice(0, 2), [['engage', 2], ['status', MESSAGES.statusReply, undefined]]);
    assert.equal(ctx.controller.isActive(), true);

    const userIndex = await sendAndStart(ctx);
    assert.equal(userIndex, 2);
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    assert.equal(ctx.state.restores, 1);
    ctx.state.generating = false;
    const replyIndex = pushReply(ctx.state);
    await ctx.bus.emit('MESSAGE_RECEIVED', replyIndex, 'normal');

    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.replies[0].index, 3);
    assert.equal(ctx.replies[0].signal.aborted, false);
    const imageStatus = ctx.log.find((entry) => entry[1] === MESSAGES.statusImage);
    assert.equal(typeof imageStatus[2].onCancel, 'function');
    assert.deepEqual(ctx.log.slice(-2), [['release'], ['status', null, undefined]]);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.state.restores, 1);
    assert.equal(ctx.timers.pendingCount(), 0);
    assert.equal(ctx.failures.length, 0);
});

test('MESSAGE_RECEIVED listener returns the processReply chain', async () => {
    const gate = deferred();
    const ctx = setup({ processReply: () => gate.promise });
    await ctx.controller.start();
    await sendAndStart(ctx);
    let settled = false;
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal').then(() => { settled = true; });
    await flush();
    assert.equal(settled, false);
    assert.equal(ctx.controller.isActive(), true);
    gate.resolve();
    await emitted;
    assert.equal(settled, true);
    assert.equal(ctx.controller.isActive(), false);
});

test('streaming order: ENDED then RECEIVED inside the grace time', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    assert.equal(ctx.state.restores, 0, 'no restore while still armed');
    await sendAndStart(ctx);
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    assert.equal(ctx.state.restores, 1);
    ctx.state.generating = false;
    await ctx.bus.emit('GENERATION_ENDED');
    ctx.timers.advance(1000);
    assert.equal(ctx.controller.isActive(), true);
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.controller.isActive(), false);
    ctx.timers.advance(5000);
    assert.equal(ctx.state.restores, 1);
});

test('no reply: ENDED and the grace time expires', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await sendAndStart(ctx);
    await ctx.bus.emit('GENERATION_ENDED');
    ctx.timers.advance(1499);
    assert.equal(ctx.controller.isActive(), true);
    ctx.timers.advance(1);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.replies.length, 0);
    assert.deepEqual(ctx.log.slice(-2), [['release'], ['status', null, undefined]]);
    assert.equal(ctx.state.restores, 1);
});

test('GENERATION_ENDED while armed is ignored', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('GENERATION_ENDED');
    ctx.timers.advance(1500);
    assert.equal(ctx.controller.isActive(), true);
});

test('stop during the LLM phase finishes the run', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await sendAndStart(ctx);
    await ctx.bus.emit('GENERATION_STOPPED');
    assert.equal(ctx.controller.isActive(), false);
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    assert.equal(ctx.replies.length, 0);
    assert.equal(ctx.state.restores, 1);
});

test('stop during imaging aborts the signal silently and finishes after processReply', async () => {
    const calls = [];
    const ctx = setup({ processReply: abortingReply(calls) });
    await ctx.controller.start();
    await sendAndStart(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    await ctx.bus.emit('GENERATION_STOPPED');
    assert.equal(calls[0].signal.aborted, true);
    await emitted;
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.failures.length, 0);
    assert.equal(ctx.notes.length, 0);
});

test('cancel from the status bar during imaging behaves like stop', async () => {
    const calls = [];
    const ctx = setup({ processReply: abortingReply(calls) });
    await ctx.controller.start();
    await sendAndStart(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    const status = ctx.log.find((entry) => entry[1] === MESSAGES.statusImage);
    status[2].onCancel();
    await emitted;
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(ctx.failures.length, 0);
    assert.equal(ctx.controller.isActive(), false);
});

test('cancel before the reply finishes at once', async () => {
    const ctx = setup();
    await ctx.controller.start();
    ctx.controller.cancel();
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.state.restores, 1);
});

test('processReply failure calls onFailure and finishes', async () => {
    const boom = new Error('Anbieter kaputt');
    const ctx = setup({ processReply: async () => { throw boom; } });
    await ctx.controller.start();
    await sendAndStart(ctx);
    const index = pushReply(ctx.state);
    await ctx.bus.emit('MESSAGE_RECEIVED', index, 'normal');
    assert.deepEqual(ctx.failures, [{ index, error: boom }]);
    assert.equal(ctx.controller.isActive(), false);
});

test('a throwing onFailure still finishes the run', async () => {
    const ctx = setup({
        processReply: async () => { throw new Error('x'); },
        onFailure: () => { throw new Error('toast broke'); },
    });
    const originalError = console.error;
    console.error = () => {};
    try {
        await ctx.controller.start();
        await sendAndStart(ctx);
        await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    } finally {
        console.error = originalError;
    }
    assert.equal(ctx.controller.isActive(), false);
});

test('precheck failure shows the error and never clicks send', async () => {
    const ctx = setup({ precheck: async () => { throw new Error('Kein Key gefunden.'); } });
    assert.equal(await ctx.controller.start(), false);
    assert.deepEqual(ctx.notes, [['error', 'Kein Key gefunden.']]);
    assert.equal(ctx.state.clicks, 0);
    assert.equal(ctx.log.length, 0);
    assert.equal(ctx.controller.isActive(), false);
});

test('missing send button: error, finish, restore streaming once', async () => {
    const ctx = setup();
    ctx.state.clickResult = false;
    assert.equal(await ctx.controller.start(), false);
    assert.deepEqual(ctx.notes, [['error', MESSAGES.noSendButton]]);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.state.restores, 1);
    assert.equal(ctx.timers.pendingCount(), 0);
});
