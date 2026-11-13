// Referenzen tab: one block per group of people (spec 14.5), rows to edit names, the checkbox and the order of
// use, and to delete. Names come from the user and the chat model, so every dynamic text goes through
// textContent or value.

import { createUploadForm } from './upload-form.js';
import {
    listGroups,
    listNames,
    moveReference,
    onReferencesChange,
    removeUpload,
    setReferenceEnabled,
    setReferenceNames,
} from './store.js';
import { listRecords } from '../gallery/store.js';
import { deleteGeneratedImage } from '../gallery/actions.js';
import { openImageViewer } from '../gallery/view.js';
import { notify, confirmDialog } from '../host/st.js';

const TEXT = Object.freeze({
    hint: 'Referenzbilder zeigen dem Bildmodell, wie eine Figur aussieht. Bilder mit denselben Figuren bilden eine Gruppe. Die Reihenfolge in der Gruppe ist die Reihenfolge, in der sie verwendet werden: höchstens zwei Bilder pro Figur, nur angehakte. Jedes erzeugte Bild wird von selbst Referenz für die Figuren darauf.',
    namesPlaceholder: 'Name der Figur, z. B. Kyouko',
    filter: 'Name suchen …',
    empty: 'Noch keine Referenzbilder.',
    enabled: 'Als Referenz verwenden',
    badge: 'erzeugt',
    up: 'Nach oben',
    down: 'Nach unten',
    remove: 'Löschen',
    confirmUpload: 'Referenzbild endgültig löschen?',
    confirmGenerated: 'Bild endgültig löschen? Es fehlt dann auch in der Chat-Nachricht.',
    deleteFailed: 'Löschen fehlgeschlagen: ',
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

function errorText(error) {
    return error?.message || String(error);
}

function iconButton(className, icon, title, onClick) {
    const button = el('button', { type: 'button', className: `menu_button bfqig-icon-button ${className}`, title });
    button.setAttribute('aria-label', title);
    button.append(el('i', { className: icon }));
    button.addEventListener('click', onClick);
    return button;
}

function createRow({ item, first, last, onOpen, onDelete }) {
    const { url, names } = item;
    const row = el('div', { className: 'bfqig-ref-item' });
    row.dataset.url = url;
    row.dataset.names = names.join(', ').toLowerCase();

    const thumb = el('button', { type: 'button', className: 'bfqig-ref-thumb' });
    // loading must be set before src, otherwise the browser starts fetching eagerly.
    thumb.append(el('img', { loading: 'lazy', decoding: 'async', alt: names.join(', '), src: url }));
    thumb.addEventListener('click', onOpen);

    const nameInput = el('input', {
        type: 'text',
        className: 'text_pole bfqig-ref-item-names',
        placeholder: TEXT.namesPlaceholder,
        value: names.join(', '),
        autocomplete: 'off',
    });
    nameInput.addEventListener('change', () => setReferenceNames(url, nameInput.value));

    const check = el('label', { className: 'checkbox_label bfqig-check', title: TEXT.enabled });
    const box = el('input', { type: 'checkbox', className: 'bfqig-ref-enabled', checked: item.enabled, title: TEXT.enabled });
    box.setAttribute('aria-label', TEXT.enabled);
    box.addEventListener('change', () => setReferenceEnabled(url, box.checked));
    check.append(box);

    const up = iconButton('bfqig-ref-up', 'fa-solid fa-arrow-up', TEXT.up, () => moveReference(url, -1));
    up.disabled = first;
    const down = iconButton('bfqig-ref-down', 'fa-solid fa-arrow-down', TEXT.down, () => moveReference(url, 1));
    down.disabled = last;

    const remove = iconButton('bfqig-ref-delete', 'fa-solid fa-trash-can', TEXT.remove, async () => {
        remove.disabled = true;
        try {
            await onDelete();
        } catch (error) {
            notify.error(TEXT.deleteFailed + errorText(error));
        } finally {
            remove.disabled = false;
        }
    });

    row.append(thumb, nameInput);
    if (item.source === 'generated') row.append(el('span', { className: 'bfqig-ref-badge', textContent: TEXT.badge }));
    row.append(check, up, down, remove);
    return row;
}

function rowFor(item, index, count, records) {
    const position = { item, first: index === 0, last: index === count - 1 };
    if (item.source === 'generated') {
        const record = records.get(item.url) ?? { url: item.url, prompt: item.names.join(', ') };
        return createRow({
            ...position,
            onOpen: () => openImageViewer(record),
            onDelete: async () => {
                if (await confirmDialog(TEXT.confirmGenerated)) await deleteGeneratedImage(item.url);
            },
        });
    }
    return createRow({
        ...position,
        onOpen: () => openImageViewer(
            { url: item.url, prompt: item.names.join(', ') },
            { confirmText: TEXT.confirmUpload, onDelete: () => removeUpload(item.url) },
        ),
        onDelete: async () => {
            if (await confirmDialog(TEXT.confirmUpload)) await removeUpload(item.url);
        },
    });
}

function createGroup(group, records) {
    const section = el('section', { className: 'bfqig-ref-group' });
    section.dataset.key = group.key;
    const title = el('div', {
        className: 'bfqig-label bfqig-ref-group-title',
        textContent: `${group.names.join(' + ')} (${group.items.length})`,
    });
    const rows = group.items.map((item, index) => rowFor(item, index, group.items.length, records));
    section.append(title, ...rows);
    return section;
}

export function createReferencesView() {
    const element = el('div', { className: 'bfqig-references' });
    const hint = el('div', { className: 'bfqig-note', textContent: TEXT.hint });
    const form = createUploadForm();
    const filter = el('input', {
        id: 'bfqig-ref-filter',
        type: 'search',
        className: 'text_pole',
        placeholder: TEXT.filter,
        autocomplete: 'off',
    });
    const empty = el('p', { id: 'bfqig-ref-empty', className: 'bfqig-note', textContent: TEXT.empty });
    const list = el('div', { id: 'bfqig-ref-list', className: 'bfqig-ref-list' });
    element.append(hint, form.element, filter, empty, list);

    function applyFilter() {
        const needle = filter.value.trim().toLowerCase();
        for (const section of list.querySelectorAll('.bfqig-ref-group')) {
            let visible = 0;
            for (const row of section.querySelectorAll('.bfqig-ref-item')) {
                row.hidden = Boolean(needle) && !row.dataset.names.includes(needle);
                if (!row.hidden) visible += 1;
            }
            // A heading over nothing but hidden rows would read like an empty group.
            section.hidden = visible === 0;
        }
    }

    function refresh() {
        const records = new Map(listRecords().filter((record) => typeof record?.url === 'string').map((record) => [record.url, record]));
        const groups = listGroups().map((group) => createGroup(group, records));
        list.replaceChildren(...groups);
        empty.hidden = groups.length > 0;
        form.setNames(listNames());
        applyFilter();
    }

    filter.addEventListener('input', applyFilter);
    onReferencesChange(refresh);
    refresh();
    return { element, refresh };
}
