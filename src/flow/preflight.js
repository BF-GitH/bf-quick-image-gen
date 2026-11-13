// Checks that refuse "Senden + Bild" before any work starts; shared by both controllers.

import { MESSAGES } from './messages.js';

// A resend clicks the send button with an empty composer, so the host answers the user's last message again.
export function resendExitMessage(host) {
    // Not trimmed: the host would send whitespace as a message of its own.
    if (String(host.getComposerText() ?? '') !== '') return MESSAGES.resendComposer;
    const last = host.getRawMessage(host.getChatLength() - 1);
    if (!last?.is_user) return MESSAGES.resendNotLast;
    return null;
}

export function earlyExitMessage(host, isBusy, { resend = false } = {}) {
    if (isBusy) return MESSAGES.busy;
    if (!host.isChatOpen()) return MESSAGES.noChat;
    if (host.isGenerating()) return MESSAGES.generating;
    if (resend) return resendExitMessage(host);
    const text = String(host.getComposerText() ?? '').trim();
    if (!text) return MESSAGES.emptyText;
    if (text.startsWith('/')) return MESSAGES.slash;
    return null;
}
