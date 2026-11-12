// Gallery records live in the settings so they survive restarts; listeners keep open views in sync.

import { LOG_PREFIX } from '../shared/constants.js';
import { addRecord, removeRecord, updateRecord } from './records.js';
import { getSettings, updateSettings } from '../settings/store.js';

const listeners = new Set();

function emit() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (error) {
            console.error(LOG_PREFIX, 'Gallery listener failed', error);
        }
    }
}

export function listRecords() {
    return [...getSettings().gallery];
}

export function addGalleryRecord(record) {
    updateSettings({ gallery: addRecord(getSettings().gallery, record) });
    emit();
}

export function removeGalleryRecord(url) {
    updateSettings({ gallery: removeRecord(getSettings().gallery, url) });
    emit();
}

// Names and the reference checkbox of a generated picture are edited in the Referenzen tab.
export function updateGalleryRecord(url, patch) {
    updateSettings({ gallery: updateRecord(getSettings().gallery, url, patch) });
    emit();
}

export function onGalleryChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
