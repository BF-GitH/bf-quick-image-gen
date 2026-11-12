// WIRING: binds the pure send-with-image controller to the host and adds the tap-to-retry path.

import { createSendWithImageController, MESSAGES } from './run-state.js';
import { createHold } from './hold.js';
import { checkConfiguration, generateImageForMessage } from './generate-image.js';
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
    let controller = null;

    function showFailure(index, error) {
        failures.set(index, { chatId: getChatId(), message: getRawMessage(index) });
        const reason = error?.message ?? String(error);
        notify.error(`Bild fehlgeschlagen: ${reason} – Tippen zum Wiederholen.`, {
            sticky: true,
            onClick: () => { retry(index); },
        });
    }

    controller = createSendWithImageController({
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
        precheck: async () => {
            if (retrying) throw new Error(MESSAGES.busy);
            await checkConfiguration();
        },
        processReply: (index, signal) => generateImageForMessage(index, { signal, saveBefore: true }),
        hold,
        notify: {
            warning: (message) => notify.warning(message),
            error: (message) => notify.error(message),
        },
        onFailure: showFailure,
    });

    async function retry(messageIndex) {
        const failure = failures.get(messageIndex);
        if (!failure) return;
        if (retrying || controller.isActive()) {
            notify.warning(MESSAGES.busy);
            return;
        }
        if (isGenerating()) {
            notify.warning(MESSAGES.generating);
            return;
        }
        if (getChatId() !== failure.chatId || getRawMessage(messageIndex) !== failure.message) {
            failures.delete(messageIndex);
            notify.warning(MESSAGE_GONE);
            return;
        }

        retrying = true;
        const abort = new AbortController();
        const offChatChanged = onHostEvent('CHAT_CHANGED', () => abort.abort());
        // The text is already visible on a retry, so "Text sofort zeigen" would promise nothing.
        hold.setStatus(MESSAGES.statusImage, { onCancel: () => abort.abort(), cancelLabel: 'Abbrechen' });
        try {
            await generateImageForMessage(messageIndex, { signal: abort.signal, saveAfterAttach: true });
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
        start: () => controller.start(),
        retry,
    };
}
