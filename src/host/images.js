// Image files in the host's user data (user/images/<folder>/...) and the save-to-device hand-off.

import { LOG_PREFIX } from '../shared/constants.js';
import { postApi } from './st.js';

const REVOKE_DELAY_MS = 60_000;

export async function uploadImage({ base64, extension, folder, fileName }) {
    // The host appends ".<format>" itself; a dot in the name would end up as a second extension in TauriTavern.
    const filename = String(fileName ?? '').replace(/\./g, '_');
    const response = await postApi('/api/images/upload', {
        image: base64,
        format: extension,
        // The host keeps these in the folder name and returns the path unencoded, so a URL would be cut at them.
        ch_name: String(folder ?? '').replace(/[#%?&]/g, '_'),
        filename,
    });
    if (!response.ok) {
        throw new Error(`Bild konnte nicht gespeichert werden (HTTP ${response.status})`);
    }
    const data = await response.json().catch(() => null);
    if (typeof data?.path !== 'string' || !data.path) {
        throw new Error(`Bild konnte nicht gespeichert werden (HTTP ${response.status})`);
    }
    return data.path;
}

export async function deleteImage(path) {
    try {
        const response = await postApi('/api/images/delete', { path });
        return response.ok;
    } catch (error) {
        console.warn(LOG_PREFIX, 'deleteImage failed', error);
        return false;
    }
}

// Reference pictures go into the request body as data URLs; a downscaled JPEG keeps that body small.
export async function toJpegDataUrl(source, { maxSide = 1024, quality = 0.9 } = {}) {
    let blob = source;
    if (typeof source === 'string') {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Bild konnte nicht geladen werden (HTTP ${response.status})`);
        }
        blob = await response.blob();
    }
    const bitmap = await createImageBitmap(blob);
    try {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Bild konnte nicht umgewandelt werden.');
        // JPEG has no alpha channel: without a fill, transparent pixels of a PNG would turn black.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('Bild konnte nicht umgewandelt werden.');
        return dataUrl;
    } finally {
        bitmap.close();
    }
}

export async function saveToDevice(url, fileName) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Bild konnte nicht geladen werden (HTTP ${response.status})`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    // TauriTavern routes <a download> clicks on blob URLs to the system save dialog; browsers download directly.
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    try {
        anchor.click();
    } finally {
        anchor.remove();
        // The host reads the blob asynchronously after the click, so revoking at once would break the save.
        setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_DELAY_MS);
    }
}
