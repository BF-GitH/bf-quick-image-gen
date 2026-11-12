// Model dropdown with filter, favourites and price info. Writes the choice straight into the settings.

import { getSettings, updateSettings } from './store.js';
import { toggleFavorite } from './defaults.js';
import { getModels } from './model-cache.js';

const TEXT = Object.freeze({
    filter: 'Modell suchen …',
    favorites: '★ Favoriten',
    all: 'Alle Modelle',
    missing: ' (nicht in der Liste)',
    loading: 'Modelle werden geladen …',
    favAdd: 'Als Favorit markieren',
    favRemove: 'Favorit entfernen',
    reload: 'Modellliste neu laden',
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

function makeOption(value, label) {
    return el('option', { value, textContent: label });
}

function makeGroup(label, models) {
    const group = el('optgroup', { label });
    for (const model of models) group.append(makeOption(model.id, model.name || model.id));
    return group;
}

function formatPrice(price) {
    return `ca. ${price.toLocaleString('de-DE', { maximumFractionDigits: 6 })} $ pro Bild`;
}

export function createModelPicker({ onChange } = {}) {
    const element = el('div', { className: 'bfqig-model-picker' });
    const filter = el('input', { id: 'bfqig-model-filter', type: 'search', className: 'text_pole', placeholder: TEXT.filter, autocomplete: 'off' });
    const row = el('div', { className: 'bfqig-row' });
    const select = el('select', { id: 'bfqig-model', className: 'text_pole' });
    const fav = el('button', { id: 'bfqig-model-fav', type: 'button', className: 'menu_button bfqig-icon-button' });
    const favIcon = el('i', { className: 'fa-regular fa-star' });
    const reload = el('button', { id: 'bfqig-model-refresh', type: 'button', className: 'menu_button bfqig-icon-button', title: TEXT.reload });
    const info = el('div', { id: 'bfqig-model-info', className: 'bfqig-note' });
    fav.append(favIcon);
    reload.append(el('i', { className: 'fa-solid fa-rotate' }));
    reload.setAttribute('aria-label', TEXT.reload);
    row.append(select, fav, reload);
    element.append(filter, row, info);

    let providerId = getSettings().provider;
    let models = [];
    let loading = false;
    let errorText = '';
    let sequence = 0;

    const selectedId = () => getSettings().models[providerId] || '';
    const favoriteIds = () => getSettings().favorites[providerId] ?? [];

    function renderOptions() {
        const selected = selectedId();
        const needle = filter.value.trim().toLowerCase();
        // The stored model always stays in the list, otherwise the select would silently show another one.
        const matches = (model) => model.id === selected || !needle
            || model.id.toLowerCase().includes(needle) || String(model.name ?? '').toLowerCase().includes(needle);
        const byId = new Map(models.map((model) => [model.id, model]));
        select.replaceChildren();
        if (selected && !byId.has(selected)) {
            select.append(makeOption(selected, loading ? selected : selected + TEXT.missing));
        }
        const favorites = favoriteIds().map((id) => byId.get(id)).filter(Boolean).filter(matches);
        if (favorites.length) select.append(makeGroup(TEXT.favorites, favorites));
        const all = models.filter(matches);
        if (all.length) select.append(makeGroup(TEXT.all, all));
        select.value = selected;
        select.disabled = loading;
        return byId.get(selected);
    }

    function renderFavorite() {
        const isFavorite = favoriteIds().includes(selectedId());
        favIcon.className = isFavorite ? 'fa-solid fa-star' : 'fa-regular fa-star';
        fav.title = isFavorite ? TEXT.favRemove : TEXT.favAdd;
        fav.setAttribute('aria-label', fav.title);
        fav.setAttribute('aria-pressed', String(isFavorite));
        fav.disabled = !selectedId();
    }

    function render() {
        const model = renderOptions();
        renderFavorite();
        const price = Number.isFinite(model?.pricePerImage) ? formatPrice(model.pricePerImage) : '';
        info.textContent = loading ? TEXT.loading : (errorText || price);
        info.dataset.state = errorText && !loading ? 'error' : '';
        reload.disabled = loading;
    }

    async function refresh(nextProviderId, { force = false } = {}) {
        const token = ++sequence;
        if (nextProviderId !== providerId) models = [];
        providerId = nextProviderId;
        loading = true;
        errorText = '';
        render();
        try {
            const list = await getModels(providerId, { force });
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
        const modelId = select.value;
        updateSettings({ models: { ...getSettings().models, [providerId]: modelId } });
        render();
        onChange?.(modelId);
    });
    fav.addEventListener('click', () => {
        const modelId = selectedId();
        if (!modelId) return;
        const favorites = getSettings().favorites;
        updateSettings({ favorites: { ...favorites, [providerId]: toggleFavorite(favorites[providerId] ?? [], modelId) } });
        render();
    });
    reload.addEventListener('click', () => refresh(providerId, { force: true }));

    render();
    return { element, refresh };
}
