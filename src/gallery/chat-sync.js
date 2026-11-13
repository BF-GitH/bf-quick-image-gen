// Keeps the gallery in step with deletes done by the host: a deleted message, swipe or picture takes its gallery
// records along. Only records are removed; files stay, the host deletes its own files itself.

import { LOG_PREFIX } from '../shared/constants.js';
import { onHostEvent } from '../host/st.js';
import { getRawMessage, listChatMediaUrls } from '../host/chat.js';
import { listRecords, onGalleryChange, removeGalleryRecord } from './store.js';
import {
    goneAfterMessageDelete, goneAfterSwipeDelete, looksLikePendingDelete, normalizeUrl, takeSnapshot,
} from './chat-diff.js';

const RENEW_EVENTS = ['CHAT_CHANGED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'GENERATION_ENDED'];

let installed = false;
let snapshot = [];

// Normalised url -> the urls exactly as the records store them.
function storedUrls() {
    const map = new Map();
    for (const record of listRecords()) {
        if (typeof record?.url !== 'string' || record.url === '') continue;
        const key = normalizeUrl(record.url);
        map.set(key, [...(map.get(key) ?? []), record.url]);
    }
    return map;
}

function renew(entries = listChatMediaUrls()) {
    const own = storedUrls();
    snapshot = takeSnapshot(entries, (url) => own.has(url));
}

// The host truncates the chat, awaits a save and only then fires MESSAGE_DELETED; a tap during that save must
// not overwrite the snapshot the delete is read from.
function renewOnInput() {
    const entries = listChatMediaUrls();
    if (looksLikePendingDelete(snapshot, entries.map((entry) => entry.message))) return;
    renew(entries);
}

function removeRecords(urls) {
    const own = storedUrls();
    for (const url of urls) {
        for (const stored of own.get(normalizeUrl(url)) ?? []) removeGalleryRecord(stored);
    }
    renew();
}

function onMessageDeleted() {
    const current = listChatMediaUrls().map((entry) => entry.message);
    removeRecords(goneAfterMessageDelete(snapshot, current));
}

function onSwipeDeleted(payload) {
    const message = getRawMessage(payload?.messageId);
    const entry = message ? listChatMediaUrls().find((item) => item.message === message) : undefined;
    // No entry -> no count -> goneAfterSwipeDelete finds nothing.
    removeRecords(goneAfterSwipeDelete(snapshot, message, payload?.swipeId, entry?.swipes.length));
}

function onMediaDeleted(url) {
    removeRecords(typeof url === 'string' && url !== '' ? [url] : []);
}

// A failure here must never reach the host's own delete or event loop.
function guarded(name, handler) {
    return (...args) => {
        try {
            handler(...args);
        } catch (error) {
            console.error(LOG_PREFIX, `chat sync: ${name} failed`, error);
        }
    };
}

export function installChatSync() {
    if (installed) return;
    installed = true;
    // Wrapped so the event payload never lands in renew's entries parameter.
    const renewSafely = guarded('renew', () => renew());
    const renewOnInputSafely = guarded('renew', renewOnInput);
    renewSafely();
    for (const eventKey of RENEW_EVENTS) onHostEvent(eventKey, renewSafely);
    onGalleryChange(renewSafely);
    // The snapshot must not be older than the click or key press that starts a delete.
    document.addEventListener('pointerdown', renewOnInputSafely, true);
    document.addEventListener('keydown', renewOnInputSafely, true);
    onHostEvent('MESSAGE_DELETED', guarded('MESSAGE_DELETED', onMessageDeleted));
    onHostEvent('MESSAGE_SWIPE_DELETED', guarded('MESSAGE_SWIPE_DELETED', onSwipeDeleted));
    onHostEvent('MEDIA_ATTACHMENT_DELETED', guarded('MEDIA_ATTACHMENT_DELETED', onMediaDeleted));
}
