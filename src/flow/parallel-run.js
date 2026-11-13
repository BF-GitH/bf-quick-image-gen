// Parallel "Senden + Bild": the reply streams like a normal send while the image is generated from the
// chat up to the user's message, then the image is attached below the reply once both are done.
// Pure: every host effect and every timer comes in through the deps object so it runs in Node.

import { LOG_PREFIX } from '../shared/constants.js';
import { MESSAGES } from './messages.js';
import { earlyExitMessage, resendExitMessage } from './preflight.js';

const DEFAULT_CONFIG = Object.freeze({
    startTimeoutMs: 8000, endedGraceMs: 1500, watchdogMs: 2000, imagingTimeoutMs: 660000,
});
// One idle tick can be the gap between two host phases; two in a row mean the host is done.
const IDLE_TICKS_TO_CANCEL = 2;
const CANCEL_LABEL = 'Abbrechen';

function isAbort(signal, error) {
    return signal.aborted || error?.name === 'AbortError';
}

export function createParallelImageController({
    host, precheck, prepareImage, captureReply, attachImage, discardImage, status, notify, onFailure,
    timers = globalThis, config = {},
}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    let run = null;

    function clearTimer(r, key, clear = timers.clearTimeout) {
        if (r[key] !== null) clear(r[key]);
        r[key] = null;
    }

    function clearTimers(r) {
        clearTimer(r, 'startTimer');
        clearTimer(r, 'graceTimer');
        clearTimer(r, 'imagingTimer');
        clearTimer(r, 'watchdog', timers.clearInterval);
    }

    function safeDiscard(prepared) {
        try {
            discardImage(prepared);
        } catch (error) {
            console.error(LOG_PREFIX, 'discardImage threw', error);
        }
    }

    function reportFailure(index, error) {
        try {
            onFailure?.(index, error);
        } catch (failure) {
            console.error(LOG_PREFIX, 'onFailure threw', failure);
        }
    }

    // Takes the run explicitly: a late callback of an older run must not end a newer one.
    function finish(r) {
        if (!r || run !== r) return;
        clearTimers(r);
        run = null;
        status.setStatus(null);
        // A ready image that never reached attachImage would otherwise stay stored without a message.
        if (r.image === 'ready' && !r.attached) {
            const prepared = r.prepared;
            r.prepared = null;
            safeDiscard(prepared);
        }
    }

    function cancelRun(r) {
        if (!r || run !== r) return;
        r.abort.abort();
        finish(r);
    }

    function cancel() {
        cancelRun(run);
    }

    // Called once per run; attachImage attaches before its first await, so a returned promise lets the
    // host render and save text and image together. The result never rejects.
    function attach(r, save) {
        if (r.attached) return Promise.resolve();
        r.attached = true;
        const prepared = r.prepared;
        r.prepared = null;
        const { index, token } = r.reply;
        let pending;
        try {
            pending = Promise.resolve(attachImage(index, prepared, { token, save }));
        } catch (error) {
            pending = Promise.reject(error);
        }
        return pending.then(
            () => {},
            (error) => reportFailure(index, error),
        ).finally(() => finish(r));
    }

    function imageFailed(r, error) {
        r.image = 'failed';
        r.error = error;
        if (r.reply) {
            reportFailure(r.reply.index, error);
            finish(r);
        }
    }

    function startImageJob(r, lastIndex) {
        r.image = 'pending';
        r.imagingTimer = timers.setTimeout(() => {
            r.imagingTimer = null;
            if (run !== r || r.image !== 'pending') return;
            r.abort.abort();
            imageFailed(r, new Error(MESSAGES.imageTimeout));
        }, cfg.imagingTimeoutMs);
        let job;
        try {
            job = Promise.resolve(prepareImage(lastIndex, r.abort.signal));
        } catch (error) {
            job = Promise.reject(error);
        }
        job.then((prepared) => {
            // Ended, cancelled or timed out meanwhile: nobody will attach this image.
            if (run !== r || r.image !== 'pending') {
                safeDiscard(prepared);
                return;
            }
            clearTimer(r, 'imagingTimer');
            r.image = 'ready';
            r.prepared = prepared;
            if (r.reply) attach(r, true);
        }, (error) => {
            if (run !== r || r.image !== 'pending' || isAbort(r.abort.signal, error)) return;
            clearTimer(r, 'imagingTimer');
            imageFailed(r, error);
        });
    }

    function onMessageSent(index) {
        const r = run;
        if (!r || r.phase !== 'armed' || !Number.isInteger(index)) return;
        r.userIndex = index;
        r.phase = 'running';
        clearTimer(r, 'startTimer');
        startImageJob(r, index);
    }

    function onMessageReceived(index, type) {
        const r = run;
        if (!r || r.phase !== 'running' || r.reply || type === 'first_message') return undefined;
        if (!Number.isInteger(index) || index <= r.userIndex) return undefined;
        const message = host.getRawMessage(index);
        if (!message || message.is_user || message.is_system) return undefined;
        // An empty tool-call turn comes first; the real answer follows from a recursive generation.
        const text = String(message.mes ?? '').trim();
        if (!text || text === '...') return undefined;
        let token;
        try {
            token = captureReply(index);
        } catch (error) {
            reportFailure(index, error);
            cancelRun(r);
            return undefined;
        }
        r.reply = { index, token };
        // From here on only the imaging timer bounds the run.
        clearTimer(r, 'graceTimer');
        clearTimer(r, 'watchdog', timers.clearInterval);
        if (r.image === 'ready') return attach(r, false);
        if (r.image === 'failed') {
            reportFailure(index, r.error);
            finish(r);
        }
        // Still pending: the reply renders at once and the image follows when ready.
        return undefined;
    }

    function onGenerationStarted(type, _options, dryRun) {
        const r = run;
        if (!r || dryRun === true || type === 'quiet') return;
        // A resend adds no message, so MESSAGE_SENT never comes: the image starts once the host really started.
        if (r.resend && r.phase === 'armed') {
            r.phase = 'running';
            clearTimer(r, 'startTimer');
            startImageJob(r, r.userIndex);
        }
        // A follow-up generation of the same send (tool calls) keeps the run alive.
        clearTimer(r, 'graceTimer');
        r.idleTicks = 0;
    }

    function onGenerationEnded() {
        const r = run;
        if (!r || r.reply) return;
        clearTimer(r, 'graceTimer');
        r.graceTimer = timers.setTimeout(() => {
            r.graceTimer = null;
            if (run === r && !r.reply) cancelRun(r);
        }, cfg.endedGraceMs);
    }

    // Once the reply is known, a stop belongs to a later generation of the user, not to this send.
    function onGenerationStopped() {
        if (run && !run.reply) cancelRun(run);
    }

    function onWatchdogTick(r) {
        if (run !== r || r.phase !== 'running' || r.reply) return;
        if (host.isGenerating()) {
            r.idleTicks = 0;
            return;
        }
        r.idleTicks += 1;
        if (r.idleTicks >= IDLE_TICKS_TO_CANCEL) cancelRun(r);
    }

    const unsubscribers = [
        host.onEvent('GENERATION_STARTED', onGenerationStarted),
        host.onEvent('MESSAGE_SENT', onMessageSent),
        host.onEvent('MESSAGE_RECEIVED', onMessageReceived),
        host.onEvent('GENERATION_STOPPED', onGenerationStopped),
        host.onEvent('GENERATION_ENDED', onGenerationEnded),
        host.onEvent('CHAT_CHANGED', cancel),
    ];

    async function start({ resend = false } = {}) {
        const early = earlyExitMessage(host, run !== null, { resend });
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
        // The chat may have changed while precheck was awaited.
        const resendExit = resend ? resendExitMessage(host) : null;
        if (resendExit) {
            notify.warning(resendExit);
            return false;
        }

        const r = {
            phase: 'armed',
            resend,
            userIndex: resend ? host.getChatLength() - 1 : -1,
            abort: new AbortController(),
            image: 'idle',
            prepared: null,
            error: null,
            reply: null,
            attached: false,
            startTimer: null,
            graceTimer: null,
            watchdog: null,
            imagingTimer: null,
            idleTicks: 0,
        };
        run = r;
        status.setStatus(MESSAGES.statusImage, { onCancel: cancel, cancelLabel: CANCEL_LABEL });

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
        cancel();
    }

    return {
        start,
        cancel,
        isActive: () => run !== null,
        dispose,
    };
}
