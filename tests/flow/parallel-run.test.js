import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../../src/flow/messages.js';
import { deferred, flush, setupParallel, pushUser, pushReply } from './fake-host.js';

// Starts a run and delivers the user's message; returns the user index.
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

function assertEnded(h) {
    assert.equal(h.controller.isActive(), false);
    assert.deepEqual(h.statuses.at(-1), [null, undefined]);
    assert.equal(h.timers.pendingCount(), 0);
}

test('reply first then image: listener returns undefined, later attach with save true', async () => {
    const h = setupParallel();
    const userIndex = await begin(h);
    assert.equal(h.jobs.length, 1);
    assert.equal(h.jobs[0].lastIndex, userIndex);
    const replyIndex = pushReply(h.state);
    assert.equal(receive(h, replyIndex), undefined);
    assert.equal(h.attaches.length, 0);
    assert.equal(h.controller.isActive(), true);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.deepEqual(h.attaches, [{ index: replyIndex, prepared: { url: 'img' }, token: { token: replyIndex }, save: true }]);
    assertEnded(h);
    assert.deepEqual(h.discards, []);
    assert.deepEqual(h.failures, []);
});

test('image first then reply: attach with save false, listener promise settles after the attach', async () => {
    const attachDone = deferred();
    const calls = [];
    const h = setupParallel({
        attachImage: (index, prepared, options) => { calls.push({ index, prepared, ...options }); return attachDone.promise; },
    });
    await begin(h);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.equal(calls.length, 0);
    const replyIndex = pushReply(h.state);
    const returned = receive(h, replyIndex);
    assert.ok(returned instanceof Promise);
    // The attach runs synchronously inside the listener so text and image render together.
    assert.deepEqual(calls, [{ index: replyIndex, prepared: { url: 'img' }, token: { token: replyIndex }, save: false }]);
    let settled = false;
    returned.then(() => { settled = true; });
    await flush();
    assert.equal(settled, false);
    assert.equal(h.controller.isActive(), true);
    attachDone.resolve();
    await returned;
    assert.equal(settled, true);
    assertEnded(h);
    assert.deepEqual(h.discards, []);
});

test('status bar is set at start with the cancel label and cleared at the end', async () => {
    const h = setupParallel();
    await begin(h);
    const [text, options] = h.statuses[0];
    assert.equal(text, MESSAGES.statusImage);
    assert.equal(options.cancelLabel, 'Abbrechen');
    options.onCancel();
    assertEnded(h);
    assert.equal(h.jobs[0].signal.aborted, true);
});

test('image fails before the reply: onFailure at reply time with the reply index', async () => {
    const h = setupParallel();
    await begin(h);
    const boom = new Error('boom');
    h.jobs[0].reject(boom);
    await flush();
    assert.deepEqual(h.failures, []);
    assert.equal(h.controller.isActive(), true);
    const replyIndex = pushReply(h.state);
    assert.equal(receive(h, replyIndex), undefined);
    assert.deepEqual(h.failures, [{ index: replyIndex, error: boom }]);
    assertEnded(h);
});

test('image fails after the reply: onFailure with the reply index', async () => {
    const h = setupParallel();
    await begin(h);
    const replyIndex = pushReply(h.state);
    receive(h, replyIndex);
    const boom = new Error('boom');
    h.jobs[0].reject(boom);
    await flush();
    assert.deepEqual(h.failures, [{ index: replyIndex, error: boom }]);
    assertEnded(h);
    assert.equal(h.attaches.length, 0);
});

test('stop before the reply aborts; a later resolving prepareImage is discarded exactly once', async () => {
    const h = setupParallel();
    await begin(h);
    await h.bus.emit('GENERATION_STOPPED');
    assert.equal(h.jobs[0].signal.aborted, true);
    assertEnded(h);
    h.jobs[0].resolve({ url: 'late' });
    await flush();
    assert.deepEqual(h.discards, [{ url: 'late' }]);
    assert.deepEqual(h.failures, []);
    assert.equal(h.attaches.length, 0);
});

test('stop before the reply: a rejecting prepareImage stays silent', async () => {
    const h = setupParallel();
    await begin(h);
    await h.bus.emit('GENERATION_STOPPED');
    h.jobs[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await flush();
    assert.deepEqual(h.failures, []);
    assert.deepEqual(h.discards, []);
});

test('stop after the reply while the image is pending is ignored; the image is attached later', async () => {
    const h = setupParallel();
    await begin(h);
    const replyIndex = pushReply(h.state);
    receive(h, replyIndex);
    await h.bus.emit('GENERATION_STOPPED');
    assert.equal(h.jobs[0].signal.aborted, false);
    assert.equal(h.controller.isActive(), true);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.deepEqual(h.attaches, [{ index: replyIndex, prepared: { url: 'img' }, token: { token: replyIndex }, save: true }]);
    assertEnded(h);
    assert.deepEqual(h.discards, []);
    assert.deepEqual(h.failures, []);
});

test('GENERATION_ENDED without a reply: grace expires, cancel, the ready image is discarded', async () => {
    const h = setupParallel();
    await begin(h);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    await h.bus.emit('GENERATION_ENDED');
    h.timers.advance(1499);
    assert.equal(h.controller.isActive(), true);
    h.timers.advance(1);
    assertEnded(h);
    assert.equal(h.jobs[0].signal.aborted, true);
    assert.deepEqual(h.discards, [{ url: 'img' }]);
    assert.deepEqual(h.failures, []);
    assert.deepEqual(h.notes, []);
});

test('cancel() during the image job leaves the reply alone and ignores it later', async () => {
    const h = setupParallel();
    await begin(h);
    h.controller.cancel();
    assert.equal(h.jobs[0].signal.aborted, true);
    assertEnded(h);
    const replyIndex = pushReply(h.state);
    assert.equal(receive(h, replyIndex), undefined);
    h.jobs[0].resolve({ url: 'late' });
    await flush();
    assert.equal(h.attaches.length, 0);
    assert.deepEqual(h.discards, [{ url: 'late' }]);
});

test('cancel() after the reply while the image is pending discards the late image', async () => {
    const h = setupParallel();
    await begin(h);
    receive(h, pushReply(h.state));
    h.controller.cancel();
    assertEnded(h);
    h.jobs[0].resolve({ url: 'late' });
    await flush();
    assert.equal(h.attaches.length, 0);
    assert.deepEqual(h.discards, [{ url: 'late' }]);
    assert.deepEqual(h.failures, []);
});

test('CHAT_CHANGED cancels the run', async () => {
    const h = setupParallel();
    await begin(h);
    await h.bus.emit('CHAT_CHANGED');
    assert.equal(h.jobs[0].signal.aborted, true);
    assertEnded(h);
});

test('attachImage rejecting calls onFailure and never discards the handed image', async () => {
    const boom = new Error('gone');
    const h = setupParallel({ attachImage: () => Promise.reject(boom) });
    await begin(h);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    const replyIndex = pushReply(h.state);
    await receive(h, replyIndex);
    assert.deepEqual(h.failures, [{ index: replyIndex, error: boom }]);
    assert.deepEqual(h.discards, []);
    assertEnded(h);
});

test('attachImage throwing synchronously calls onFailure', async () => {
    const boom = new Error('gone');
    const h = setupParallel({ attachImage: () => { throw boom; } });
    await begin(h);
    const replyIndex = pushReply(h.state);
    receive(h, replyIndex);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.deepEqual(h.failures, [{ index: replyIndex, error: boom }]);
    assert.deepEqual(h.discards, []);
    assertEnded(h);
});
