// Pre-request phase (watchdog) and tool-call turns (empty first reply, follow-up generation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../../src/flow/run-state.js';
import { setup, pushReply } from './fake-host.js';

async function armedAndGenerating(ctx) {
    await ctx.controller.start();
    ctx.state.chat.push({ name: 'User', mes: 'Hallo', is_user: true });
    await ctx.bus.emit('MESSAGE_SENT', ctx.state.chat.length - 1);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.state.generating = true;
}

test('slow host pre-request work does not end the run before MESSAGE_SENT', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.timers.advance(10000);
    assert.equal(ctx.controller.isActive(), true);
    assert.equal(ctx.notes.length, 0);

    ctx.state.chat.push({ name: 'User', mes: 'Hallo', is_user: true });
    await ctx.bus.emit('MESSAGE_SENT', ctx.state.chat.length - 1);
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    const index = pushReply(ctx.state);
    await ctx.bus.emit('MESSAGE_RECEIVED', index, 'normal');
    assert.deepEqual(ctx.replies.map((r) => r.index), [index]);
    assert.equal(ctx.notes.length, 0);
});

test('pre-request timeout warns and finishes', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.timers.advance(29999);
    assert.equal(ctx.controller.isActive(), true);
    ctx.timers.advance(1);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.notStarted]]);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.timers.pendingCount(), 0);
});

test('pre-request timeout is configurable', async () => {
    const ctx = setup({ config: { preRequestTimeoutMs: 4000 } });
    await ctx.controller.start();
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.timers.advance(4000);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.notStarted]]);
});

test('idle rule applies once the host generating flag was seen', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.state.generating = true;
    ctx.timers.advance(2000);
    ctx.state.generating = false;
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), true);
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.notes.length, 0, 'a normal end is silent');
});

for (const empty of ['', '   ', '...', ' ... ']) {
    test(`empty tool-call reply ${JSON.stringify(empty)} does not take the image`, async () => {
        const ctx = setup();
        await armedAndGenerating(ctx);
        await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state, { mes: empty }), 'normal');
        assert.equal(ctx.replies.length, 0);
        assert.equal(ctx.controller.isActive(), true);

        await ctx.bus.emit('GENERATION_ENDED');
        ctx.timers.advance(500);
        await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
        const real = pushReply(ctx.state, { mes: 'The real answer.' });
        await ctx.bus.emit('MESSAGE_RECEIVED', real, 'normal');
        assert.deepEqual(ctx.replies.map((r) => r.index), [real]);
        assert.equal(ctx.controller.isActive(), false);
    });
}

test('a follow-up GENERATION_STARTED inside the grace time keeps the run alive', async () => {
    const ctx = setup();
    await armedAndGenerating(ctx);
    ctx.state.generating = false;
    await ctx.bus.emit('GENERATION_ENDED');
    ctx.timers.advance(1000);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.state.generating = true;
    ctx.timers.advance(5000);
    assert.equal(ctx.controller.isActive(), true);
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    assert.equal(ctx.replies.length, 1);
});

test('a follow-up GENERATION_STARTED resets the idle count', async () => {
    const ctx = setup();
    await armedAndGenerating(ctx);
    ctx.timers.advance(2000);
    ctx.state.generating = false;
    ctx.timers.advance(2000);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), true, 'one idle tick after the reset');
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), false);
});

test('an empty reply with nothing after it ends through the grace path', async () => {
    const ctx = setup();
    await armedAndGenerating(ctx);
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state, { mes: '' }), 'normal');
    ctx.state.generating = false;
    await ctx.bus.emit('GENERATION_ENDED');
    ctx.timers.advance(1499);
    assert.equal(ctx.controller.isActive(), true);
    ctx.timers.advance(1);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.replies.length, 0);
    assert.equal(ctx.notes.length, 0);
    assert.equal(ctx.timers.pendingCount(), 0);
});
