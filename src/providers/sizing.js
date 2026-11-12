// Maps the canonical aspect setting onto whatever size vocabulary a model advertises. PURE.

const PIXEL_RE = /^(\d+)\s*[x*]\s*(\d+)$/i;
const RATIO_RE = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/;
const TIER_K_RE = /^(\d+(?:\.\d+)?)k$/i;
const TIER_N_RE = /^\d+$/;

// Entries within this log-ratio distance of the best match count as "same shape" for area picking.
const RATIO_TOLERANCE = 0.02;
const STANDARD_MIN_AREA = 900000;
const HIGH_MAX_AREA = 4500000;

const NAMED_RATIOS = Object.freeze({
    square_hd: 1,
    square: 1,
    portrait_4_3: 3 / 4,
    portrait_16_9: 9 / 16,
    landscape_4_3: 4 / 3,
    landscape_16_9: 16 / 9,
});

export function parsePixelSize(text) {
    const match = PIXEL_RE.exec(String(text ?? '').trim());
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!(width > 0 && height > 0)) return null;
    return { width, height };
}

export function parseRatio(text) {
    const value = String(text ?? '').trim();
    const pixel = parsePixelSize(value);
    if (pixel) return pixel.width / pixel.height;
    const match = RATIO_RE.exec(value);
    if (!match) return null;
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (!(w > 0 && h > 0)) return null;
    return w / h;
}

function ratioError(ratio, target) {
    return Math.abs(Math.log(ratio / target));
}

export function nearestByRatio(candidates, targetRatio) {
    let best = null;
    let bestError = Infinity;
    for (const candidate of candidates ?? []) {
        const ratio = parseRatio(candidate);
        if (ratio === null) continue;
        const error = ratioError(ratio, targetRatio);
        if (error < bestError) {
            best = candidate;
            bestError = error;
        }
    }
    return best;
}

function tierValue(text) {
    const value = String(text ?? '').trim();
    const k = TIER_K_RE.exec(value);
    if (k) return Number(k[1]);
    if (TIER_N_RE.test(value)) return Number(value) / 1000;
    return null;
}

export function pickTier(tiers, quality) {
    const parsed = (tiers ?? [])
        .map((tier) => ({ tier, value: tierValue(tier) }))
        .filter((entry) => entry.value !== null)
        .sort((a, b) => a.value - b.value);
    if (parsed.length === 0) return null;
    const largest = parsed[parsed.length - 1].tier;
    const smallestAtLeastOne = parsed.find((entry) => entry.value >= 1)?.tier ?? null;
    if (quality === 'high') {
        const capped = parsed.filter((entry) => entry.value <= 2);
        if (capped.length > 0) return capped[capped.length - 1].tier;
        return smallestAtLeastOne ?? largest;
    }
    return smallestAtLeastOne ?? largest;
}

function targetRatioFor(aspectId) {
    return parseRatio(aspectId) ?? 1;
}

function pickPixelEntry(entries, target, quality) {
    const scored = entries.map((entry) => {
        const { width, height } = parsePixelSize(entry);
        return { entry, area: width * height, error: ratioError(width / height, target) };
    });
    const bestError = Math.min(...scored.map((s) => s.error));
    const close = scored.filter((s) => s.error <= bestError + RATIO_TOLERANCE).sort((a, b) => a.area - b.area);
    if (quality === 'high') {
        const capped = close.filter((s) => s.area <= HIGH_MAX_AREA);
        return (capped.length > 0 ? capped[capped.length - 1] : close[0]).entry;
    }
    return (close.find((s) => s.area >= STANDARD_MIN_AREA) ?? close[close.length - 1]).entry;
}

function pickNamedEntry(entries, target) {
    // square_hd first so it wins the tie against plain square.
    const ordered = [...entries].sort((a, b) => (b === 'square_hd') - (a === 'square_hd'));
    let best = null;
    let bestError = Infinity;
    for (const name of ordered) {
        const error = ratioError(NAMED_RATIOS[name], target);
        if (error < bestError) {
            best = name;
            bestError = error;
        }
    }
    return best;
}

function classify(resolutions) {
    const groups = { pixel: [], ratio: [], tier: [], named: [] };
    for (const raw of resolutions) {
        if (typeof raw !== 'string') continue;
        const entry = raw.trim();
        if (parsePixelSize(entry)) groups.pixel.push(entry);
        else if (RATIO_RE.test(entry) && parseRatio(entry) !== null) groups.ratio.push(entry);
        else if (tierValue(entry) !== null) groups.tier.push(entry);
        else if (Object.hasOwn(NAMED_RATIOS, entry)) groups.named.push(entry);
    }
    return groups;
}

export function selectNanoGptSize(supported, aspectId, quality) {
    const target = targetRatioFor(aspectId);
    const resolutions = Array.isArray(supported?.resolutions) ? supported.resolutions : [];
    const groups = classify(resolutions);

    if (groups.pixel.length > 0) return { resolution: pickPixelEntry(groups.pixel, target, quality) };
    if (groups.ratio.length > 0) return { resolution: nearestByRatio(groups.ratio, target) };
    if (groups.named.length > 0) return { resolution: pickNamedEntry(groups.named, target) };

    const result = {};
    if (Array.isArray(supported?.aspect_ratio)) {
        const list = supported.aspect_ratio.filter((value) => typeof value === 'string');
        const concrete = list.filter((value) => value !== 'auto');
        const nearest = nearestByRatio(concrete, target);
        if (nearest !== null) result.aspect_ratio = nearest;
        else if (list.includes('auto')) result.aspect_ratio = 'auto';
    }
    const tier = pickTier(groups.tier, quality);
    if (tier !== null) result.resolution = tier;
    return result;
}

export function selectOpenRouterSize(supported, aspectId, quality) {
    const target = targetRatioFor(aspectId);
    const result = {};
    const aspects = supported?.aspect_ratio?.values;
    if (Array.isArray(aspects)) {
        const nearest = nearestByRatio(aspects.filter((value) => value !== 'auto'), target);
        if (nearest !== null) result.aspect_ratio = nearest;
    }
    const resolutions = supported?.resolution?.values;
    if (Array.isArray(resolutions)) {
        const tier = pickTier(resolutions, quality);
        if (tier !== null) result.resolution = tier;
    }
    return result;
}
