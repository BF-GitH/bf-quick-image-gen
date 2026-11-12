// Gallery grid and full-screen viewer. All record text goes through textContent (prompts are untrusted).

import { LOG_PREFIX } from '../shared/constants.js';
import { extensionForMime } from '../providers/http.js';
import { notify, confirmDialog, timestampName, adoptToasts, releaseToasts } from '../host/st.js';
import { saveToDevice } from '../host/images.js';
import { listRecords, onGalleryChange } from './store.js';
import { deleteGeneratedImage } from './actions.js';

const TEXT = Object.freeze({
    empty: 'Noch keine Bilder.',
    save: 'Auf Gerät speichern',
    remove: 'Löschen',
    close: 'Schließen',
    confirmDelete: 'Bild endgültig löschen? Es fehlt dann auch in der Chat-Nachricht.',
    saveFailed: 'Speichern fehlgeschlagen: ',
    deleteFailed: 'Löschen fehlgeschlagen: ',
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

function fileExtension(url) {
    const match = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.exec(String(url));
    if (!match) return 'png';
    const ext = match[1].toLowerCase();
    return extensionForMime(`image/${ext === 'jpg' ? 'jpeg' : ext}`);
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('de-DE');
}

function iconButton(id, icon, label) {
    const button = el('button', { id, type: 'button', className: 'menu_button bfqig-viewer-button' });
    button.append(el('i', { className: `fa-solid ${icon}` }), el('span', { textContent: label }));
    return button;
}

let closeActiveViewer = null;

// onDelete lets a caller whose picture is not a gallery record (an uploaded reference) delete it its own way.
export function openImageViewer(record, { confirmText, onDelete } = {}) {
    closeActiveViewer?.();
    // A native modal dialog, because TauriTavern's Android back handler only closes 'dialog[open]' elements.
    const overlay = el('dialog', { id: 'bfqig-viewer', className: 'bfqig-viewer' });

    const panel = el('div', { className: 'bfqig-viewer-panel' });
    const image = el('img', { className: 'bfqig-viewer-image', src: record.url, alt: String(record.prompt ?? '') });
    const prompt = el('p', { className: 'bfqig-viewer-prompt', textContent: String(record.prompt ?? '') });
    const meta = [record.model, record.character, formatDate(record.timestamp)].filter(Boolean).join(' · ');
    const details = el('p', { className: 'bfqig-note', textContent: meta });
    const actions = el('div', { className: 'bfqig-viewer-actions' });
    const save = iconButton('bfqig-viewer-save', 'fa-download', TEXT.save);
    const remove = iconButton('bfqig-viewer-delete', 'fa-trash-can', TEXT.remove);
    const close = iconButton('bfqig-viewer-close', 'fa-xmark', TEXT.close);
    actions.append(save, remove, close);
    panel.append(image, prompt, details, actions);
    overlay.append(panel);

    let cleaned = false;
    function cleanup() {
        if (cleaned) return;
        cleaned = true;
        if (closeActiveViewer === closeViewer) closeActiveViewer = null;
        // Toasts live inside the open dialog (see adoptToasts); removing them with us would hide live ones.
        releaseToasts(overlay);
        overlay.remove();
    }
    // Escape and the host's back handler call close() themselves. The browser delivers that event only with
    // the next animation frame, so our own close paths clean up at once instead of waiting for it.
    overlay.addEventListener('close', cleanup);
    function closeViewer() {
        if (overlay.open) overlay.close();
        cleanup();
    }
    closeActiveViewer = closeViewer;

    // The host closes open drawers on html-level mousedown/touchstart outside them; the overlay lives in body,
    // so without this every tap in the viewer would collapse the Extensions drawer behind it.
    const stop = (event) => event.stopPropagation();
    overlay.addEventListener('mousedown', stop);
    overlay.addEventListener('touchstart', stop, { passive: true });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeViewer();
    });
    close.addEventListener('click', closeViewer);
    save.addEventListener('click', async () => {
        save.disabled = true;
        try {
            await saveToDevice(record.url, `tauri_${timestampName()}.${fileExtension(record.url)}`);
        } catch (error) {
            notify.error(TEXT.saveFailed + (error?.message || String(error)));
        } finally {
            save.disabled = false;
        }
    });
    remove.addEventListener('click', async () => {
        if (!(await confirmDialog(confirmText ?? TEXT.confirmDelete))) return;
        try {
            if (onDelete) await onDelete();
            else await deleteGeneratedImage(record.url);
            closeViewer();
        } catch (error) {
            notify.error(TEXT.deleteFailed + (error?.message || String(error)));
        }
    });

    document.body.append(overlay);
    try {
        overlay.showModal();
    } catch (error) {
        console.warn(LOG_PREFIX, 'showModal failed, opening non-modal', error);
        overlay.show();
    }
    adoptToasts(overlay);
    close.focus();
}

export function createGalleryView() {
    const element = el('div', { className: 'bfqig-gallery' });
    const empty = el('p', { id: 'bfqig-gallery-empty', className: 'bfqig-note', textContent: TEXT.empty });
    const grid = el('div', { id: 'bfqig-gallery-grid', className: 'bfqig-gallery-grid' });
    element.append(empty, grid);

    function refresh() {
        const records = listRecords();
        empty.hidden = records.length > 0;
        grid.replaceChildren(...records.map((record) => {
            const item = el('button', { type: 'button', className: 'bfqig-gallery-item' });
            item.title = [record.model, formatDate(record.timestamp)].filter(Boolean).join(' · ');
            // loading must be set before src, otherwise the browser starts fetching eagerly.
            item.append(el('img', { loading: 'lazy', decoding: 'async', alt: String(record.prompt ?? ''), src: record.url }));
            item.addEventListener('click', () => openImageViewer(record));
            return item;
        }));
    }

    onGalleryChange(refresh);
    refresh();
    return { element, refresh };
}
