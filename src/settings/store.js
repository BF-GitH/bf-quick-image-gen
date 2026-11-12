// Live settings object inside the host's extensionSettings, so the host's own save persists it.

import { SETTINGS_KEY } from '../shared/constants.js';
import { normalizeSettings } from './defaults.js';
import { getExtensionSettingsRoot, saveSettings } from '../host/st.js';

let live = null;

export function getSettings() {
    const root = getExtensionSettingsRoot();
    // Re-normalize if the host replaced the stored object (e.g. settings were reloaded).
    if (live && root[SETTINGS_KEY] === live) return live;
    live = normalizeSettings(root[SETTINGS_KEY]);
    root[SETTINGS_KEY] = live;
    return live;
}

export function updateSettings(patch) {
    Object.assign(getSettings(), patch);
    saveSettings();
}
