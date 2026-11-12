// Gallery list operations. Pure and immutable: the store persists whatever these return.

export const GALLERY_LIMIT = 200;
const PROMPT_LIMIT = 400;

function asList(list) {
    return Array.isArray(list) ? list : [];
}

export function addRecord(list, record) {
    const entry = { ...record, prompt: String(record?.prompt ?? '').slice(0, PROMPT_LIMIT) };
    // A replaced record moves to the front: re-adding the same url means it is the newest again.
    const others = asList(list).filter((item) => item?.url !== entry.url);
    return [entry, ...others].slice(0, GALLERY_LIMIT);
}

export function removeRecord(list, url) {
    return asList(list).filter((item) => item?.url !== url);
}
