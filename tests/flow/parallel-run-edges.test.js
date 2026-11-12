import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../../src/flow/messages.js';
import { flush, setupParallel, pushUser, pushReply } from './fake-host.js';

async function begin(h) {
    assert.equal(await h.controller.start(), true);
    const userIndex = pushUser(h.state);
    await h.bus.emit('MESSAGE_SENT', userIndex);
    return userIndex;
}

function receive(h, index, type = 'normal') {
    const [listener] = h.bus.handlersOf('MESSAGE_RECEIVED');
    return listener(index, type);
}

test('every early exit warns without clicking', async () => {
    const cases = [
        [(s) => { s.chatOpen = false; }, MESSAGES.noChat],
        [(s) => { s.generating = true; }, MESSAGES.generating],
        [(s) => { s.composer = '   '; }, MESSAGES.emptyText],
        [(s) => { s.composer = '/echo hi'; }, MESSAGES.slash],
    ];
    for (const [arrange, message] of cases) {
        const h = setupParallel();
        arrange(h.state);
        assert.equal(await h.controller.start(), false);
        assert.deepEqual(h.notes, [['warning', message]]);
        assert.equal(h.state.clicks, 0);
        assert.equal(h.controller.isActive(), false);
    }
});

test('second start() while active warns busy', async () => {
    const h = setupParallel();
    assert.equal(await h.controller.start(), true);
    assert.equal(await h.controller.start(), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.busy]]);
    assert.equal(h.state.clicks, 1);
});

test('precheck failure shows the error and does not click', async () => {
    const h = setupParallel({ precheck: async () => { throw new Error('Kein Modell gewählt.'); } });
    assert.equal(await h.controller.start(), false);
    assert.deepEqual(h.notes, [['error', 'Kein Modell gewählt.']]);
    assert.equal(h.state.clicks, 0);
    assert.deepEqual(h.statuses, []);
});

test('generation begun during precheck is refused afterwards', async () => {
    const h = setupParallel({ precheck: async () => { h.state.generating = true; } });
    assert.equal(await h.controller.start(), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.generating]]);
    assert.equal(h.state.clicks, 0);
});

test('missing send button reports an error and ends the run', async () => {
    const h = setupParallel();
    h.state.clickResult = false;
    assert.equal(await h.controller.start(), false);
    assert.deepEqual(h.notes, [['error', MESSAGES.noSendButton]]);
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.timers.pendingCount(), 0);
});

test('start-timeout without MESSAGE_SENT warns and ends', async () => {
    const h = setupParallel();
    await h.controller.start();
    h.timers.advance(8000);
    assert.deepEqual(h.notes, [['warning', MESSAGES.notStarted]]);
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.jobs.length, 0);
});

test('ignored MESSAGE_RECEIVED variants, then the real reply is used', async () => {
    const h = setupParallel();
    const userIndex = await begin(h);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.equal(receive(h, 0, 'first_message'), undefined);
    assert.equal(receive(h, userIndex), undefined);
    assert.equal(receive(h, 99), undefined);
    const system = pushReply(h.state, { is_system: true });
    assert.equal(receive(h, system), undefined);
    const toolTurn = pushReply(h.state, { mes: ' ... ' });
    assert.equal(receive(h, toolTurn), undefined);
    const empty = pushReply(h.state, { mes: '' });
    assert.equal(receive(h, empty), undefined);
    assert.equal(h.attaches.length, 0);
    assert.equal(h.controller.isActive(), true);
    const real = pushReply(h.state);
    await receive(h, real);
    assert.equal(h.attaches.length, 1);
    assert.equal(h.attaches[0].index, real);
});

test('follow-up GENERATION_STARTED inside the grace time keeps the run', async () => {
    const h = setupParallel();
    await begin(h);
    await h.bus.emit('GENERATION_ENDED');
    h.timers.advance(1000);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    h.timers.advance(1000);
    assert.equal(h.controller.isActive(), true);
    // Dry runs and quiet generations do not count as follow-ups.
    await h.bus.emit('GENERATION_ENDED');
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, true);
    await h.bus.emit('GENERATION_STARTED', 'quiet', {}, false);
    h.state.generating = true;
    h.timers.advance(1500);
    assert.equal(h.controller.isActive(), false);
});

test('imaging timeout before the reply: failure reported at reply time, late image discarded', async () => {
    const h = setupParallel();
    await begin(h);
    h.state.generating = true;
    h.timers.advance(240000);
    assert.equal(h.jobs[0].signal.aborted, true);
    assert.equal(h.controller.isActive(), true);
    assert.deepEqual(h.failures, []);
    const replyIndex = pushReply(h.state);
    assert.equal(receive(h, replyIndex), undefined);
    assert.equal(h.failures.length, 1);
    assert.equal(h.failures[0].index, replyIndex);
    assert.equal(h.failures[0].error.message, MESSAGES.imageTimeout);
    assert.equal(h.controller.isActive(), false);
    h.jobs[0].resolve({ url: 'late' });
    await flush();
    assert.deepEqual(h.discards, [{ url: 'late' }]);
    assert.equal(h.attaches.length, 0);
});

test('imaging timeout after the reply reports the failure and ends', async () => {
    const h = setupParallel();
    await begin(h);
    const replyIndex = pushReply(h.state);
    receive(h, replyIndex);
    h.timers.advance(240000);
    assert.equal(h.jobs[0].signal.aborted, true);
    assert.equal(h.failures.length, 1);
    assert.equal(h.failures[0].index, replyIndex);
    assert.equal(h.failures[0].error.message, MESSAGES.imageTimeout);
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.timers.pendingCount(), 0);
});

test('watchdog cancels after two idle ticks without a reply', async () => {
    const h = setupParallel();
    await begin(h);
    h.state.generating = true;
    h.timers.advance(6000);
    assert.equal(h.controller.isActive(), true);
    h.state.generating = false;
    h.timers.advance(2000);
    assert.equal(h.controller.isActive(), true);
    h.timers.advance(2000);
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.jobs[0].signal.aborted, true);
    assert.deepEqual(h.failures, []);
});

test('once the reply is known the watchdog no longer ends the run', async () => {
    const h = setupParallel();
    await begin(h);
    receive(h, pushReply(h.state));
    h.timers.advance(20000);
    assert.equal(h.controller.isActive(), true);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.equal(h.attaches.length, 1);
});

test('attachImage is called at most once per run', async () => {
    const h = setupParallel();
    await begin(h);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    const first = pushReply(h.state);
    const pending = receive(h, first);
    // A second reply arriving while the attach is in flight must not attach again.
    assert.equal(receive(h, pushReply(h.state)), undefined);
    await pending;
    assert.equal(receive(h, pushReply(h.state)), undefined);
    assert.equal(h.attaches.length, 1);
    assert.deepEqual(h.discards, []);
});

test('a late prepareImage of an older run does not touch the newer run', async () => {
    const h = setupParallel();
    await begin(h);
    h.controller.cancel();
    await begin(h);
    h.jobs[0].resolve({ url: 'old' });
    await flush();
    assert.deepEqual(h.discards, [{ url: 'old' }]);
    assert.equal(h.controller.isActive(), true);
    const replyIndex = pushReply(h.state);
    h.jobs[1].resolve({ url: 'new' });
    await flush();
    await receive(h, replyIndex);
    assert.deepEqual(h.attaches.map((a) => a.prepared), [{ url: 'new' }]);
    assert.deepEqual(h.failures, []);
});

test('dispose unsubscribes every listener and ends the run', async () => {
    const h = setupParallel();
    await begin(h);
    h.controller.dispose();
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.jobs[0].signal.aborted, true);
    for (const key of ['GENERATION_STARTED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'GENERATION_STOPPED', 'GENERATION_ENDED', 'CHAT_CHANGED']) {
        assert.equal(h.bus.count(key), 0, key);
    }
});
