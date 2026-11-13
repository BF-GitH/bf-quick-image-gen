import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    goneAfterMessageDelete, goneAfterSwipeDelete, looksLikePendingDelete, normalizeUrl, takeSnapshot,
} from '../../src/gallery/chat-diff.js';

const OWN = new Set(['img/a.png', 'img/b.png', 'img/c.png', 'img/d.png', 'img/e.png']);
const isOwn = (url) => OWN.has(url);

// Message objects are compared by identity, so each test builds fresh ones.
function chat(...swipesPerMessage) {
    return swipesPerMessage.map((swipes, index) => ({ message: { id: index }, swipes }));
}

function messagesOf(entries) {
    return entries.map((entry) => entry.message);
}

test('normalizeUrl removes leading slashes only', () => {
    assert.equal(normalizeUrl('//img/a.png'), 'img/a.png');
    assert.equal(normalizeUrl('img/a.png'), 'img/a.png');
    assert.equal(normalizeUrl('img//a.png'), 'img//a.png');
});

test('last message deleted: its own urls are gone', () => {
    const entries = chat([['img/a.png']], [['img/b.png', 'img/c.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const current = messagesOf(entries).slice(0, 1);
    assert.deepEqual(goneAfterMessageDelete(snapshot, current), ['img/b.png', 'img/c.png']);
});

test('a message in the middle deleted', () => {
    const entries = chat([['img/a.png']], [['img/b.png']], [['img/c.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first, , last] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first, last]), ['img/b.png']);
});

test('several messages deleted at once, every swipe counts, each url once', () => {
    const entries = chat([['img/a.png']], [['img/b.png'], ['img/c.png', 'img/b.png']], [['img/d.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first]), ['img/b.png', 'img/c.png', 'img/d.png']);
});

test('a url that a remaining message also carries on any swipe stays', () => {
    const entries = chat([[], ['img/a.png']], [['img/a.png', 'img/b.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first]), ['img/b.png']);
});

test('a current message the snapshot does not know means no delete', () => {
    const entries = chat([['img/a.png']], [['img/b.png']], [['img/c.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [{ id: 0 }]), []);
    const [first] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first, { id: 9 }]), []);
});

test('the same number of messages means no delete', () => {
    const entries = chat([['img/a.png']], [['img/b.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    assert.deepEqual(goneAfterMessageDelete(snapshot, messagesOf(entries)), []);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [...messagesOf(entries), { id: 2 }]), []);
    // Known messages only, yet not fewer: still no delete.
    const [first] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first, first]), []);
});

test('urls that are not own never appear', () => {
    const entries = chat([['img/a.png']], [['user/upload.png', 'img/b.png'], ['other/x.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first, second] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first]), ['img/b.png']);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 1, 1), []);
});

test('a url with and without leading slash is one url', () => {
    const entries = chat([['img/a.png']], [['/img/a.png', '/img/b.png', 'img/b.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first] = messagesOf(entries);
    assert.deepEqual(goneAfterMessageDelete(snapshot, [first]), ['img/b.png']);
});

test('swipe deleted: its own urls are gone unless another swipe carries them', () => {
    const entries = chat([['img/a.png']], [['img/b.png', 'img/c.png'], ['img/c.png'], ['img/d.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [, second] = messagesOf(entries);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 0, 2), ['img/b.png']);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 2, 2), ['img/d.png']);
});

test('swipe deleted: a url that another message carries stays', () => {
    const entries = chat([['img/a.png']], [['/img/a.png', 'img/e.png'], []]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [, second] = messagesOf(entries);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 0, 1), ['img/e.png']);
});

test('swipe delete on an unknown message or an invalid swipe index finds nothing', () => {
    const entries = chat([['img/a.png'], ['img/b.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first] = messagesOf(entries);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, { id: 0 }, 0, 1), []);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, null, 0, 1), []);
    for (const swipeId of [-1, 2, 1.5, '1', undefined]) {
        assert.deepEqual(goneAfterSwipeDelete(snapshot, first, swipeId, 1), [], `swipeId ${swipeId}`);
    }
});

test('looksLikePendingDelete: only fewer messages that are all known', () => {
    const entries = chat([['img/a.png']], [['img/b.png']], [['img/c.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [first, second, third] = messagesOf(entries);
    assert.equal(looksLikePendingDelete(snapshot, [first, third]), true);
    assert.equal(looksLikePendingDelete(snapshot, [first, second, third]), false);
    assert.equal(looksLikePendingDelete(snapshot, [first, { id: 9 }]), false);
    assert.equal(looksLikePendingDelete(snapshot, [first, second, third, { id: 3 }]), false);
});

test('swipe delete: only a snapshot with one swipe more than now counts', () => {
    const entries = chat([['img/a.png']], [['img/b.png'], ['img/c.png']]);
    const snapshot = takeSnapshot(entries, isOwn);
    const [, second] = messagesOf(entries);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 0, 1), ['img/b.png']);
    // Snapshot already renewed after the splice: same count as now, swipe 0 would be the survivor.
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 0, 2), []);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 0, undefined), []);
    assert.deepEqual(goneAfterSwipeDelete(snapshot, second, 0), []);
});
