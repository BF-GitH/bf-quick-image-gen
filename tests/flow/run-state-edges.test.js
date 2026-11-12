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

const EARLY_EXITS = [
    ['noChat', (state) => { state.chatOpen = false; }],
    ['generating', (state) => { state.generating = true; }],
    ['emptyText', (state) => { state.composer = '   \n '; }],
    ['slash', (state) => { state.composer = '  /sd you'; }],
];

for (const [key, arrange] of EARLY_EXITS) {
    test(`early exit ${key} warns and does nothing`, async () => {
        const ctx = setup();
        arrange(ctx.state);
        assert.equal(await ctx.controller.start(), false);
        assert.deepEqual(ctx.notes, [['warning', MESSAGES[key]]]);
        assert.equal(ctx.state.clicks, 0);
        assert.equal(ctx.log.length, 0);
        assert.equal(ctx.state.restores, 0);
    });
}

test('second start while active warns busy', async () => {
    const ctx = setup();
    assert.equal(await ctx.controller.start(), true);
    assert.equal(await ctx.controller.start(), false);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.busy]]);
    assert.equal(ctx.state.clicks, 1);
});

test('two starts racing through precheck: only one run', async () => {
    const gate = deferred();
    const ctx = setup({ precheck: () => gate.promise });
    const first = ctx.controller.start();
    const second = ctx.controller.start();
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), [true, false]);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.busy]]);
    assert.equal(ctx.state.clicks, 1);
});

test('host starts generating during precheck: generating warning', async () => {
    const ctx = setup({ precheck: async () => { ctx.state.generating = true; } });
    assert.equal(await ctx.controller.start(), false);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.generating]]);
    assert.equal(ctx.state.clicks, 0);
});

test('start-timeout fires while armed', async () => {
    const ctx = setup();
    await ctx.controller.start();
    ctx.timers.advance(7999);
    assert.equal(ctx.controller.isActive(), true);
    ctx.timers.advance(1);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.notStarted]]);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.state.restores, 1);
    assert.equal(ctx.timers.pendingCount(), 0);
});

test('dry-run and quiet GENERATION_STARTED are ignored', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('GENERATION_STARTED', 'quiet', {}, false);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, true);
    ctx.timers.advance(8000);
    assert.deepEqual(ctx.notes, [['warning', MESSAGES.notStarted]]);
    assert.equal(ctx.controller.isActive(), false);
});

test('real GENERATION_STARTED clears the start-timeout', async () => {
    const ctx = setup();
    await armedAndGenerating(ctx);
    ctx.timers.advance(8000);
    assert.equal(ctx.notes.length, 0);
    assert.equal(ctx.controller.isActive(), true);
});

test('MESSAGE_SENT moves the hold to the real user index', async () => {
    const ctx = setup();
    await ctx.controller.start();
    await ctx.bus.emit('MESSAGE_SENT', 5);
    await ctx.bus.emit('MESSAGE_SENT', 'x');
    assert.deepEqual(ctx.log.filter((e) => e[0] === 'engage'), [['engage', 2], ['engage', 5]]);
    await ctx.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    ctx.state.chat.push({}, {}, {}, {});
    ctx.state.chat[5] = { name: 'Bob', mes: 'reply at 5' };
    await ctx.bus.emit('MESSAGE_RECEIVED', 5, 'normal');
    assert.equal(ctx.replies.length, 0, 'index <= userIndex is ignored');
});

test('ignored MESSAGE_RECEIVED variants', async () => {
    const ctx = setup();
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    assert.equal(ctx.replies.length, 0, 'no run');

    await armedAndGenerating(ctx);
    const userIndex = ctx.state.chat.length - 1;
    await ctx.bus.emit('MESSAGE_RECEIVED', userIndex, 'normal');
    await ctx.bus.emit('MESSAGE_RECEIVED', userIndex - 1, 'normal');
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'first_message');
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state, { is_user: true }), 'normal');
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state, { is_system: true }), 'normal');
    await ctx.bus.emit('MESSAGE_RECEIVED', 99, 'normal');
    assert.equal(ctx.replies.length, 0);
    assert.equal(ctx.controller.isActive(), true);
});

test('a second MESSAGE_RECEIVED during imaging is ignored', async () => {
    const gate = deferred();
    const calls = [];
    const ctx = setup({ processReply: (index) => { calls.push(index); return gate.promise; } });
    await armedAndGenerating(ctx);
    const index = pushReply(ctx.state);
    const first = ctx.bus.emit('MESSAGE_RECEIVED', index, 'normal');
    await ctx.bus.emit('MESSAGE_RECEIVED', index, 'normal');
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    gate.resolve();
    await first;
    assert.deepEqual(calls, [index]);
});

test('chat change during imaging aborts and finishes at once; old finish spares a newer run', async () => {
    const gate = deferred();
    let signal = null;
    const ctx = setup({ processReply: (_index, s) => { signal = s; return gate.promise; } });
    await armedAndGenerating(ctx);
    const emitted = ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    await flush();
    await ctx.bus.emit('CHAT_CHANGED');
    assert.equal(signal.aborted, true);
    assert.equal(ctx.controller.isActive(), false);

    ctx.state.generating = false;
    assert.equal(await ctx.controller.start(), true);
    gate.reject(new Error('late failure after abort'));
    await emitted;
    assert.equal(ctx.controller.isActive(), true, 'newer run survives');
    assert.equal(ctx.failures.length, 0, 'aborted run reports nothing');
});

test('watchdog finishes after two idle ticks while generating', async () => {
    const ctx = setup();
    await armedAndGenerating(ctx);
    ctx.timers.advance(2000);
    ctx.state.generating = false;
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), true);
    ctx.state.generating = true;
    ctx.timers.advance(2000);
    ctx.state.generating = false;
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), true, 'busy tick resets the count');
    ctx.timers.advance(2000);
    assert.equal(ctx.controller.isActive(), false);
    assert.equal(ctx.timers.pendingCount(), 0);
});

test('watchdog does not count while armed', async () => {
    const ctx = setup({ config: { startTimeoutMs: 60000 } });
    await ctx.controller.start();
    ctx.timers.advance(10000);
    assert.equal(ctx.controller.isActive(), true);
});

test('streaming is restored exactly once across settings-ready, stop and finish', async () => {
    const ctx = setup();
    await armedAndGenerating(ctx);
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    await ctx.bus.emit('GENERATION_STOPPED');
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    assert.equal(ctx.state.restores, 1);
});

test('no streaming to disable: runs normally without a restore', async () => {
    const ctx = setup({ streaming: false });
    await armedAndGenerating(ctx);
    await ctx.bus.emit('CHAT_COMPLETION_SETTINGS_READY');
    await ctx.bus.emit('MESSAGE_RECEIVED', pushReply(ctx.state), 'normal');
    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.state.restores, 0);
});

test('dispose removes every listener and ends an active run', async () => {
    const ctx = setup();
    assert.equal(ctx.bus.count('MESSAGE_RECEIVED'), 1);
    await ctx.controller.start();
    ctx.controller.dispose();
    assert.equal(ctx.controller.isActive(), false);
    for (const key of ['GENERATION_STARTED', 'CHAT_COMPLETION_SETTINGS_READY', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
        'GENERATION_STOPPED', 'GENERATION_ENDED', 'CHAT_CHANGED']) {
        assert.equal(ctx.bus.count(key), 0, key);
    }
});
