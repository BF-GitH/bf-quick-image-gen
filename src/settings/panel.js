// Settings drawer in the host's extension panel. Static markup only; dynamic text goes through textContent.

import { LOG_PREFIX, PROVIDER_IDS, ASPECT_IDS, QUALITY_IDS } from '../shared/constants.js';
import { getProvider } from '../providers/index.js';
import { DEFAULT_DESCRIPTION, DEFAULT_INSTRUCTION, DESCRIPTION_WORDS } from '../prompt/scene.js';
import { notify, onHostEvent } from '../host/st.js';
import { getSettings, updateSettings } from './store.js';
import { describeKeyState } from './keys.js';
import { createModelPicker } from './model-picker.js';
import { createBatchView } from './batch-view.js';
import { createTextModelView } from './text-model-view.js';
import { getModelInfo } from './model-cache.js';
import { createGalleryView, openImageViewer } from '../gallery/view.js';
import { listRecords } from '../gallery/store.js';
import { listCandidates, onReferencesChange } from '../references/store.js';
import { createReferencesView } from '../references/view.js';

const KEY_DEBOUNCE_MS = 500;
const KEY_CHECKING_TEXT = 'Key wird geprüft …';
const KEY_EVENTS = Object.freeze(['SECRET_WRITTEN', 'SECRET_DELETED', 'SECRET_ROTATED', 'SECRET_EDITED']);

const ASPECT_LABELS = Object.freeze({
    '1:1': 'Quadrat 1:1', '2:3': 'Hochformat 2:3', '3:4': 'Hochformat 3:4', '9:16': 'Hochformat 9:16',
    '3:2': 'Querformat 3:2', '4:3': 'Querformat 4:3', '16:9': 'Querformat 16:9',
});
const QUALITY_LABELS = Object.freeze({ standard: 'Standard (1K)', high: 'Hoch (2K, teurer)' });

const MARKUP = `
<div class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>BF Quick Image Gen</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
   <div class="bfqig-body">
    <div class="bfqig-tabs" role="tablist">
      <button type="button" id="bfqig-tab-settings" class="menu_button bfqig-tab" role="tab" aria-controls="bfqig-pane-settings">Einstellungen</button>
      <button type="button" id="bfqig-tab-references" class="menu_button bfqig-tab" role="tab" aria-controls="bfqig-pane-references">Referenzen</button>
      <button type="button" id="bfqig-tab-gallery" class="menu_button bfqig-tab" role="tab" aria-controls="bfqig-pane-gallery">Galerie</button>
    </div>
    <div id="bfqig-pane-settings" class="bfqig-pane" role="tabpanel">
      <label class="bfqig-label" for="bfqig-provider">Anbieter</label>
      <select id="bfqig-provider" class="text_pole"></select>
      <label class="bfqig-label" for="bfqig-key">API-Key</label>
      <div class="bfqig-row">
        <input id="bfqig-key" type="password" class="text_pole" autocomplete="off" spellcheck="false" placeholder="leer = gespeicherten Key der App verwenden">
        <button type="button" id="bfqig-key-refresh" class="menu_button bfqig-icon-button" title="Key-Status neu prüfen" aria-label="Key-Status neu prüfen"><i class="fa-solid fa-rotate"></i></button>
      </div>
      <div id="bfqig-key-status" class="bfqig-note" aria-live="polite"></div>
      <label class="bfqig-label" for="bfqig-model">Modell</label>
      <div class="bfqig-model-slot"></div>
      <div id="bfqig-model-ref-note" class="bfqig-note"></div>
      <div class="bfqig-batch-slot"></div>
      <label class="bfqig-label" for="bfqig-instruction">Prompt</label>
      <textarea id="bfqig-instruction" class="text_pole" rows="6"></textarea>
      <div class="flex-container">
        <button type="button" id="bfqig-instruction-reset" class="menu_button">Standard</button>
      </div>
      <div class="bfqig-note">Das ist die Aufgabe an das Textmodell: was das Bild zeigen soll.</div>
      <label class="bfqig-label" for="bfqig-description">Bildbeschreibung</label>
      <textarea id="bfqig-description" class="text_pole" rows="4"></textarea>
      <div class="flex-container">
        <button type="button" id="bfqig-description-reset" class="menu_button">Standard</button>
      </div>
      <div class="bfqig-note">Was das Textmodell beschreibt, in dieser Reihenfolge (auf Englisch). Immer fest dabei: wer im Bild ist, die Zahl der Personen vorne und die Zuordnung der Referenzbilder.</div>
      <label class="bfqig-label" for="bfqig-description-words">Wörter höchstens</label>
      <input id="bfqig-description-words" type="number" min="20" max="200" step="5" inputmode="numeric" class="text_pole">
      <div class="bfqig-note">Anime-Modelle (SDXL) lesen nur etwa 50 Wörter. Modelle mit Referenzbildern vertragen 80 bis 120.</div>
      <label class="checkbox_label bfqig-check" for="bfqig-parallel">
        <input id="bfqig-parallel" type="checkbox">
        <span>Text sofort zeigen, Bild parallel erzeugen</span>
      </label>
      <div class="bfqig-note">Aus: Die Antwort erscheint erst zusammen mit dem Bild. An: Die Antwort wird normal gestreamt; das Bild entsteht gleichzeitig aus dem Stand bis zu deiner Nachricht und wird darunter eingefügt.</div>
      <details id="bfqig-advanced" class="bfqig-advanced">
        <summary>Erweitert</summary>
        <label class="bfqig-label" for="bfqig-aspect">Seitenverhältnis</label>
        <select id="bfqig-aspect" class="text_pole"></select>
        <label class="bfqig-label" for="bfqig-quality">Qualität</label>
        <select id="bfqig-quality" class="text_pole"></select>
        <label class="bfqig-label" for="bfqig-context">Kontext-Nachrichten</label>
        <input id="bfqig-context" type="number" min="1" max="20" step="1" inputmode="numeric" class="text_pole">
        <div class="bfqig-note">Zusätzlich zur ersten Nachricht des Chats, die immer dabei ist.</div>
        <label class="bfqig-label" for="bfqig-style">Stil-Zusatz</label>
        <input id="bfqig-style" type="text" class="text_pole" placeholder="z. B. anime style, soft lighting">
        <label class="checkbox_label bfqig-check" for="bfqig-use-llm">
          <input id="bfqig-use-llm" type="checkbox">
          <span>Bildprompt von einem Textmodell schreiben lassen (empfohlen)</span>
        </label>
        <div class="bfqig-text-model-slot"></div>
      </details>
      <button type="button" id="bfqig-test" class="menu_button bfqig-wide">Testbild generieren</button>
    </div>
    <div id="bfqig-pane-references" class="bfqig-pane" role="tabpanel" hidden></div>
    <div id="bfqig-pane-gallery" class="bfqig-pane" role="tabpanel" hidden>
      <label class="checkbox_label bfqig-check" for="bfqig-auto-save">
        <input id="bfqig-auto-save" type="checkbox">
        <span>Nach jedem Bild den Speichern-Dialog öffnen</span>
      </label>
      <div class="bfqig-note">Bilder liegen im Datenordner der App (user/images). Android lässt Erweiterungen nicht still in den Download-Ordner schreiben: „Auf Gerät speichern“ öffnet den System-Dialog, dort z. B. Download/tauri wählen.</div>
      <div class="bfqig-gallery-slot"></div>
    </div>
   </div>
  </div>
</div>`;

function fillSelect(select, entries) {
    select.replaceChildren(...entries.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
}

function providerLabel(id) {
    try {
        return getProvider(id).label;
    } catch {
        return id;
    }
}

function wireTabs(root, onShow) {
    const tabs = ['settings', 'references', 'gallery'].map((name) => [name, root.querySelector(`#bfqig-tab-${name}`)]);
    const show = (name) => {
        for (const [tabName, tab] of tabs) {
            const active = tabName === name;
            tab.setAttribute('aria-selected', String(active));
            tab.classList.toggle('bfqig-tab-active', active);
            root.querySelector(`#bfqig-pane-${tabName}`).hidden = !active;
        }
        onShow[name]?.();
    };
    for (const [name, tab] of tabs) tab.addEventListener('click', () => show(name));
    show('settings');
}

function createKeyStatus(root) {
    const status = root.querySelector('#bfqig-key-status');
    const button = root.querySelector('#bfqig-key-refresh');
    let sequence = 0;
    let timer = null;
    const show = (text, state) => {
        status.textContent = text;
        status.dataset.state = state;
    };
    async function refresh() {
        clearTimeout(timer);
        const token = ++sequence;
        show(KEY_CHECKING_TEXT, 'checking');
        button.disabled = true;
        try {
            const { state, message } = await describeKeyState(getProvider(getSettings().provider));
            if (token !== sequence) return;
            show(message, state);
        } catch (error) {
            if (token !== sequence) return;
            show(error?.message || String(error), 'missing');
        }
        // Superseded runs returned above: text and button belong to the newest run.
        button.disabled = false;
    }
    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, KEY_DEBOUNCE_MS);
    };
    button.addEventListener('click', () => refresh());
    // A key saved, removed or switched in the app's API connections changes what describeKeyState finds.
    for (const eventKey of KEY_EVENTS) onHostEvent(eventKey, () => refresh());
    return { refresh, later };
}

// Tells the owner up front when the chosen model would silently ignore the checked reference pictures.
function createReferenceNote(root) {
    const note = root.querySelector('#bfqig-model-ref-note');
    let sequence = 0;
    async function refresh() {
        const token = ++sequence;
        if (!listCandidates().some((candidate) => candidate.enabled)) {
            note.textContent = '';
            return;
        }
        const settings = getSettings();
        try {
            const provider = getProvider(settings.provider);
            const modelId = settings.models[provider.id] || provider.defaultModel;
            const limit = provider.maxReferenceImages(await getModelInfo(provider.id, modelId));
            if (token !== sequence) return;
            note.textContent = limit > 1
                ? `Dieses Modell nimmt bis zu ${limit} Referenzbilder.`
                : limit === 1 ? 'Dieses Modell nimmt 1 Referenzbild.' : 'Dieses Modell nimmt keine Referenzbilder.';
        } catch (error) {
            if (token !== sequence) return;
            console.warn(LOG_PREFIX, 'Reference note failed', error);
            note.textContent = '';
        }
    }
    onReferencesChange(() => refresh());
    return { refresh };
}

export async function mountSettingsPanel({ onTestImage } = {}) {
    if (document.getElementById('bfqig-settings')) return;
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) {
        console.warn(LOG_PREFIX, 'Extension settings container not found, panel not mounted');
        return;
    }
    const settings = getSettings();
    const root = document.createElement('div');
    root.id = 'bfqig-settings';
    root.className = 'bfqig-settings';
    root.innerHTML = MARKUP;
    const byId = (id) => root.querySelector(`#${id}`);

    const refNote = createReferenceNote(root);
    const batch = createBatchView();
    const picker = createModelPicker({
        onChange: () => {
            refNote.refresh();
            batch.refresh();
        },
    });
    root.querySelector('.bfqig-model-slot').append(picker.element);
    root.querySelector('.bfqig-batch-slot').append(batch.element);
    const textModel = createTextModelView();
    root.querySelector('.bfqig-text-model-slot').append(textModel.element);
    const gallery = createGalleryView();
    root.querySelector('.bfqig-gallery-slot').append(gallery.element);
    const references = createReferencesView();
    byId('bfqig-pane-references').append(references.element);
    wireTabs(root, { gallery: () => gallery.refresh(), references: () => references.refresh() });
    const keyStatus = createKeyStatus(root);
    // The limit comes from the model list, so the note can only be right once that list has loaded.
    const loadModels = (providerId) => picker.refresh(providerId).then(() => {
        refNote.refresh();
        batch.refresh();
    });

    const provider = byId('bfqig-provider');
    const key = byId('bfqig-key');
    const instruction = byId('bfqig-instruction');
    const description = byId('bfqig-description');
    const descriptionWords = byId('bfqig-description-words');
    const aspect = byId('bfqig-aspect');
    const quality = byId('bfqig-quality');
    const context = byId('bfqig-context');
    const style = byId('bfqig-style');
    const useLlm = byId('bfqig-use-llm');
    const parallel = byId('bfqig-parallel');
    const autoSave = byId('bfqig-auto-save');
    const testButton = byId('bfqig-test');

    fillSelect(provider, PROVIDER_IDS.map((id) => [id, providerLabel(id)]));
    fillSelect(aspect, ASPECT_IDS.map((id) => [id, ASPECT_LABELS[id] ?? id]));
    fillSelect(quality, QUALITY_IDS.map((id) => [id, QUALITY_LABELS[id] ?? id]));
    provider.value = settings.provider;
    key.value = settings.keys[settings.provider] ?? '';
    instruction.value = settings.instruction;
    description.value = settings.description;
    descriptionWords.value = String(settings.descriptionWords);
    aspect.value = settings.aspect;
    quality.value = settings.quality;
    context.value = String(settings.contextMessages);
    style.value = settings.styleSuffix;
    useLlm.checked = settings.useLlm;
    parallel.checked = settings.parallelImage;
    autoSave.checked = settings.autoSaveDialog;

    provider.addEventListener('change', () => {
        updateSettings({ provider: provider.value });
        key.value = getSettings().keys[provider.value] ?? '';
        keyStatus.refresh();
        refNote.refresh();
        batch.refresh();
        textModel.refresh();
        loadModels(provider.value);
    });
    key.addEventListener('input', () => {
        const current = getSettings();
        updateSettings({ keys: { ...current.keys, [current.provider]: key.value } });
        keyStatus.later();
    });
    instruction.addEventListener('input', () => updateSettings({ instruction: instruction.value }));
    byId('bfqig-instruction-reset').addEventListener('click', () => {
        instruction.value = DEFAULT_INSTRUCTION;
        updateSettings({ instruction: DEFAULT_INSTRUCTION });
    });
    description.addEventListener('input', () => updateSettings({ description: description.value }));
    byId('bfqig-description-reset').addEventListener('click', () => {
        description.value = DEFAULT_DESCRIPTION;
        updateSettings({ description: DEFAULT_DESCRIPTION });
    });
    descriptionWords.addEventListener('change', () => {
        const parsed = Math.round(Number(descriptionWords.value));
        const value = Number.isFinite(parsed)
            ? Math.min(DESCRIPTION_WORDS.max, Math.max(DESCRIPTION_WORDS.min, parsed))
            : getSettings().descriptionWords;
        descriptionWords.value = String(value);
        updateSettings({ descriptionWords: value });
    });
    aspect.addEventListener('change', () => {
        updateSettings({ aspect: aspect.value });
        picker.update();
    });
    quality.addEventListener('change', () => {
        updateSettings({ quality: quality.value });
        picker.update();
    });
    context.addEventListener('change', () => {
        const parsed = Math.round(Number(context.value));
        const value = Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : getSettings().contextMessages;
        context.value = String(value);
        updateSettings({ contextMessages: value });
    });
    style.addEventListener('input', () => updateSettings({ styleSuffix: style.value }));
    useLlm.addEventListener('change', () => updateSettings({ useLlm: useLlm.checked }));
    parallel.addEventListener('change', () => updateSettings({ parallelImage: parallel.checked }));
    autoSave.addEventListener('change', () => updateSettings({ autoSaveDialog: autoSave.checked }));

    testButton.addEventListener('click', async () => {
        if (testButton.disabled) return;
        testButton.disabled = true;
        testButton.setAttribute('aria-busy', 'true');
        try {
            const result = await onTestImage();
            const record = listRecords().find((entry) => entry.url === result.url) ?? result;
            openImageViewer(record);
        } catch (error) {
            notify.error(error?.message || String(error));
        } finally {
            testButton.disabled = false;
            testButton.removeAttribute('aria-busy');
        }
    });

    host.append(root);
    keyStatus.refresh();
    textModel.refresh();
    loadModels(settings.provider);
}
