// Turns chat snapshots into an image prompt. Pure: the caller supplies the snapshots.

import { NAME_LIMIT } from '../references/select.js';

export const DEFAULT_INSTRUCTION = 'Depict the current moment of this roleplay as one image: what happens in the latest message. Show {{char}} and everyone else who is present in that moment.';

// build.js appends one of these: the user is drawn only when a reference picture of the user exists.
export const POV_SENTENCE = ' The picture is seen through the eyes of {{user}}: {{user}} is not in the picture.';
export const USER_SHOWN_SENTENCE = ' {{user}} has a reference picture and is shown in the picture when {{user}} takes part in the moment.';

// Stored settings that still hold an old default get the new one; a text the user wrote is kept.
export const LEGACY_DEFAULT_INSTRUCTIONS = Object.freeze([
    'Depict the current moment of this roleplay as one image: the characters present with their appearance (hair, eyes, build, clothing), their pose and expression, the location, lighting and mood. Take the characters\' looks and the setting from the first message and the current action from the latest messages.',
    'Depict the current moment of this roleplay as one image: what happens in the latest message. Show the characters who are present with their appearance (hair, eyes, build, clothing), their pose and expression, the place where they are now, the lighting and the mood.',
    'Depict the current moment of this roleplay as one image: what happens in the latest message. The picture shows {{char}}, seen through the eyes of {{user}}. {{user}} is not in the picture.',
]);

export const LIMITS = Object.freeze({ firstMessageChars: 2500, messageChars: 1500, characterChars: 1200, characterCount: 4 });

export const DEFAULT_DESCRIPTION = 'who is shown, their hair and eyes, what they wear in this moment, what they are doing and their expression, the place, the light';
export const DESCRIPTION_WORDS = Object.freeze({ min: 20, max: 200, fallback: 45 });

// Above this many words the prompt targets models that read long prompts, so the 50-word warning would mislead.
const SHORT_PROMPT_WORDS = 50;

// The frame (who is shown, head count, naming) stays fixed: reference matching depends on it.
const SYSTEM_PROMPT_HEAD = 'You write prompts for an AI image generator. Do not continue the story and do not answer in character. Describe only what is visible in the current moment, with most weight on the last message. If the current moment does not say where it takes place or who is present, take that from the earlier messages. The character notes and the background information are a reference for what the characters and the world look like: take appearance details from them, never depict their events, and use their location only when the messages give no other place. Answer in exactly two lines. Line 1: the word "Shown:" followed by the names of the people who are visible in this picture and nobody else, separated by commas, the most important first. The list of known names only fixes the spelling: when a visible person is on it, copy the name from the list, otherwise write the name the chat uses. Most people on that list are usually not in the picture. ';
const SYSTEM_PROMPT_NAMING = ' Refer to each person by the name from line 1; for a character from a published work (anime, game, book, film, series) write the full canonical name and the title of the work instead at the first mention, for example "Hermione Granger from Harry Potter". ';
const SYSTEM_PROMPT_TAIL = ' No dialogue, no explanations. Output only these two lines.';

function cleanDescription(value) {
    // A trailing period would double up with the one the template puts after the description.
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trim() : '';
    return text || DEFAULT_DESCRIPTION;
}

function clampWords(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DESCRIPTION_WORDS.fallback;
    return Math.min(DESCRIPTION_WORDS.max, Math.max(DESCRIPTION_WORDS.min, Math.round(value)));
}

export function buildSystemPrompt({ description, maxWords } = {}) {
    const words = clampWords(maxWords);
    const short = words <= SHORT_PROMPT_WORDS;
    const line2 = `Line 2: one ${short ? 'short ' : ''}description in plain English, at most ${words} words. Start with how many people are in the picture, for example "One girl, solo:" or "One girl and one boy:". Then, in this order: ${cleanDescription(description)}.`;
    const weight = short
        ? 'Many image generators ignore everything after about 50 words, so the most important things come first and nothing is mentioned that cannot be seen.'
        : 'The most important things come first and nothing is mentioned that cannot be seen.';
    return `${SYSTEM_PROMPT_HEAD}${line2}${SYSTEM_PROMPT_NAMING}${weight}${SYSTEM_PROMPT_TAIL}`;
}

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

// Message 0 is reference material; labelling it keeps the models from painting its events.
const BACKGROUND_HEADING = '[Background, reference only: looks and world]\n';
const EARLIER_HEADING = '[Earlier messages, context only]\n';
const CURRENT_HEADING = '[Current moment, depict this]\n';
const SECTION_SEPARATOR = '\n\n';

function formatSection(heading, entries) {
    return `${heading}${entries.map(formatEntry).join(SECTION_SEPARATOR)}`;
}

// Chat models weigh the end of a prompt most, image models the start, so the current moment goes where it counts.
export function buildSceneBlock({ first, recent }, { currentFirst = false } = {}) {
    const entries = Array.isArray(recent) ? recent : [];
    const background = first ? formatSection(BACKGROUND_HEADING, [first]) : '';
    const earlier = entries.length > 1 ? formatSection(EARLIER_HEADING, entries.slice(0, -1)) : '';
    const current = entries.length > 0 ? formatSection(CURRENT_HEADING, entries.slice(-1)) : '';
    const sections = currentFirst ? [current, earlier, background] : [background, earlier, current];
    return sections.filter(Boolean).join(SECTION_SEPARATOR);
}

// Shorter cut-off pieces carry too little scene to be worth the room.
const MIN_PIECE_CHARS = 80;
const BACKGROUND_SHARE_WITH_RECENT = 0.3;

// Whole entry when it fits; a cut one only when enough of it remains, or when `force` (the current moment).
function fitEntry(entry, room, force = false) {
    const textRoom = room - `${entry.name}: `.length;
    if (entry.text.length <= textRoom) return entry;
    if (!force && textRoom < MIN_PIECE_CHARS) return null;
    const text = truncateText(entry.text, textRoom);
    return text ? { name: entry.name, text } : null;
}

// Newest first: the messages closest to the current moment explain it best.
function fitEarlier(earlier, room) {
    const kept = [];
    let used = SECTION_SEPARATOR.length + EARLIER_HEADING.length;
    for (let i = earlier.length - 1; i >= 0; i--) {
        const separator = kept.length > 0 ? SECTION_SEPARATOR.length : 0;
        const entry = fitEntry(earlier[i], room - used - separator);
        if (!entry) break;
        kept.unshift(entry);
        used += separator + formatEntry(entry).length;
        if (entry !== earlier[i]) break;
    }
    return kept;
}

export function fitContext({ first, recent }, budgetChars) {
    const budget = Math.floor(Number(budgetChars) || 0);
    const entries = Array.isArray(recent) ? recent : [];
    if (budget < MIN_PIECE_CHARS) return { first: null, recent: [] };
    let keptRecent = [];
    if (entries.length > 0) {
        const current = fitEntry(entries[entries.length - 1], budget - CURRENT_HEADING.length, true);
        if (current) {
            const used = CURRENT_HEADING.length + formatEntry(current).length;
            keptRecent = [...fitEarlier(entries.slice(0, -1), budget - used), current];
        }
    }
    if (!first) return { first: null, recent: keptRecent };
    const used = keptRecent.length > 0 ? buildSceneBlock({ first: null, recent: keptRecent }).length : 0;
    const left = used > 0 ? budget - used - SECTION_SEPARATOR.length : budget;
    const cap = used > 0 ? Math.min(left, Math.floor(budget * BACKGROUND_SHARE_WITH_RECENT)) : left;
    const keptFirst = fitEntry(first, cap - BACKGROUND_HEADING.length);
    return { first: keptFirst, recent: keptRecent };
}

// The direct prompt is `<instruction>\n\n<sceneBlock>` behind the style prefix finalizePrompt puts in front.
export function directSceneBudget({ instruction, styleSuffix, maxChars = 1800 }) {
    return maxChars - stylePrefixText(styleSuffix).length - toText(instruction).length - SECTION_SEPARATOR.length;
}

export function collectCharacters(notes) {
    const list = Array.isArray(notes) ? notes : [];
    const characters = [];
    for (const note of list) {
        if (characters.length >= LIMITS.characterCount) break;
        const name = toText(note?.name).trim();
        if (!name) continue;
        characters.push({ name, text: truncateText(cleanMessageText(note.description), LIMITS.characterChars) });
    }
    return characters;
}

// Without a card the chat model has no looks to work from and does not know whom to name.
const CHARACTER_HEADING = '[Characters, reference only: who they are and what they look like]';

export function buildCharacterBlock({ characters, userName }) {
    const list = Array.isArray(characters) ? characters : [];
    if (list.length === 0) return '';
    const entries = list.map(({ name, text }) => (text ? `${name} (character): ${text}` : `${name} (character)`));
    const user = toText(userName).trim();
    if (user) entries.push(`${user} (user)`);
    return `${CHARACTER_HEADING}\n${entries.join(SECTION_SEPARATOR)}`;
}

// The list only fixes spelling, so the names the chat model reports can be matched to reference pictures.
const KNOWN_NAMES_HEADING = '[Known names, for spelling only]';

export function buildLlmRequest({ instruction, sceneBlock, characterBlock = '', knownNames = [], description, maxWords }) {
    const names = (Array.isArray(knownNames) ? knownNames : []).map(toText).filter((name) => name.trim());
    const characters = toText(characterBlock);
    const middle = [names.length > 0 ? `${KNOWN_NAMES_HEADING}\n${names.join(', ')}` : '', characters]
        .filter(Boolean)
        .map((block) => `${block}${SECTION_SEPARATOR}`)
        .join('');
    return {
        systemPrompt: buildSystemPrompt({ description, maxWords }),
        prompt: `Task: ${toText(instruction)}${SECTION_SEPARATOR}${middle}${toText(sceneBlock)}\n\nImage prompt:`,
    };
}

export function buildDirectPrompt({ instruction, sceneBlock }) {
    return `${toText(instruction)}\n\n${toText(sceneBlock)}`;
}

function stripThinkBlocks(text) {
    // Reasoning models sometimes leave an unclosed think block in front of the answer.
    return toText(text).replace(THINK_BLOCKS, '').replace(/^[\s\S]*<\/(think|thinking|reasoning)\s*>/i, '');
}

const SHOWN_LINE = /^[ \t>*_`"']*shown\s*:(.*)$/im;
const NO_ONE = new Set(['none', 'nobody', 'no one', '-']);

function cleanShownName(part) {
    const strip = (value) => value.replace(/^[\s"'`*“”„‘’]+/, '').replace(/[\s"'`*“”„‘’]+$/, '');
    return strip(strip(part).replace(/\.+$/, ''));
}

export function splitShownLine(text) {
    const value = stripThinkBlocks(text);
    const match = SHOWN_LINE.exec(value);
    if (!match) return { names: [], text: value };
    const names = match[1].split(',')
        .map(cleanShownName)
        .filter((name) => name && !NO_ONE.has(name.toLowerCase()))
        .slice(0, NAME_LIMIT);
    const end = match.index + match[0].length;
    const rest = value.slice(end).replace(/^\r?\n/, '');
    return { names, text: value.slice(0, match.index) + rest };
}

export function cleanLlmOutput(text) {
    let value = stripThinkBlocks(text);
    const fence = value.match(/```[^\n`]*\n?([\s\S]*?)```/);
    if (fence) value = fence[1];
    value = value.trim().replace(/^(?:image\s+)?prompt\s*:\s*/i, '');
    value = value.replace(/^["'`*“”„\s]+/, '').replace(/["'`*“”„\s]+$/, '');
    return value.replace(/\s+/g, ' ').trim();
}

function stylePrefixText(styleSuffix) {
    const style = toText(styleSuffix).trim();
    return style ? `${style}, ` : '';
}

// The style goes first: image models drop the end of a long prompt, and the style must survive.
export function finalizePrompt(text, { styleSuffix = '', maxChars = 1800 } = {}) {
    const prefix = stylePrefixText(styleSuffix);
    const body = truncateText(toText(text).trim(), Math.max(0, maxChars - prefix.length));
    if (!prefix) return body.trim();
    return body ? `${prefix}${body}` : toText(styleSuffix).trim();
}

// Several models of one run can get different prompts (prompt limit, reference slots); the preview shows each once.
export function promptPreviewText(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    const groups = new Map();
    for (const { model, prompt } of entries) {
        const models = groups.get(prompt) ?? [];
        if (!models.includes(model)) models.push(model);
        groups.set(prompt, models);
    }
    if (groups.size === 1) return entries[0].prompt;
    return [...groups].map(([prompt, models]) => `${models.join(', ')}:\n${prompt}`).join('\n\n');
}
