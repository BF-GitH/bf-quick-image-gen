// Reference pictures: who is on which picture, how they group, and which pictures go with a scene
// (spec 12.2, 14.2). PURE.

export const PER_NAME_LIMIT = 2;
export const NAME_LIMIT = 8;
export const REFERENCE_LIMIT = 100;

const NAME_CHARS = 60;

function toText(value) {
    return typeof value === 'string' ? value : '';
}

function key(name) {
    return name.toLowerCase();
}

function uniqueNames(names) {
    const seen = new Set();
    const out = [];
    for (const name of names) {
        if (!name || seen.has(key(name))) continue;
        seen.add(key(name));
        out.push(name);
    }
    return out;
}

export function normalizeNames(value) {
    let parts;
    if (typeof value === 'string') parts = value.split(',');
    else if (Array.isArray(value)) parts = value.filter((item) => typeof item === 'string');
    else return [];
    const names = parts.map((part) => part.trim().slice(0, NAME_CHARS).trim());
    return uniqueNames(names).slice(0, NAME_LIMIT);
}

function toTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toCandidate(entry, source) {
    return {
        url: entry.url,
        names: normalizeNames(entry.names),
        enabled: entry.enabled !== false,
        source,
        timestamp: toTimestamp(entry.timestamp),
    };
}

function hasUrl(entry) {
    return entry !== null && typeof entry === 'object' && typeof entry.url === 'string' && entry.url !== '';
}

export function groupKey(names) {
    return normalizeNames(names).map(key).sort((a, b) => a.localeCompare(b)).join('|');
}

// Default order (spec 14.1): uploads in list order (the first picture of a person is the anchor), then gallery
// records in list order, which is newest first.
function defaultCandidates(uploads, gallery) {
    const fromUploads = (Array.isArray(uploads) ? uploads : [])
        .filter(hasUrl)
        .map((entry) => toCandidate(entry, 'upload'));
    // A generated picture without names is just a gallery entry, not a reference.
    const fromGallery = (Array.isArray(gallery) ? gallery : [])
        .filter((entry) => hasUrl(entry) && Array.isArray(entry.names) && entry.names.length > 0)
        .map((entry) => toCandidate(entry, 'generated'));
    return [...fromUploads, ...fromGallery].filter((item) => item.names.length > 0);
}

// Own properties only: a group key such as "constructor" must not find Object.prototype members.
function storedUrls(order, groupId) {
    if (order === null || typeof order !== 'object' || Array.isArray(order) || !Object.hasOwn(order, groupId)) return [];
    const list = order[groupId];
    return Array.isArray(list) ? list : [];
}

// Pictures the owner placed keep that place; pictures added later follow in default order, so a pinned
// picture stays on top.
function applyOrder(items, urls) {
    if (urls.length === 0) return items;
    const byUrl = new Map();
    for (const item of items) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    const front = [];
    for (const url of urls) {
        const item = byUrl.get(url);
        if (item && !front.includes(item)) front.push(item);
    }
    return [...front, ...items.filter((item) => !front.includes(item))];
}

export function groupCandidates({ uploads, gallery, order } = {}) {
    const groups = new Map();
    for (const item of defaultCandidates(uploads, gallery)) {
        const id = groupKey(item.names);
        if (!groups.has(id)) groups.set(id, { key: id, names: [...item.names], items: [] });
        groups.get(id).items.push(item);
    }
    return [...groups.values()]
        .map((group) => ({ ...group, items: applyOrder(group.items, storedUrls(order, group.key)) }))
        .sort((a, b) => a.names.length - b.names.length || a.key.localeCompare(b.key));
}

export function toCandidates({ uploads, gallery, order } = {}) {
    return groupCandidates({ uploads, gallery, order }).flatMap((group) => group.items);
}

export function allNames(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const names = list.flatMap((group) => (Array.isArray(group?.items) ? group.items : []).flatMap((item) => item?.names ?? []));
    return uniqueNames(names).sort((a, b) => a.localeCompare(b));
}

export function moveInList(list, value, direction) {
    const copy = Array.isArray(list) ? [...list] : [];
    const from = copy.indexOf(value);
    const to = from + direction;
    if (from < 0 || (direction !== -1 && direction !== 1) || to < 0 || to >= copy.length) return copy;
    [copy[from], copy[to]] = [copy[to], copy[from]];
    return copy;
}

export function knownNames(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    return uniqueNames(list.filter((item) => item?.enabled).flatMap((item) => item.names ?? []));
}

// Weaker chat models answer "Kyouko Hori from Horimiya" where the list says "Kyouko".
function stripWork(name) {
    const text = toText(name);
    const at = text.toLowerCase().indexOf(' from ');
    return (at >= 0 ? text.slice(0, at) : text).trim();
}

function wordsOf(text) {
    return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function containsAll(words, inside) {
    const set = new Set(inside);
    return words.every((word) => set.has(word));
}

export function matchName(name, known) {
    const cut = stripWork(name);
    if (!cut) return null;
    const entries = (Array.isArray(known) ? known : []).filter((entry) => typeof entry === 'string' && entry.trim());
    const equal = entries.find((entry) => key(entry.trim()) === key(cut));
    if (equal !== undefined) return equal;
    const nameWords = wordsOf(cut);
    let best = null;
    let bestCount = 0;
    for (const entry of entries) {
        const entryWords = wordsOf(entry);
        if (!containsAll(entryWords, nameWords) && !containsAll(nameWords, entryWords)) continue;
        if (entryWords.length > bestCount) {
            best = entry;
            bestCount = entryWords.length;
        }
    }
    return best;
}

export function resolveShownNames(names, known) {
    const list = Array.isArray(names) ? names : [];
    return uniqueNames(list.map((name) => matchName(name, known) ?? stripWork(name)));
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namePattern(name) {
    const phrase = name.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_])`, 'iu');
}

export function findNamesInText(text, known) {
    const value = toText(text);
    const entries = uniqueNames((Array.isArray(known) ? known : []).filter((entry) => typeof entry === 'string' && entry.trim()));
    const found = [];
    for (const name of entries) {
        const match = namePattern(name).exec(value);
        if (match) found.push({ name, at: match.index });
    }
    // Array.prototype.sort is stable, so names at the same position keep the order of `known`.
    return found.sort((a, b) => a.at - b.at).map((item) => item.name);
}

// Candidate order already says what the owner wants (spec 14.1): the default group order puts uploads first,
// and a manual order may put a generated picture in front, so the source is no tie-break of its own. A
// timestamp would put the latest upload in front instead.
function compareCandidates(a, b) {
    if (a.names.length !== b.names.length) return a.names.length - b.names.length;
    return a.index - b.index;
}

function pickBest(list, compare) {
    let best = null;
    for (const item of list) if (best === null || compare(item, best) < 0) best = item;
    return best;
}

export function selectReferences({ candidates, sceneNames, maxImages, perNameLimit = PER_NAME_LIMIT }) {
    const scene = uniqueNames((Array.isArray(sceneNames) ? sceneNames : []).map((name) => toText(name).trim()));
    const max = Math.floor(Number(maxImages));
    if (scene.length === 0 || !(max >= 1)) return [];
    const inScene = new Set(scene.map(key));
    const eligible = (Array.isArray(candidates) ? candidates : [])
        .map((item, index) => ({ ...item, index, keys: (item?.names ?? []).map(key) }))
        .filter((item) => item.enabled && item.keys.length > 0 && item.keys.every((name) => inScene.has(name)));
    const counts = new Map(scene.map((name) => [key(name), 0]));
    const chosen = [];
    const taken = new Set();
    const allowed = (item) => !taken.has(item.index) && item.keys.every((name) => counts.get(name) < perNameLimit);
    const take = (item) => {
        taken.add(item.index);
        chosen.push(item);
        for (const name of item.keys) counts.set(name, counts.get(name) + 1);
    };

    // Cover: a picture that shows several missing people at once keeps them consistent with each other.
    while (chosen.length < max) {
        const scored = eligible.filter(allowed)
            .map((item) => ({ item, missing: item.keys.filter((name) => counts.get(name) === 0).length }));
        const top = Math.max(0, ...scored.map((entry) => entry.missing));
        if (top === 0) break;
        take(pickBest(scored.filter((entry) => entry.missing === top).map((entry) => entry.item), compareCandidates));
    }

    // Fill: a second picture per person, in turns, so nobody gets two before everyone had the chance.
    let added = true;
    while (added && chosen.length < max) {
        added = false;
        for (const name of scene.map(key)) {
            if (chosen.length >= max) break;
            if (counts.get(name) >= perNameLimit) continue;
            const best = pickBest(eligible.filter((item) => allowed(item) && item.keys.includes(name)), compareCandidates);
            if (best) {
                take(best);
                added = true;
            }
        }
    }
    return chosen.map((item) => ({ url: item.url, names: [...item.names] }));
}

function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function buildReferencePreamble(selected) {
    const list = Array.isArray(selected) ? selected : [];
    if (list.length === 0) return '';
    const shows = list.map((item, i) => `image ${i + 1} shows ${joinNames(item?.names ?? [])}`).join('; ');
    return `Reference images: ${shows}. Draw these people exactly as in their reference images: same face, eyes, hair and drawing style. Where the description differs from a reference image, the reference image wins. Scene: `;
}
