import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../../src/flow/run-state.js';
import { setup, pushReply, deferred, flush } from './fake-host.js';

async function armedAndGenerating(ctx) {
    await ctx.controller.start();
    ctx.state.chat.push({ name: 'User', mes: 'Hallo', is_user: true });
    await ctx.bus.emit('MESSAGE_SENT', ctx.state.chat.length - 1);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.state.generating = true;
}

// processReply that never settles, like a hung chat-model call that ignores the signal.
function hanging(capture) {
    return (_index, signal) => {
        capture.signal = signal;
        return new Promise(() => {});
    };
}

const RELEASES = [
    ['cancel()', (ctx) => ctx.controller.cancel()],
    ['CHAT_CHANGED', (ctx) => ctx.bus.emit('CHAT_CHANGED')],
    ['GENERATION_STOPPED', (ctx) => ctx.bus.emit('GENERATION_STOPPED')],
];

for (const [name, release] of RELEASES) {
    test(`${name} during imaging releases the hold although processReply never settles`, async () => {
        const capture = {};
        const ctx = setup({ processReply: hanging(capture) });
        await armedAndGenerating(ctx);
        const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
        await flush();
        assert.equal(ctx.timers.pendingCount(), 1, 'imaging timeout armed');
        ctx.log.length = 0;
        await release(ctx);
        await emitted;
        assert.equal(capture.signal.aborted, true);
        assert.equal(ctx.controller.isActive(), false);
        assert.deepEqual(ctx.log, [['release'], ['status', null, undefined]]);
        assert.equal(ctx.failures.length, 0);
        assert.equal(ctx.timers.pendingCount(), 0, 'imaging timeout cleared');
    });
}

test('imaging timeout reports the timeout, aborts the signal and finishes', async () => {
    const capture = {};
    const ctx = setup({ processReply: hanging(capture) });
    await armedAndGenerating(ctx);
    const index = pushReply(ctx.state);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', index, 'normal');
    await flush();
    ctx.timers.advance(659999);
    await flush();
    assert.equal(ctx.controller.isActive(), true);
    ctx.timers.advance(1);
    await emitted;
    assert.equal(ctx.failures.length, 1);
    assert.equal(ctx.failures[0].index, index);
    assert.equal(ctx.failures[0].error.message, MESSAGES.imageTimeout);
    assert.equal(capture.signal.aborted, true);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.timers.pendingCount(), 0);
});

test('imagingTimeoutMs comes from config', async () => {
    const ctx = setup({ processReply: hanging({}), config: { imagingTimeoutMs: 1000 } });
    await armedAndGenerating(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    ctx.timers.advance(1000);
    await emitted;
    assert.equal(ctx.failures[0].error.message, MESSAGES.imageTimeout);
});

test('processReply rejecting after a cancel stays silent', async () => {
    const gate = deferred();
    const ctx = setup({ processReply: () => gate.promise });
    await armedAndGenerating(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    ctx.controller.cancel();
    await emitted;
    gate.reject(new Error('late failure after cancel'));
    await flush();
    assert.equal(ctx.failures.length, 0);
    assert.equal(ctx.controller.isActive(), false);
});

test('processReply resolving normally clears the imaging timeout', async () => {
    const gate = deferred();
    const ctx = setup({ processReply: () => gate.promise });
    await armedAndGenerating(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    assert.equal(ctx.timers.pendingCount(), 1);
    gate.resolve();
    await emitted;
    assert.equal(ctx.timers.pendingCount(), 0);
    ctx.timers.advance(660000);
    assert.equal(ctx.failures.length, 0);
    assert.equal(ctx.controller.isActive(), false);
});

test('a new generation during imaging releases the hold only', async () => {
    const gate = deferred();
    const ctx = setup({ processReply: () => gate.promise });
    await armedAndGenerating(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    ctx.log.length = 0;
    await ctx.bus.emit('GENERATION_STARTED', 'quiet', {}, false);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, true);
    assert.deepEqual(ctx.log, [], 'quiet and dry run keep the hold');
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    assert.deepEqual(ctx.log, [['release']], 'status bar stays');
    assert.equal(ctx.controller.isActive(), true, 'image job keeps running');
    gate.resolve();
    await emitted;
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.failures.length, 0);
});
