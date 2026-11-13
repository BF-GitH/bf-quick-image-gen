// Which of our pictures a host delete took away. The host reports a delete only after the fact (new chat length,
// or a swipe index), so the loss is read from a snapshot taken before it. Pure: the wiring supplies the data.

export function normalizeUrl(url) {
    return String(url ?? '').replace(/^\/+/, '');
}

function unique(urls) {
    return [...new Set(urls)];
}

function asList(value) {
    return Array.isArray(value) ? value : [];
}

export function takeSnapshot(entries, isOwn) {
    return asList(entries).map((entry) => ({
        message: entry?.message,
        swipes: asList(entry?.swipes).map((urls) =>
            unique(asList(urls).map(normalizeUrl).filter((url) => url !== '' && isOwn(url)))),
    }));
}

function urlsOf(entries) {
    return entries.flatMap((entry) => entry.swipes.flat());
}

function without(urls, kept) {
    const keep = new Set(kept);
    return unique(urls).filter((url) => !keep.has(url));
}

// A reloaded or replaced chat brings message objects the snapshot never saw; that is not a delete.
export function looksLikePendingDelete(snapshot, currentMessages) {
    const before = asList(snapshot);
    const current = asList(currentMessages);
    const known = new Set(before.map((entry) => entry.message));
    return current.length < before.length && current.every((message) => known.has(message));
}

export function goneAfterMessageDelete(snapshot, currentMessages) {
    if (!looksLikePendingDelete(snapshot, currentMessages)) return [];
    const before = asList(snapshot);
    const current = asList(currentMessages);
    const remaining = new Set(current);
    const removed = before.filter((entry) => !remaining.has(entry.message));
    const kept = before.filter((entry) => remaining.has(entry.message));
    return without(urlsOf(removed), urlsOf(kept));
}

export function goneAfterSwipeDelete(snapshot, message, swipeId, currentSwipeCount) {
    const before = asList(snapshot);
    const entry = before.find((item) => item.message === message);
    if (!entry || message === null || message === undefined) return [];
    // A snapshot renewed after the host's splice has as many swipes as now; its swipeId would hit a survivor.
    if (!Number.isInteger(currentSwipeCount) || entry.swipes.length !== currentSwipeCount + 1) return [];
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId >= entry.swipes.length) return [];
    const otherSwipes = entry.swipes.filter((_, index) => index !== swipeId).flat();
    const otherMessages = urlsOf(before.filter((item) => item !== entry));
    return without(entry.swipes[swipeId], [...otherSwipes, ...otherMessages]);
}
