import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../../src/flow/messages.js';
import { resendExitMessage } from '../../src/flow/preflight.js';
import { flush, setup, setupParallel, pushUser, pushReply } from './fake-host.js';

// The hold harness starts with the user's message last; a resend needs an empty composer.
function holdResend(options) {
    const h = setup(options);
    h.state.composer = '';
    return h;
}

function parallelResend(options) {
    const h = setupParallel(options);
    h.state.composer = '';
    const userIndex = pushUser(h.state);
    return { h, userIndex };
}

function receive(h, index, type = 'normal') {
    const [listener] = h.bus.handlersOf('MESSAGE_RECEIVED');
    return listener(index, type);
}

test('hold resend: text in the composer is refused, no click, not active', async () => {
    const h = setup();
    h.state.composer = 'Hallo';
    assert.equal(await h.controller.start({ resend: true }), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.resendComposer]]);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.controller.isActive(), false);
});

test('hold resend: last message not the user\'s is refused, no click', async () => {
    const h = holdResend();
    pushReply(h.state);
    assert.equal(await h.controller.start({ resend: true }), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.resendNotLast]]);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.controller.isActive(), false);
});

test('hold resend: engages at the existing user message, reply below it gets the picture, then released', async () => {
    const h = holdResend();
    const userIndex = h.state.chat.length - 1;
    assert.equal(await h.controller.start({ resend: true }), true);
    assert.equal(h.state.clicks, 1);
    assert.deepEqual(h.log[0], ['engage', userIndex]);
    assert.notEqual(userIndex, h.state.chat.length);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    const replyIndex = pushReply(h.state);
    assert.equal(replyIndex, userIndex + 1);
    await h.bus.emit('MESSAGE_RECEIVED', replyIndex, 'normal');
    assert.deepEqual(h.replies.map((reply) => reply.index), [replyIndex]);
    assert.deepEqual(h.log.filter((entry) => entry[0] === 'release'), [['release']]);
    assert.equal(h.controller.isActive(), false);
    assert.deepEqual(h.notes, []);
});

test('hold resend: the last message changes while precheck is awaited -> resendNotLast, no click', async () => {
    let h = null;
    h = holdResend({ precheck: async () => { pushReply(h.state); } });
    assert.equal(await h.controller.start({ resend: true }), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.resendNotLast]]);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.controller.isActive(), false);
});

test('hold start without resend and an empty composer still answers emptyText', async () => {
    const h = holdResend();
    assert.equal(await h.controller.start(), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.emptyText]]);
    assert.equal(h.state.clicks, 0);
});

test('parallel resend: text in the composer is refused, no click, not active', async () => {
    const { h } = parallelResend();
    h.state.composer = 'Hallo';
    assert.equal(await h.controller.start({ resend: true }), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.resendComposer]]);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.controller.isActive(), false);
});

test('parallel resend: last message not the user\'s is refused, no click', async () => {
    const h = setupParallel();
    h.state.composer = '';
    assert.equal(await h.controller.start({ resend: true }), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.resendNotLast]]);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.controller.isActive(), false);
});

test('parallel resend: the last message changes while precheck is awaited -> resendNotLast, no click', async () => {
    let h = null;
    ({ h } = parallelResend({ precheck: async () => { pushReply(h.state); } }));
    assert.equal(await h.controller.start({ resend: true }), false);
    assert.deepEqual(h.notes, [['warning', MESSAGES.resendNotLast]]);
    assert.equal(h.state.clicks, 0);
});

test('parallel resend: job starts on GENERATION_STARTED at the user message, reply gets the picture', async () => {
    const { h, userIndex } = parallelResend();
    assert.equal(await h.controller.start({ resend: true }), true);
    assert.equal(h.state.clicks, 1);
    assert.equal(h.jobs.length, 0);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    assert.equal(h.jobs.length, 1);
    assert.equal(h.jobs[0].lastIndex, userIndex);
    const replyIndex = pushReply(h.state);
    assert.equal(receive(h, replyIndex), undefined);
    h.jobs[0].resolve({ url: 'img' });
    await flush();
    assert.deepEqual(h.attaches, [{ index: replyIndex, prepared: { url: 'img' }, token: { token: replyIndex }, save: true }]);
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.timers.pendingCount(), 0);
    assert.deepEqual(h.failures, []);
});

test('parallel resend: a quiet or dry-run GENERATION_STARTED starts no job', async () => {
    const { h } = parallelResend();
    assert.equal(await h.controller.start({ resend: true }), true);
    await h.bus.emit('GENERATION_STARTED', 'quiet', {}, false);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, true);
    assert.equal(h.jobs.length, 0);
    assert.equal(h.controller.isActive(), true);
});

test('parallel resend: a second GENERATION_STARTED or a MESSAGE_SENT starts no second job', async () => {
    const { h } = parallelResend();
    assert.equal(await h.controller.start({ resend: true }), true);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    await h.bus.emit('MESSAGE_SENT', pushUser(h.state));
    assert.equal(h.jobs.length, 1);
});

test('parallel resend: the host never starts -> start timer, notStarted, zero jobs', async () => {
    const { h } = parallelResend();
    assert.equal(await h.controller.start({ resend: true }), true);
    h.timers.advance(8000);
    assert.deepEqual(h.notes, [['warning', MESSAGES.notStarted]]);
    assert.equal(h.jobs.length, 0);
    assert.equal(h.controller.isActive(), false);
});

test('parallel start without resend: GENERATION_STARTED alone starts no job, MESSAGE_SENT does', async () => {
    const h = setupParallel();
    assert.equal(await h.controller.start(), true);
    await h.bus.emit('GENERATION_STARTED', 'normal', {}, false);
    assert.equal(h.jobs.length, 0);
    const userIndex = pushUser(h.state);
    await h.bus.emit('MESSAGE_SENT', userIndex);
    assert.equal(h.jobs.length, 1);
    assert.equal(h.jobs[0].lastIndex, userIndex);
});

function preflightHost(composer, chat) {
    return {
        getComposerText: () => composer,
        getChatLength: () => chat.length,
        getRawMessage: (index) => chat[index] ?? null,
    };
}

test('resendExitMessage: whitespace-only composer counts as text', () => {
    const chat = [{ mes: 'Hi', is_user: true }];
    assert.equal(resendExitMessage(preflightHost('  \n', chat)), MESSAGES.resendComposer);
    assert.equal(resendExitMessage(preflightHost('', chat)), null);
});

test('resendExitMessage: empty chat -> resendNotLast', () => {
    assert.equal(resendExitMessage(preflightHost('', [])), MESSAGES.resendNotLast);
});
