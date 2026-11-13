// WIRING: attaches the pictures of a run that follow the first one, each as soon as it is finished, while the
// status bar counts them. The reply waits only for the first picture.

import { LOG_PREFIX } from '../shared/constants.js';
import { attachRemainingImages } from './generate-image.js';
import { onHostEvent } from '../host/st.js';

const CANCEL_LABEL = 'Rest abbrechen';
const MESSAGE_GONE = 'Die Nachricht ist nicht mehr vorhanden.';
const progressText = (done, total) => `Bilder: ${done} von ${total} fertig …`;
const partFailedWarning = (failed, total, reason) => `${failed} von ${total} Bildern fehlgeschlagen: ${reason}`;

export function createTail({ bar, notify }) {
    // { prepared, done, abort } while a tail runs, otherwise null.
    let active = null;

    function cancel() {
        active?.abort.abort();
    }

    function draw() {
        if (!active) return;
        bar.setStatus(progressText(active.done, active.prepared.total), { onCancel: cancel, cancelLabel: CANCEL_LABEL });
        bar.setPrompt(active.prepared.preview);
    }

    async function run(current, messageIndex, token) {
        const { prepared } = current;
        const offChatChanged = onHostEvent('CHAT_CHANGED', () => current.abort.abort());
        let outcome = null;
        try {
            outcome = await attachRemainingImages(messageIndex, prepared, {
                token,
                signal: current.abort.signal,
                onProgress: ({ done }) => {
                    current.done = done;
                    draw();
                },
            });
        } catch (error) {
            console.error(`${LOG_PREFIX} attaching the remaining pictures failed:`, error);
        } finally {
            offChatChanged();
            active = null;
            bar.setStatus(null);
        }
        if (!outcome) return;
        if (outcome.failed > 0) {
            const reason = outcome.firstError?.message || String(outcome.firstError);
            notify.warning(partFailedWarning(outcome.failed, prepared.total, reason));
        }
        if (outcome.gone) notify.warning(MESSAGE_GONE);
    }

    function start(messageIndex, prepared, token) {
        if (!prepared || prepared.total <= prepared.images.length) return;
        if (active) {
            console.warn(`${LOG_PREFIX} a tail is already running, the new one is ignored`);
            return;
        }
        const current = { prepared, done: prepared.images.length, abort: new AbortController() };
        active = current;
        draw();
        run(current, messageIndex, token);
    }

    return { start, isActive: () => active !== null, cancel, draw };
}
