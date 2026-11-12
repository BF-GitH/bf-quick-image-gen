// Gallery list operations. Pure and immutable: the store persists whatever these return.
import { normalizeNames } from '../references/select.js';

export const GALLERY_LIMIT = 200;
const PROMPT_LIMIT = 400;

function asList(list) {
    return Array.isArray(list) ? list : [];
}

export function addRecord(list, record) {
    const entry = {
        ...record,
        prompt: String(record?.prompt ?? '').slice(0, PROMPT_LIMIT),
        names: normalizeNames(record?.names),
        enabled: typeof record?.enabled === 'boolean' ? record.enabled : true,
    };
    // A replaced record moves to the front: re-adding the same url means it is the newest again.
    const others = asList(list).filter((item) => item?.url !== entry.url);
    return [entry, ...others].slice(0, GALLERY_LIMIT);
}

// Only the reference fields are editable; everything else describes how the picture was made.
export function updateRecord(list, url, patch) {
    const changes = {};
    if (patch && patch.names !== undefined) changes.names = normalizeNames(patch.names);
    if (patch && patch.enabled !== undefined) changes.enabled = Boolean(patch.enabled);
    return asList(list).map((item) => (item?.url === url ? { ...item, ...changes } : item));
}

export function removeRecord(list, url) {
    return asList(list).filter((item) => item?.url !== url);
}
