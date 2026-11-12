// Settings drawer in the host's extension panel. Static markup only; dynamic text goes through textContent.

import { LOG_PREFIX, PROVIDER_IDS, ASPECT_IDS, QUALITY_IDS } from '../shared/constants.js';
import { getProvider } from '../providers/index.js';
import { DEFAULT_INSTRUCTION } from '../prompt/scene.js';
import { notify, onHostEvent } from '../host/st.js';
import { getSettings, updateSettings } from './store.js';
import { describeKeyState } from './keys.js';
import { createModelPicker } from './model-picker.js';
import { createGalleryView, openImageViewer } from '../gallery/view.js';
import { listRecords } from '../gallery/store.js';

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
      <label class="bfqig-label" for="bfqig-instruction">Prompt</label>
      <textarea id="bfqig-instruction" class="text_pole" rows="6"></textarea>
      <div class="flex-container">
        <button type="button" id="bfqig-instruction-reset" class="menu_button">Standard</button>
      </div>
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
          <span>Bildprompt vom Chat-Modell schreiben lassen (empfohlen)</span>
        </label>
      </details>
      <button type="button" id="bfqig-test" class="menu_button bfqig-wide">Testbild generieren</button>
    </div>
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

function wireTabs(root, onGallery) {
    const tabs = [['settings', root.querySelector('#bfqig-tab-settings')], ['gallery', root.querySelector('#bfqig-tab-gallery')]];
    const show = (name) => {
        for (const [tabName, tab] of tabs) {
            const active = tabName === name;
            tab.setAttribute('aria-selected', String(active));
            tab.classList.toggle('bfqig-tab-active', active);
            root.querySelector(`#bfqig-pane-${tabName}`).hidden = !active;
        }
        if (name === 'gallery') onGallery();
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

    const picker = createModelPicker({});
    root.querySelector('.bfqig-model-slot').append(picker.element);
    const gallery = createGalleryView();
    root.querySelector('.bfqig-gallery-slot').append(gallery.element);
    wireTabs(root, () => gallery.refresh());
    const keyStatus = createKeyStatus(root);

    const provider = byId('bfqig-provider');
    const key = byId('bfqig-key');
    const instruction = byId('bfqig-instruction');
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
        picker.refresh(provider.value);
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
    picker.refresh(settings.provider);
}
