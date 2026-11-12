// Host boundary: the only place that talks to SillyTavern.getContext(), the TauriTavern globals and toastr.
// Thin by design: call the host and convert, no business logic.

import { LOG_PREFIX } from '../shared/constants.js';

const NOTIFY_TITLE = 'BF Quick Image Gen';

export function getContext() {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (!ctx) {
        throw new Error('SillyTavern.getContext() ist nicht verfügbar.');
    }
    return ctx;
}

export async function whenHostReady() {
    // TauriTavern activates third-party extensions after APP_READY, but its api.* namespace is only
    // guaranteed once this promise settles. Plain SillyTavern has neither global.
    const ready = window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__;
    if (ready && typeof ready.then === 'function') {
        await ready;
    }
}

export function getHostInfo() {
    return {
        isTauriTavern: Boolean(window.__TAURITAVERN__ || window.__TAURITAVERN_HOST__),
        platform: String(window.__TAURITAVERN_HOST__?.platform ?? 'web'),
    };
}

export function onHostEvent(eventKey, handler) {
    const noop = () => {};
    let ctx;
    try {
        ctx = getContext();
    } catch {
        return noop;
    }
    const eventName = ctx.eventTypes?.[eventKey];
    const source = ctx.eventSource;
    if (!eventName || typeof source?.on !== 'function') {
        return noop;
    }
    source.on(eventName, handler);
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        source.removeListener?.(eventName, handler);
    };
}

export function isGenerating() {
    return document.body?.dataset?.generating === 'true';
}

export function isChatOpen() {
    const ctx = getContext();
    const hasCharacter = ctx.characterId !== undefined && ctx.characterId !== null;
    return hasCharacter || Boolean(ctx.groupId);
}

export function getChatId() {
    const ctx = getContext();
    return ctx.getCurrentChatId?.() ?? ctx.chatId ?? null;
}

export function getExtensionSettingsRoot() {
    return getContext().extensionSettings;
}

export function saveSettings() {
    getContext().saveSettingsDebounced();
}

export function substituteMacros(text) {
    try {
        const result = getContext().substituteParams(text);
        return typeof result === 'string' ? result : text;
    } catch {
        return text;
    }
}

export function timestampName() {
    let raw;
    try {
        raw = getContext().humanizedDateTime?.() ?? '';
    } catch {
        raw = '';
    }
    if (!raw) {
        raw = new Date().toISOString().replace(/[:.]/g, '-');
    }
    // File names go to the upload route and to <a download>; keep them portable.
    return String(raw).replace(/[^A-Za-z0-9@_-]/g, '_');
}

function toast(level, message, { onClick, sticky } = {}) {
    const toastr = globalThis.toastr;
    if (!toastr || typeof toastr[level] !== 'function') {
        const log = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info;
        log(LOG_PREFIX, message);
        return;
    }
    const options = {};
    if (sticky) {
        options.timeOut = 0;
        options.extendedTimeOut = 0;
        options.closeButton = true;
    }
    if (typeof onClick === 'function') {
        options.onclick = onClick;
    }
    toastr[level](message, NOTIFY_TITLE, options);
}

export const notify = Object.freeze({
    info: (message, options) => toast('info', message, options),
    success: (message, options) => toast('success', message, options),
    warning: (message, options) => toast('warning', message, options),
    error: (message, options) => toast('error', message, options),
});

export async function confirmDialog(message) {
    const ctx = getContext();
    const result = await ctx.callGenericPopup(message, ctx.POPUP_TYPE.CONFIRM);
    const affirmative = ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1;
    return result === affirmative || result === true;
}

// Shared by secrets.js and images.js: every same-origin /api call is POST + host headers + JSON body.
// TauriTavern serves these routes from its in-page router, so the request shape must match SillyTavern's.
export async function postApi(path, body = {}) {
    return fetch(path, {
        method: 'POST',
        headers: getContext().getRequestHeaders(),
        body: JSON.stringify(body),
    });
}
