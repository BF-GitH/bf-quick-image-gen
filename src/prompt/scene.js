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

export function buildSceneBlock({ first, recent }) {
    const sections = [];
    if (first) sections.push(`[First message of the chat]\n${formatEntry(first)}`);
    if (Array.isArray(recent) && recent.length > 0) {
        sections.push(`[Latest messages, oldest first]\n${recent.map(formatEntry).join('\n\n')}`);
    }
    return sections.join('\n\n');
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

export function finalizePrompt(text, { styleSuffix = '', maxChars = 1800 } = {}) {
    const style = toText(styleSuffix).trim();
    const suffix = style ? ` Style: ${style}` : '';
    const body = truncateText(toText(text).trim(), Math.max(0, maxChars - suffix.length));
    return `${body}${suffix}`.trim();
}
