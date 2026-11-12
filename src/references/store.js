// Uploaded reference pictures live in the settings (one list for all chats); generated pictures stay gallery
// records and only get names and a checkbox there.

import { LOG_PREFIX } from '../shared/constants.js';
import { normalizeNames, toCandidates, REFERENCE_LIMIT } from './select.js';
import { getSettings, updateSettings } from '../settings/store.js';
import { listRecords, updateGalleryRecord, onGalleryChange } from '../gallery/store.js';
import { timestampName } from '../host/st.js';
import { uploadImage, deleteImage, toJpegDataUrl } from '../host/images.js';

export const REFERENCE_FOLDER = 'bfqig-references';

const TEXT = Object.freeze({
    noName: 'Bitte zuerst einen Namen eintragen.',
    noFile: 'Bitte zuerst ein Bild auswählen.',
    full: 'Es sind höchstens 100 Referenzbilder möglich.',
});

const listeners = new Set();

function emit() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (error) {
            console.error(LOG_PREFIX, 'References listener failed', error);
        }
    }
}

function uploads() {
    const list = getSettings().references;
    return Array.isArray(list) ? list : [];
}

function isUpload(url) {
    return uploads().some((entry) => entry.url === url);
}

function patchUpload(url, patch) {
    updateSettings({ references: uploads().map((entry) => (entry.url === url ? { ...entry, ...patch } : entry)) });
    emit();
}

export function listUploads() {
    return [...uploads()];
}

export function listCandidates() {
    return toCandidates({ uploads: uploads(), gallery: listRecords() });
}

export async function addUpload(file, names) {
    const normalized = normalizeNames(names);
    if (normalized.length === 0) throw new Error(TEXT.noName);
    if (!file) throw new Error(TEXT.noFile);
    if (uploads().length >= REFERENCE_LIMIT) throw new Error(TEXT.full);
    const dataUrl = await toJpegDataUrl(file);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const url = await uploadImage({ base64, extension: 'jpg', folder: REFERENCE_FOLDER, fileName: `ref_${timestampName()}` });
    const record = { url, names: normalized, enabled: true, timestamp: Date.now() };
    // Appended at the end: the selection prefers earlier uploads, so a person's first picture stays first.
    updateSettings({ references: [...uploads(), record] });
    emit();
    return record;
}

export function setReferenceNames(url, names) {
    const normalized = normalizeNames(names);
    if (isUpload(url)) patchUpload(url, { names: normalized });
    else updateGalleryRecord(url, { names: normalized });
}

export function setReferenceEnabled(url, enabled) {
    if (isUpload(url)) patchUpload(url, { enabled: Boolean(enabled) });
    else updateGalleryRecord(url, { enabled: Boolean(enabled) });
}

export async function removeUpload(url) {
    // A false result usually means the file is already gone; the record must go either way.
    const deleted = await deleteImage(url);
    if (!deleted) console.warn(LOG_PREFIX, 'Reference file could not be deleted', url);
    updateSettings({ references: uploads().filter((entry) => entry.url !== url) });
    emit();
}

export function onReferencesChange(listener) {
    listeners.add(listener);
    const offGallery = onGalleryChange(listener);
    return () => {
        listeners.delete(listener);
        offGallery();
    };
}
