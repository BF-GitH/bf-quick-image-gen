// State machine for "Senden + Bild": send, hold the reply back, attach an image, release.
// Pure: every host effect and every timer comes in through the deps object so it runs in Node.

import { LOG_PREFIX } from '../shared/constants.js';
import { MESSAGES } from './messages.js';
import { earlyExitMessage } from './preflight.js';

export { MESSAGES };

const DEFAULT_CONFIG = Object.freeze({
    startTimeoutMs: 8000, endedGraceMs: 1500, watchdogMs: 2000, imagingTimeoutMs: 240000, preRequestTimeoutMs: 30000,
});
// One idle tick can be the gap between two host phases; two in a row mean the host is done.
const IDLE_TICKS_TO_FINISH = 2;

function isAbort(signal, error) {
    return signal.aborted || error?.name === 'AbortError';
}

export function createSendWithImageController({
    host, precheck, processReply, hold, notify, onFailure, timers = globalThis, config = {},
}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    let run = null;

    function clearTimers(r) {
        if (r.startTimer !== null) timers.clearTimeout(r.startTimer);
        if (r.graceTimer !== null) timers.clearTimeout(r.graceTimer);
        if (r.watchdog !== null) timers.clearInterval(r.watchdog);
        if (r.imagingTimer !== null) timers.clearTimeout(r.imagingTimer);
        r.startTimer = null;
        r.graceTimer = null;
        r.watchdog = null;
        r.imagingTimer = null;
    }

    function restoreStreaming(r) {
        const restore = r.restoreStreaming;
        r.restoreStreaming = null;
        if (typeof restore === 'function') restore();
    }

    // Takes the run explicitly: a late callback of an older run must not end a newer one.
    function finish(r) {
        if (!r || run !== r) return;
        clearTimers(r);
        restoreStreaming(r);
        run = null;
        hold.release();
        hold.setStatus(null);
    }

    function cancel() {
        const r = run;
        if (!r) return;
        r.abort.abort();
        if (r.phase !== 'imaging') finish(r);
    }

    function onWatchdogTick(r) {
        if (run !== r || r.phase !== 'generating' || r.handled) return;
        if (host.isGenerating()) {
            r.requestSeen = true;
            r.idleTicks = 0;
        } else if (r.requestSeen) {
            r.idleTicks += 1;
            if (r.idleTicks >= IDLE_TICKS_TO_FINISH) finish(r);
        } else if ((r.preRequestMs += cfg.watchdogMs) >= cfg.preRequestTimeoutMs) {
            // Host pre-request work (listeners, server ping, group setup) ran out of time without a request.
            notify.warning(MESSAGES.notStarted);
            finish(r);
        }
    }

    function onGenerationStarted(type, _options, dryRun) {
        const r = run;
        if (!r || dryRun === true || type === 'quiet') return;
        // Streaming leaves the host UI unlocked while imaging; a new send must not stay hidden by the hold.
        if (r.phase === 'imaging') {
            hold.release();
            return;
        }
        // A follow-up generation of the same send (tool calls) keeps the run alive.
        if (r.phase === 'generating') {
            if (r.graceTimer !== null) timers.clearTimeout(r.graceTimer);
            r.graceTimer = null;
            r.idleTicks = 0;
        }
        if (r.phase !== 'armed') return;
        r.phase = 'generating';
        if (r.startTimer !== null) timers.clearTimeout(r.startTimer);
        r.startTimer = null;
    }

    // The host reads the streaming flag before this event, so the original value can come back now.
    function onSettingsReady() {
        const r = run;
        if (r && r.phase !== 'armed') restoreStreaming(r);
    }

    function onMessageSent(index) {
        const r = run;
        if (!r || (r.phase !== 'armed' && r.phase !== 'generating') || !Number.isInteger(index)) return;
        r.userIndex = index;
        r.requestSeen = true;
        hold.engage(index);
    }

    function onMessageReceived(index, type) {
        const r = run;
        if (!r || r.handled || type === 'first_message') return undefined;
        if (!Number.isInteger(index) || index <= r.userIndex) return undefined;
        const message = host.getRawMessage(index);
        if (!message || message.is_user || message.is_system) return undefined;
        // An empty tool-call turn comes first; the real answer follows from a recursive generation.
        const text = String(message.mes ?? '').trim();
        if (!text || text === '...') return undefined;
        r.handled = true;
        r.phase = 'imaging';
        clearTimers(r);
        hold.setStatus(MESSAGES.statusImage, { onCancel: cancel });
        // Returned so the host's awaited emit holds the render until the image is attached.
        return (async () => {
            const signal = r.abort.signal;
            try {
                const outcome = await raceImaging(r, processReply(index, signal));
                if (outcome === 'timeout') {
                    reportFailure(index, new Error(MESSAGES.imageTimeout));
                    r.abort.abort();
                }
            } catch (error) {
                if (!isAbort(signal, error)) reportFailure(index, error);
            } finally {
                finish(r);
            }
        })();
    }

    // The chat-model call inside processReply ignores our signal, so a hang there must not keep the hold:
    // settle on abort or timeout, and let a late result fall on the floor silently.
    function raceImaging(r, pending) {
        const work = Promise.resolve(pending);
        work.catch(() => {});
        const signal = r.abort.signal;
        let onAbort = null;
        const stop = new Promise((resolve) => {
            onAbort = () => resolve('aborted');
            signal.addEventListener('abort', onAbort, { once: true });
            r.imagingTimer = timers.setTimeout(() => {
                r.imagingTimer = null;
                resolve('timeout');
            }, cfg.imagingTimeoutMs);
        });
        return Promise.race([work.then(() => 'done'), stop]).finally(() => {
            signal.removeEventListener('abort', onAbort);
            if (r.imagingTimer !== null) timers.clearTimeout(r.imagingTimer);
            r.imagingTimer = null;
        });
    }

    function reportFailure(index, error) {
        try {
            onFailure?.(index, error);
        } catch (failure) {
            console.error(LOG_PREFIX, 'onFailure threw', failure);
        }
    }

    function onGenerationStopped() {
        cancel();
    }

    function onGenerationEnded() {
        const r = run;
        if (!r || r.handled || r.phase === 'armed') return;
        if (r.graceTimer !== null) timers.clearTimeout(r.graceTimer);
        r.graceTimer = timers.setTimeout(() => {
            r.graceTimer = null;
            if (run === r && !r.handled) finish(r);
        }, cfg.endedGraceMs);
    }

    function onChatChanged() {
        const r = run;
        if (!r) return;
        r.abort.abort();
        finish(r);
    }

    const unsubscribers = [
        host.onEvent('GENERATION_STARTED', onGenerationStarted),
        host.onEvent('CHAT_COMPLETION_SETTINGS_READY', onSettingsReady),
        host.onEvent('MESSAGE_SENT', onMessageSent),
        host.onEvent('MESSAGE_RECEIVED', onMessageReceived),
        host.onEvent('GENERATION_STOPPED', onGenerationStopped),
        host.onEvent('GENERATION_ENDED', onGenerationEnded),
        host.onEvent('CHAT_CHANGED', onChatChanged),
    ];

    async function start() {
        const early = earlyExitMessage(host, run !== null);
        if (early) {
            notify.warning(early);
            return false;
        }
        try {
            await precheck();
        } catch (error) {
            notify.error(error?.message || String(error));
            return false;
        }
        // precheck awaited: another start() or a normal send may have begun in between.
        if (run) {
            notify.warning(MESSAGES.busy);
            return false;
        }
        if (host.isGenerating()) {
            notify.warning(MESSAGES.generating);
            return false;
        }

        const r = {
            phase: 'armed',
            userIndex: host.getChatLength(),
            abort: new AbortController(),
            restoreStreaming: null,
            handled: false,
            startTimer: null,
            graceTimer: null,
            watchdog: null,
            imagingTimer: null,
            idleTicks: 0,
            requestSeen: false, // idle ticks only mean "done" once the host reached its request phase
            preRequestMs: 0,
        };
        run = r;
        r.restoreStreaming = host.disableStreamingOnce() ?? null;
        hold.engage(r.userIndex);
        hold.setStatus(MESSAGES.statusReply);

        r.startTimer = timers.setTimeout(() => {
            r.startTimer = null;
            if (run !== r || r.phase !== 'armed') return;
            notify.warning(MESSAGES.notStarted);
            finish(r);
        }, cfg.startTimeoutMs);
        r.watchdog = timers.setInterval(() => onWatchdogTick(r), cfg.watchdogMs);

        let clicked;
        try {
            clicked = host.clickSend();
        } catch (error) {
            finish(r);
            throw error;
        }
        if (clicked === false) {
            notify.error(MESSAGES.noSendButton);
            finish(r);
            return false;
        }
        return true;
    }

    function dispose() {
        for (const unsubscribe of unsubscribers) {
            if (typeof unsubscribe === 'function') unsubscribe();
        }
        unsubscribers.length = 0;
        if (run) {
            run.abort.abort();
            finish(run);
        }
    }

    return {
        start,
        cancel,
        isActive: () => run !== null,
        dispose,
    };
}
