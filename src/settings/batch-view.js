// "Mehrere Bilder": models with counts for one run. Writes the list straight into the settings.

import { getSettings, updateSettings } from './store.js';
import { BATCH_LIMITS, addToBatch, batchTotal, normalizeBatch, removeFromBatch, setBatchCount } from './defaults.js';
import { getModels } from './model-cache.js';

const TEXT = Object.freeze({
    label: 'Mehrere Bilder',
    count: 'Anzahl',
    remove: 'Aus der Liste nehmen',
    add: 'Gewähltes Modell hinzufügen',
    empty: 'Leer = ein Bild mit dem oben gewählten Modell.',
    one: '1 Bild pro Durchgang. Es zählt nur diese Liste.',
    many: (n) => `${n} Bilder pro Durchgang. Es zählt nur diese Liste. Jedes Bild kostet einzeln.`,
});

function el(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
}

export function createBatchView() {
    const element = el('div', { className: 'bfqig-batch' });
    const label = el('label', { className: 'bfqig-label', textContent: TEXT.label });
    const list = el('div', { id: 'bfqig-batch-list' });
    const add = el('button', { id: 'bfqig-batch-add', type: 'button', className: 'menu_button', textContent: TEXT.add });
    const note = el('div', { id: 'bfqig-batch-note', className: 'bfqig-note' });
    element.append(label, list, add, note);

    let providerId = getSettings().provider;
    let names = new Map();
    let sequence = 0;

    const entries = () => normalizeBatch(getSettings().batch[providerId]);

    function write(next) {
        updateSettings({ batch: { ...getSettings().batch, [providerId]: next } });
        render();
    }

    function makeRow({ model, count }) {
        const row = el('div', { className: 'bfqig-batch-row' });
        row.dataset.model = model;
        const name = el('span', { className: 'bfqig-batch-name', textContent: names.get(model) || model });
        const input = el('input', {
            type: 'number', min: '1', max: String(BATCH_LIMITS.perModel), step: '1', inputMode: 'numeric',
            className: 'bfqig-batch-count text_pole', value: String(count),
        });
        input.setAttribute('aria-label', TEXT.count);
        input.addEventListener('change', () => write(setBatchCount(entries(), model, Number(input.value))));
        const remove = el('button', { type: 'button', className: 'bfqig-batch-remove menu_button bfqig-icon-button', title: TEXT.remove });
        remove.setAttribute('aria-label', TEXT.remove);
        remove.append(el('i', { className: 'fa-solid fa-xmark' }));
        remove.addEventListener('click', () => write(removeFromBatch(entries(), model)));
        row.append(name, input, remove);
        return row;
    }

    function render() {
        const current = entries();
        list.replaceChildren(...current.map(makeRow));
        const total = batchTotal(current);
        const chosen = getSettings().models[providerId] || '';
        const chosenCount = current.find((entry) => entry.model === chosen)?.count ?? 0;
        add.disabled = !chosen || total >= BATCH_LIMITS.total || chosenCount >= BATCH_LIMITS.perModel;
        note.textContent = total === 0 ? TEXT.empty : total === 1 ? TEXT.one : TEXT.many(total);
    }

    async function refresh() {
        const token = ++sequence;
        const next = getSettings().provider;
        if (next !== providerId) names = new Map();
        providerId = next;
        render();
        try {
            const models = await getModels(providerId);
            if (token !== sequence) return;
            names = new Map((Array.isArray(models) ? models : []).map((model) => [model.id, model.name || model.id]));
            render();
        } catch {
            // Without the list the rows keep showing the model ids.
        }
    }

    add.addEventListener('click', () => {
        const chosen = getSettings().models[providerId];
        if (chosen) write(addToBatch(entries(), chosen));
    });

    render();
    return { element, refresh };
}
