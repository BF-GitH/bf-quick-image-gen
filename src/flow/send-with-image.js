// WIRING: binds the pure send-with-image controllers (hold mode and parallel mode) to the host and adds the
// tap-to-retry path, which the per-message image button reuses.

import { createSendWithImageController, MESSAGES } from './run-state.js';
import { createParallelImageController } from './parallel-run.js';
import { createHold } from './hold.js';
import {
    attachPreparedImage,
    captureMessage,
    checkConfiguration,
    discardPreparedImage,
    generateImageForMessage,
    MESSAGE_GONE_CODE,
    prepareImage,
} from './generate-image.js';
import { getSettings } from '../settings/store.js';
import { getChatId, isChatOpen, isGenerating, notify, onHostEvent } from '../host/st.js';
import { getChatLength, getRawMessage } from '../host/chat.js';
import { clickSend, disableStreamingOnce, getComposerText } from '../host/send.js';

const MESSAGE_GONE = 'Die Nachricht ist nicht mehr vorhanden.';

function isAbort(error, signal) {
    return Boolean(signal?.aborted) || error?.name === 'AbortError';
}

export function initSendWithImage() {
    const hold = createHold();
    // Per message index: the chat id and the live message object at failure time. A retry may only touch
    // exactly that message; after a chat switch or a deleted/swapped message the index means something else.
    const failures = new Map();
    let retrying = false;
    let holdController = null;
    let parallelController = null;

    function showFailure(index, error) {
        // The index may already belong to another message, so a retry would attach the image there.
        if (error?.code === MESSAGE_GONE_CODE) {
            // An older toast for this index must not be able to start a retry either.
            failures.delete(index);
            notify.warning(error.message);
            return;
        }
        failures.set(index, { chatId: getChatId(), message: getRawMessage(index) });
        const reason = error?.message ?? String(error);
        notify.error(`Bild fehlgeschlagen: ${reason} – Tippen zum Wiederholen.`, {
            sticky: true,
            onClick: () => { retry(index); },
        });
    }

    // Both modes share the status bar, the chat and the retry toast, so only one job may run at a time.
    function precheckExcept(own) {
        return async () => {
            const other = own === 'hold' ? parallelController : holdController;
            if (retrying || other?.isActive()) throw new Error(MESSAGES.busy);
            await checkConfiguration();
        };
    }

    const toastNotify = {
        warning: (message) => notify.warning(message),
        error: (message) => notify.error(message),
    };

    holdController = createSendWithImageController({
        host: {
            isChatOpen,
            isGenerating,
            getComposerText,
            clickSend,
            getChatLength,
            getRawMessage,
            disableStreamingOnce,
            onEvent: onHostEvent,
        },
        precheck: precheckExcept('hold'),
        processReply: (index, signal) => generateImageForMessage(index, { signal, saveBefore: true, onPrompt: hold.setPrompt }),
        hold,
        notify: toastNotify,
        onFailure: showFailure,
    });

    parallelController = createParallelImageController({
        host: {
            isChatOpen,
            isGenerating,
            getComposerText,
            clickSend,
            getChatLength,
            getRawMessage,
            onEvent: onHostEvent,
        },
        precheck: precheckExcept('parallel'),
        prepareImage: (lastIndex, signal) => prepareImage(lastIndex, { signal, onPrompt: hold.setPrompt }),
        captureReply: captureMessage,
        attachImage: attachPreparedImage,
        discardImage: discardPreparedImage,
        status: hold,
        notify: toastNotify,
        onFailure: showFailure,
    });

    // Retry and the message button share the job slot, the status bar and the failure toast.
    function refuseWhileBusy() {
        if (retrying || holdController.isActive() || parallelController.isActive()) {
            notify.warning(MESSAGES.busy);
            return true;
        }
        if (isGenerating()) {
            notify.warning(MESSAGES.generating);
            return true;
        }
        return false;
    }

    async function retry(messageIndex) {
        const failure = failures.get(messageIndex);
        if (!failure) return;
        if (refuseWhileBusy()) return;
        if (getChatId() !== failure.chatId || getRawMessage(messageIndex) !== failure.message) {
            failures.delete(messageIndex);
            notify.warning(MESSAGE_GONE);
            return;
        }
        await runForMessage(messageIndex);
    }

    // Adds one more picture to the message; the ones it already has stay. The user's own last message has no
    // reply yet (it was deleted), so it gets the reply written again and the picture with it.
    async function imageForMessage(messageIndex) {
        if (refuseWhileBusy()) return;
        const message = getRawMessage(messageIndex);
        if (!message) {
            notify.warning(MESSAGE_GONE);
            return;
        }
        if (message.is_user && messageIndex === getChatLength() - 1) {
            await (getSettings().parallelImage ? parallelController : holdController).start({ resend: true });
            return;
        }
        await runForMessage(messageIndex);
    }

    async function runForMessage(messageIndex) {
        retrying = true;
        const abort = new AbortController();
        const offChatChanged = onHostEvent('CHAT_CHANGED', () => abort.abort());
        // The text is already visible on a retry, so "Text sofort zeigen" would promise nothing.
        hold.setStatus(MESSAGES.statusImage, { onCancel: () => abort.abort(), cancelLabel: 'Abbrechen' });
        try {
            await generateImageForMessage(messageIndex, { signal: abort.signal, saveAfterAttach: true, onPrompt: hold.setPrompt });
            failures.delete(messageIndex);
        } catch (error) {
            if (!isAbort(error, abort.signal)) showFailure(messageIndex, error);
        } finally {
            offChatChanged();
            hold.setStatus(null);
            retrying = false;
        }
    }

    return {
        // Read at call time, so toggling the checkbox takes effect with the next send.
        start: () => (getSettings().parallelImage ? parallelController : holdController).start(),
        retry,
        imageForMessage,
    };
}
