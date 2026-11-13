// Upload form of the Referenzen tab: tick known names, type new ones, pick a file, upload (spec 14.5).
// Built once: a re-render of the list only refreshes the name options, so ticks, typed text and the chosen file
// survive a change elsewhere (a generated picture arriving while the owner fills the form).

import { LOG_PREFIX } from '../shared/constants.js';
import { normalizeNames } from './select.js';
import { addUpload } from './store.js';
import { notify } from '../host/st.js';

const TEXT = Object.freeze({
    pickNames: 'Figuren auswählen',
    newName: 'Neue Figur, z. B. Kyouko',
    pick: 'Bild auswählen',
    noFile: 'Kein Bild gewählt',
    upload: 'Bild hochladen',
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

function errorText(error) {
    return error?.message || String(error);
}

function createNamePicker() {
    const picker = el('details', { id: 'bfqig-ref-names-select' });
    const summary = el('summary', { id: 'bfqig-ref-names-summary', textContent: TEXT.pickNames });
    const options = el('div', { className: 'bfqig-ref-name-options' });
    picker.append(summary, options);

    const boxes = () => [...options.querySelectorAll('input.bfqig-ref-name-option')];
    const ticked = () => boxes().filter((box) => box.checked).map((box) => box.value);
    const showTicked = () => {
        const names = ticked();
        summary.textContent = names.length ? names.join(', ') : TEXT.pickNames;
    };

    function setNames(names) {
        const keep = new Set(ticked().map((name) => name.toLowerCase()));
        options.replaceChildren(...names.map((name) => {
            const label = el('label', { className: 'checkbox_label' });
            const box = el('input', { type: 'checkbox', className: 'bfqig-ref-name-option', value: name, checked: keep.has(name.toLowerCase()) });
            box.addEventListener('change', showTicked);
            label.append(box, el('span', { textContent: name }));
            return label;
        }));
        picker.hidden = names.length === 0;
        showTicked();
    }

    function clear() {
        for (const box of boxes()) box.checked = false;
        showTicked();
    }

    return { element: picker, ticked, setNames, clear };
}

export function createUploadForm() {
    const form = el('div', { className: 'bfqig-ref-upload-form' });
    const picker = createNamePicker();
    const names = el('input', {
        id: 'bfqig-ref-names',
        type: 'text',
        className: 'text_pole',
        placeholder: TEXT.newName,
        autocomplete: 'off',
    });
    // Both hosts hide file inputs with their own CSS, so a label is the visible way to open the picker.
    const file = el('input', { id: 'bfqig-ref-file', type: 'file', accept: 'image/*', hidden: true });
    const pick = el('label', { id: 'bfqig-ref-pick', className: 'menu_button bfqig-wide', htmlFor: 'bfqig-ref-file', textContent: TEXT.pick });
    const chosen = el('div', { id: 'bfqig-ref-file-name', className: 'bfqig-note', textContent: TEXT.noFile });
    const showChosen = () => {
        chosen.textContent = file.files?.[0]?.name ?? TEXT.noFile;
    };
    file.addEventListener('change', showChosen);
    const button = el('button', { id: 'bfqig-ref-upload', type: 'button', className: 'menu_button bfqig-wide', textContent: TEXT.upload });
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            // The text field may hold several new names; normalizeNames splits only a string at commas.
            await addUpload(file.files?.[0] ?? null, [...picker.ticked(), ...normalizeNames(names.value)]);
            picker.clear();
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
    form.append(picker.element, names, pick, file, chosen, button);
    return { element: form, setNames: picker.setNames };
}
