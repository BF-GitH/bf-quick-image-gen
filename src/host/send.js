// The composer and the host's own send pipeline. We click #send_but instead of calling host internals,
// so a "Senden + Bild" send behaves exactly like a normal one.

import { LOG_PREFIX } from '../shared/constants.js';
import { getContext } from './st.js';

const STREAM_RESTORE_MARKER = 'bfqig_stream_restore';

function setMarker() {
    try {
        localStorage.setItem(STREAM_RESTORE_MARKER, '1');
    } catch (error) {
        console.warn(LOG_PREFIX, 'localStorage unavailable', error);
    }
}

function clearMarker() {
    try {
        localStorage.removeItem(STREAM_RESTORE_MARKER);
    } catch (error) {
        console.warn(LOG_PREFIX, 'localStorage unavailable', error);
    }
}

function hasMarker() {
    try {
        return localStorage.getItem(STREAM_RESTORE_MARKER) !== null;
    } catch {
        return false;
    }
}

export function getComposerText() {
    const textarea = document.getElementById('send_textarea');
    return typeof textarea?.value === 'string' ? textarea.value : '';
}

export function clickSend() {
    const button = document.getElementById('send_but');
    if (!button) return false;
    button.click();
    return true;
}

export function disableStreamingOnce() {
    const ctx = getContext();
    const settings = ctx.chatCompletionSettings;
    if (ctx.mainApi !== 'openai' || settings?.stream_openai !== true) {
        return null;
    }
    // A streamed reply is in the DOM before MESSAGE_RECEIVED, so the hold needs one non-streamed reply.
    settings.stream_openai = false;
    // The marker survives an app kill inside this window; repairStreamingFlag() undoes it on the next start.
    setMarker();
    let restored = false;
    return () => {
        if (restored) return;
        restored = true;
        settings.stream_openai = true;
        clearMarker();
    };
}

export function repairStreamingFlag() {
    if (!hasMarker()) return;
    try {
        const ctx = getContext();
        if (ctx.chatCompletionSettings) {
            ctx.chatCompletionSettings.stream_openai = true;
        }
        ctx.saveSettingsDebounced();
        clearMarker();
    } catch (error) {
        // Keep the marker so the next start tries again.
        console.warn(LOG_PREFIX, 'repairStreamingFlag failed', error);
    }
}
