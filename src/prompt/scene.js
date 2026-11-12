// Turns chat snapshots into an image prompt. Pure: the caller supplies the snapshots.

export const DEFAULT_INSTRUCTION = 'Depict the current moment of this roleplay as one image: the characters present with their appearance (hair, eyes, build, clothing), their pose and expression, the location, lighting and mood. Take the characters\' looks and the setting from the first message and the current action from the latest messages.';

export const LIMITS = Object.freeze({ firstMessageChars: 2500, messageChars: 1500 });

const SYSTEM_PROMPT = 'You write prompts for an AI image generator. Do not continue the story and do not answer in character. Output only the image prompt: English, one paragraph, at most 120 words, concrete visual details, no dialogue, no explanations.';

const THINK_BLOCKS = /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const CODE_BLOCKS = /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' ' };

// A cut this close to the limit still keeps most of the text, so prefer it over splitting a word.
const WORD_BOUNDARY_SLACK = 0.8;

function toText(value) {
    return typeof value === 'string' ? value : (value === null || value === undefined ? '' : String(value));
}

export function cleanMessageText(text) {
    return toText(text)
        .replace(THINK_BLOCKS, '')
        .replace(CODE_BLOCKS, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        // &amp; last would double-decode "&amp;lt;", so decode all entities in one pass.
        .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
        .replace(/[ \t\xa0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

export function truncateText(text, maxChars) {
    const value = toText(text);
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
    if (value.length <= limit) return value;
    const cut = value.slice(0, limit);
    const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
    if (boundary > 0 && boundary >= limit * WORD_BOUNDARY_SLACK) return cut.slice(0, boundary).trimEnd();
    return cut.trimEnd();
}

function toEntry(snapshot, maxChars) {
    const text = truncateText(cleanMessageText(snapshot.text), maxChars);
    if (!text) return null;
    return { name: toText(snapshot.name), text };
}

export function collectContext({ chatLength, replyIndex, recentCount, getSnapshot }) {
    const length = Number.isInteger(chatLength) ? chatLength : 0;
    let first = null;
    if (length > 0) {
        const snapshot = getSnapshot(0);
        if (snapshot) first = toEntry(snapshot, LIMITS.firstMessageChars);
    }
    const recent = [];
    const wanted = Math.max(0, Math.floor(Number(recentCount) || 0));
    const top = Math.min(Number.isInteger(replyIndex) ? replyIndex : 0, length - 1);
    for (let index = top; index >= 1 && recent.length < wanted; index--) {
        const snapshot = getSnapshot(index);
        if (!snapshot || snapshot.isSystem) continue;
        const entry = toEntry(snapshot, LIMITS.messageChars);
        if (entry) recent.push(entry);
    }
    recent.reverse();
    return { first, recent };
}

function formatEntry(entry) {
    return `${entry.name}: ${entry.text}`;
}

const FIRST_HEADING = '[First message of the chat]\n';
const RECENT_HEADING = '[Latest messages, oldest first]\n';
const SECTION_SEPARATOR = '\n\n';

export function buildSceneBlock({ first, recent }) {
    const sections = [];
    if (first) sections.push(`${FIRST_HEADING}${formatEntry(first)}`);
    if (Array.isArray(recent) && recent.length > 0) {
        sections.push(`${RECENT_HEADING}${recent.map(formatEntry).join(SECTION_SEPARATOR)}`);
    }
    return sections.join(SECTION_SEPARATOR);
}

// Shorter cut-off pieces carry too little scene to be worth the room.
const MIN_PIECE_CHARS = 80;
const RECENT_SHARE_WITH_FIRST = 0.6;

// Whole entry when it fits; a cut one only when enough of it remains, or when `force` (the reply).
function fitEntry(entry, room, force = false) {
    const textRoom = room - `${entry.name}: `.length;
    if (entry.text.length <= textRoom) return entry;
    if (!force && textRoom < MIN_PIECE_CHARS) return null;
    const text = truncateText(entry.text, textRoom);
    return text ? { name: entry.name, text } : null;
}

// Newest first: the reply and the user message decide the image, older messages only add to it.
function fitRecent(recent, cap) {
    const kept = [];
    let used = RECENT_HEADING.length;
    for (let i = recent.length - 1; i >= 0; i--) {
        const separator = kept.length > 0 ? SECTION_SEPARATOR.length : 0;
        const entry = fitEntry(recent[i], cap - used - separator, kept.length === 0);
        if (!entry) break;
        kept.unshift(entry);
        used += separator + formatEntry(entry).length;
        if (entry !== recent[i]) break;
    }
    return kept;
}

function sectionLength(recent) {
    return recent.length > 0 ? buildSceneBlock({ first: null, recent }).length : 0;
}

export function fitContext({ first, recent }, budgetChars) {
    const budget = Math.floor(Number(budgetChars) || 0);
    const entries = Array.isArray(recent) ? recent : [];
    if (budget < MIN_PIECE_CHARS) return { first: null, recent: [] };
    if (first) {
        const keptRecent = fitRecent(entries, Math.floor(budget * RECENT_SHARE_WITH_FIRST));
        const used = sectionLength(keptRecent);
        const room = budget - used - (used > 0 ? SECTION_SEPARATOR.length : 0) - FIRST_HEADING.length;
        const keptFirst = fitEntry(first, room);
        if (keptFirst) return { first: keptFirst, recent: keptRecent };
    }
    // Without a first message the latest messages may take the whole budget.
    return { first: null, recent: fitRecent(entries, budget) };
}

// The direct prompt is `<instruction>\n\n<sceneBlock>` plus the style suffix finalizePrompt appends.
export function directSceneBudget({ instruction, styleSuffix, maxChars = 1800 }) {
    return maxChars - styleSuffixText(styleSuffix).length - toText(instruction).length - SECTION_SEPARATOR.length;
}

export function buildLlmRequest({ instruction, sceneBlock }) {
    return {
        systemPrompt: SYSTEM_PROMPT,
        prompt: `Task: ${toText(instruction)}\n\n${toText(sceneBlock)}\n\nImage prompt:`,
    };
}

export function buildDirectPrompt({ instruction, sceneBlock }) {
    return `${toText(instruction)}\n\n${toText(sceneBlock)}`;
}

export function cleanLlmOutput(text) {
    let value = toText(text).replace(THINK_BLOCKS, '');
    // Reasoning models sometimes leave an unclosed think block in front of the answer.
    value = value.replace(/^[\s\S]*<\/(think|thinking|reasoning)\s*>/i, '');
    const fence = value.match(/```[^\n`]*\n?([\s\S]*?)```/);
    if (fence) value = fence[1];
    value = value.trim().replace(/^(?:image\s+)?prompt\s*:\s*/i, '');
    value = value.replace(/^["'`*“”„\s]+/, '').replace(/["'`*“”„\s]+$/, '');
    return value.replace(/\s+/g, ' ').trim();
}

function styleSuffixText(styleSuffix) {
    const style = toText(styleSuffix).trim();
    return style ? ` Style: ${style}` : '';
}

export function finalizePrompt(text, { styleSuffix = '', maxChars = 1800 } = {}) {
    const suffix = styleSuffixText(styleSuffix);
    const body = truncateText(toText(text).trim(), Math.max(0, maxChars - suffix.length));
    return `${body}${suffix}`.trim();
}
