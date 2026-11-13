// Splits the chat model's answer into one description per requested picture and deals them over the jobs.
// Pure: no host access.

// scene.js imports the limit from here; the cycle is safe because neither file uses the other at load time.
import { cleanLlmOutput } from './scene.js';

export const PICTURE_PROMPT_LIMIT = 8;

// The number is not used: chat models miscount, the order of appearance is what the owner asked for.
const PICTURE_LINE = /^[ \t>*_`"'#-]*picture\s*\d+\s*[:.)-]/i;

export function splitPictureLines(text, { max = PICTURE_PROMPT_LIMIT } = {}) {
    const lines = typeof text === 'string' ? text.split(/\r?\n/) : [];
    const pictures = [];
    let current = null;
    for (const line of lines) {
        const match = PICTURE_LINE.exec(line);
        if (match) {
            current = [line.slice(match[0].length)];
            pictures.push(current);
        } else if (current) {
            current.push(line);
        }
    }
    return pictures
        .map((parts) => cleanLlmOutput(parts.join('\n')))
        .filter(Boolean)
        .slice(0, Math.max(0, max));
}

function toCount(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

// Dealing cards over the jobs in list order: with 2 prompts and "a x8, b x8" each model draws each prompt 4 times.
export function assignPrompts(jobCount, promptCount) {
    const jobs = toCount(jobCount);
    if (jobs < 1) return [];
    const prompts = Math.min(Math.max(1, toCount(promptCount)), jobs);
    return Array.from({ length: jobs }, (_, index) => index % prompts);
}
