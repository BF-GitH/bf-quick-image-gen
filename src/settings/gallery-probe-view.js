// Test button: can this device read the NanoGPT gallery (spec 22.2)? Shows the outcome only, never the answer.

import { getSettings } from './store.js';
import { resolveApiKey } from './keys.js';
import { getProvider } from '../providers/index.js';

const TEXT = Object.freeze({
    button: 'Galerie-Abruf testen',
    intro: 'Prüft, ob diese App fertige Bilder nachträglich aus deiner NanoGPT-Galerie holen dürfte. Es wird nichts angezeigt oder gespeichert.',
    running: 'Wird geprüft …',
    unsupported: 'Diesen Test gibt es nur für NanoGPT.',
    blocked: (reason) => `Gesperrt: Diese App darf die Galerie nicht abrufen (${reason}). Nachträgliches Holen geht auf diesem Gerät nicht.`,
    refused: (detail) => `NanoGPT lehnt die Galerie-Abfrage ab (${detail}).`,
    downloadNone: 'Galerie erreichbar, aber leer: Ob Bilder geladen werden dürfen, ließ sich nicht prüfen.',
    downloadBlocked: (reason) => `Galerie erreichbar, aber der Bild-Download ist gesperrt (${reason}).`,
    downloadRefused: (detail) => `Galerie erreichbar, aber der Bild-Download wird abgelehnt (${detail}).`,
    downloadOk: 'Möglich: Galerie und Bild-Download sind von diesem Gerät aus erreichbar.',
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

function outcomeText(outcome) {
    if (outcome.list === 'blocked') return TEXT.blocked(outcome.reason);
    if (outcome.list === 'refused') return TEXT.refused(outcome.status ?? outcome.reason);
    if (outcome.download === 'none') return TEXT.downloadNone;
    if (outcome.download === 'blocked') return TEXT.downloadBlocked(outcome.downloadReason);
    if (outcome.download === 'refused') return TEXT.downloadRefused(outcome.downloadStatus ?? outcome.downloadReason);
    return TEXT.downloadOk;
}

export function createGalleryProbeView() {
    const element = el('div', { className: 'bfqig-gallery-probe' });
    const button = el('button', { id: 'bfqig-gallery-probe', type: 'button', className: 'menu_button', textContent: TEXT.button });
    const note = el('div', { id: 'bfqig-gallery-probe-note', className: 'bfqig-note', textContent: TEXT.intro });
    note.setAttribute('aria-live', 'polite');
    element.append(button, note);

    async function run() {
        button.disabled = true;
        note.textContent = TEXT.running;
        try {
            const provider = getProvider(getSettings().provider);
            if (typeof provider.probeGallery !== 'function') {
                note.textContent = TEXT.unsupported;
                return;
            }
            const apiKey = await resolveApiKey(provider);
            note.textContent = outcomeText(await provider.probeGallery({ apiKey }));
        } catch (error) {
            note.textContent = error?.message || String(error);
        } finally {
            button.disabled = false;
        }
    }

    button.addEventListener('click', () => {
        if (!button.disabled) run();
    });
    return { element };
}
