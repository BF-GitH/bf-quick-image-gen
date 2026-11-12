// Checks that refuse "Senden + Bild" before any work starts; shared by both controllers.

import { MESSAGES } from './messages.js';

export function earlyExitMessage(host, isBusy) {
    if (isBusy) return MESSAGES.busy;
    if (!host.isChatOpen()) return MESSAGES.noChat;
    if (host.isGenerating()) return MESSAGES.generating;
    const text = String(host.getComposerText() ?? '').trim();
    if (!text) return MESSAGES.emptyText;
    if (text.startsWith('/')) return MESSAGES.slash;
    return null;
}
