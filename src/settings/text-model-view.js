// Text model that writes the image prompt (spec 19.4). Writes the choice straight into the settings.

import { getSettings, updateSettings } from './store.js';
import { getTextModels } from './model-cache.js';
import { getProvider } from '../providers/index.js';

const TEXT = Object.freeze({
    label: 'Textmodell für den Bildprompt',
    filter: 'Textmodell suchen …',
    chatModel: 'Chat-Modell der App (Standard)',
    missing: ' (nicht in der Liste)',
    reload: 'Textmodelle neu laden',
    loading: 'Textmodelle werden geladen …',
    none: 'Der Bildprompt kommt vom Modell, mit dem du gerade chattest.',
    chosen: (providerLabel) => `Der Bildprompt kommt von ${providerLabel} mit diesem Modell und dem Key von oben. Dein Chat-Modell bleibt, wie es ist.`,
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

function makeOption(value, label) {
    return el('option', { value, textContent: label });
}

export function createTextModelView() {
    const element = el('div', { className: 'bfqig-text-model' });
    const label = el('label', { className: 'bfqig-label', htmlFor: 'bfqig-text-model', textContent: TEXT.label });
    const filter = el('input', { id: 'bfqig-text-model-filter', type: 'search', className: 'text_pole', placeholder: TEXT.filter, autocomplete: 'off' });
    const row = el('div', { className: 'bfqig-row' });
    const select = el('select', { id: 'bfqig-text-model', className: 'text_pole' });
    const reload = el('button', { id: 'bfqig-text-model-refresh', type: 'button', className: 'menu_button bfqig-icon-button', title: TEXT.reload });
    const note = el('div', { id: 'bfqig-text-model-note', className: 'bfqig-note' });
    reload.append(el('i', { className: 'fa-solid fa-rotate' }));
    reload.setAttribute('aria-label', TEXT.reload);
    row.append(select, reload);
    element.append(label, filter, row, note);

    let providerId = getSettings().provider;
    let models = [];
    let loading = false;
    let errorText = '';
    let sequence = 0;

    // Before textModels exists in the settings every provider counts as "no choice".
    const selectedId = () => getSettings().textModels?.[providerId] || '';

    function renderOptions() {
        const selected = selectedId();
        const needle = filter.value.trim().toLowerCase();
        // The stored model always stays in the list, otherwise the select would silently show another one.
        const matches = (model) => model.id === selected || !needle
            || model.id.toLowerCase().includes(needle) || String(model.name ?? '').toLowerCase().includes(needle);
        select.replaceChildren(makeOption('', TEXT.chatModel));
        if (selected && !models.some((model) => model.id === selected)) {
            select.append(makeOption(selected, loading ? selected : selected + TEXT.missing));
        }
        for (const model of models.filter(matches)) select.append(makeOption(model.id, model.name || model.id));
        select.value = selected;
        select.disabled = loading;
    }

    function noteText() {
        if (loading) return TEXT.loading;
        if (errorText) return errorText;
        return selectedId() ? TEXT.chosen(getProvider(providerId).label) : TEXT.none;
    }

    function render() {
        renderOptions();
        note.textContent = noteText();
        note.dataset.state = errorText && !loading ? 'error' : '';
        reload.disabled = loading;
    }

    async function load({ force = false } = {}) {
        const token = ++sequence;
        const nextProviderId = getSettings().provider;
        if (nextProviderId !== providerId) models = [];
        providerId = nextProviderId;
        loading = true;
        errorText = '';
        render();
        try {
            const list = await getTextModels(providerId, { force });
            if (token !== sequence) return;
            models = Array.isArray(list) ? list : [];
        } catch (error) {
            if (token !== sequence) return;
            errorText = error?.message || String(error);
        }
        loading = false;
        render();
    }

    filter.addEventListener('input', () => render());
    select.addEventListener('change', () => {
        updateSettings({ textModels: { ...getSettings().textModels, [providerId]: select.value } });
        render();
    });
    reload.addEventListener('click', () => load({ force: true }));

    render();
    return { element, refresh: () => load() };
}
