// Referenzen tab: upload pictures with names, edit names and the checkbox of every reference, delete them.
// Names come from the user and the chat model, so every dynamic text goes through textContent or value.

import { LOG_PREFIX } from '../shared/constants.js';
import { normalizeNames } from './select.js';
import {
    addUpload,
    listUploads,
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
    hint: 'Referenzbilder zeigen dem Bildmodell, wie eine Figur aussieht. Sind mehrere Figuren auf einem Bild, die Namen mit Komma trennen. Verwendet werden nur angehakte Bilder, höchstens zwei pro Figur. Jedes erzeugte Bild wird von selbst Referenz für die Figuren darauf.',
    namesPlaceholder: 'Name der Figur, z. B. Kyouko',
    pick: 'Bild auswählen',
    noFile: 'Kein Bild gewählt',
    upload: 'Bild hochladen',
    filter: 'Name suchen …',
    uploaded: 'Hochgeladen',
    generated: 'Erzeugt',
    empty: 'Noch keine Referenzbilder.',
    enabled: 'Als Referenz verwenden',
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

function createRow({ url, names, enabled, onOpen, onDelete }) {
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
    const box = el('input', { type: 'checkbox', className: 'bfqig-ref-enabled', checked: enabled, title: TEXT.enabled });
    box.setAttribute('aria-label', TEXT.enabled);
    box.addEventListener('change', () => setReferenceEnabled(url, box.checked));
    check.append(box);

    const remove = el('button', { type: 'button', className: 'menu_button bfqig-icon-button bfqig-ref-delete', title: TEXT.remove });
    remove.setAttribute('aria-label', TEXT.remove);
    remove.append(el('i', { className: 'fa-solid fa-trash-can' }));
    remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
            await onDelete();
        } catch (error) {
            notify.error(TEXT.deleteFailed + errorText(error));
        } finally {
            remove.disabled = false;
        }
    });

    row.append(thumb, nameInput, check, remove);
    return row;
}

function uploadRows() {
    return listUploads().map((entry) => {
        const names = normalizeNames(entry.names);
        return createRow({
            url: entry.url,
            names,
            enabled: entry.enabled !== false,
            onOpen: () => openImageViewer(
                { url: entry.url, prompt: names.join(', ') },
                { confirmText: TEXT.confirmUpload, onDelete: () => removeUpload(entry.url) },
            ),
            onDelete: async () => {
                if (await confirmDialog(TEXT.confirmUpload)) await removeUpload(entry.url);
            },
        });
    });
}

// Gallery records are kept newest first, which is the order this section shows.
function generatedRows() {
    return listRecords()
        .map((record) => ({ record, names: normalizeNames(record?.names) }))
        .filter(({ record, names }) => typeof record?.url === 'string' && record.url && names.length > 0)
        .map(({ record, names }) => createRow({
            url: record.url,
            names,
            enabled: record.enabled !== false,
            onOpen: () => openImageViewer(record),
            onDelete: async () => {
                if (await confirmDialog(TEXT.confirmGenerated)) await deleteGeneratedImage(record.url);
            },
        }));
}

function createSection(title, rows) {
    const section = el('div', { className: 'bfqig-ref-section' });
    section.append(el('div', { className: 'bfqig-label', textContent: title }), ...rows);
    return section;
}

function createUploadForm() {
    const form = el('div', { className: 'bfqig-ref-upload-form' });
    // Both hosts hide file inputs with their own CSS, so a label is the visible way to open the picker.
    const file = el('input', { id: 'bfqig-ref-file', type: 'file', accept: 'image/*', hidden: true });
    const pick = el('label', { id: 'bfqig-ref-pick', className: 'menu_button bfqig-wide', htmlFor: 'bfqig-ref-file', textContent: TEXT.pick });
    const chosen = el('div', { id: 'bfqig-ref-file-name', className: 'bfqig-note', textContent: TEXT.noFile });
    const showChosen = () => {
        chosen.textContent = file.files?.[0]?.name ?? TEXT.noFile;
    };
    file.addEventListener('change', showChosen);
    const names = el('input', {
        id: 'bfqig-ref-names',
        type: 'text',
        className: 'text_pole',
        placeholder: TEXT.namesPlaceholder,
        autocomplete: 'off',
    });
    const button = el('button', { id: 'bfqig-ref-upload', type: 'button', className: 'menu_button bfqig-wide', textContent: TEXT.upload });
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            await addUpload(file.files?.[0] ?? null, names.value);
            file.value = '';
            names.value = '';
            showChosen();
        } catch (error) {
            console.warn(LOG_PREFIX, 'Reference upload failed:', errorText(error));
            notify.error(errorText(error));
        } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    });
    form.append(names, pick, file, chosen, button);
    return form;
}

export function createReferencesView() {
    const element = el('div', { className: 'bfqig-references' });
    const hint = el('div', { className: 'bfqig-note', textContent: TEXT.hint });
    const filter = el('input', {
        id: 'bfqig-ref-filter',
        type: 'search',
        className: 'text_pole',
        placeholder: TEXT.filter,
        autocomplete: 'off',
    });
    const empty = el('p', { id: 'bfqig-ref-empty', className: 'bfqig-note', textContent: TEXT.empty });
    const list = el('div', { id: 'bfqig-ref-list', className: 'bfqig-ref-list' });
    element.append(hint, createUploadForm(), filter, empty, list);

    function applyFilter() {
        const needle = filter.value.trim().toLowerCase();
        for (const section of list.querySelectorAll('.bfqig-ref-section')) {
            let visible = 0;
            for (const row of section.querySelectorAll('.bfqig-ref-item')) {
                row.hidden = Boolean(needle) && !row.dataset.names.includes(needle);
                if (!row.hidden) visible += 1;
            }
            // A heading over nothing but hidden rows would read like an empty category.
            section.hidden = visible === 0;
        }
    }

    function refresh() {
        const uploaded = uploadRows();
        const generated = generatedRows();
        const sections = [];
        if (uploaded.length) sections.push(createSection(TEXT.uploaded, uploaded));
        if (generated.length) sections.push(createSection(TEXT.generated, generated));
        list.replaceChildren(...sections);
        empty.hidden = sections.length > 0;
        applyFilter();
    }

    filter.addEventListener('input', applyFilter);
    onReferencesChange(refresh);
    refresh();
    return { element, refresh };
}
