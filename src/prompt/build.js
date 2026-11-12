// WIRING: turns the live chat into a finished image prompt (scene logic lives in scene.js) and picks the
// reference pictures for the people in it (selection logic lives in references/select.js).

import { LOG_PREFIX } from '../shared/constants.js';
import { getChatLength, getMessageSnapshot, getCharacterNotes, getParticipantNames } from '../host/chat.js';
import { substituteMacros } from '../host/st.js';
import { generateText } from '../host/llm.js';
import { toJpegDataUrl } from '../host/images.js';
import {
    collectContext,
    collectCharacters,
    buildCharacterBlock,
    buildSceneBlock,
    buildLlmRequest,
    buildDirectPrompt,
    cleanLlmOutput,
    directSceneBudget,
    fitContext,
    finalizePrompt,
    splitShownLine,
    POV_SENTENCE,
    USER_SHOWN_SENTENCE,
} from './scene.js';
import {
    knownNames,
    matchName,
    resolveShownNames,
    findNamesInText,
    selectReferences,
    buildReferencePreamble,
} from '../references/select.js';

// Reasoning models spend up to ~1800 tokens thinking; a usual roleplay reply length cut the prompt mid-sentence.
export const IMAGE_PROMPT_MIN_TOKENS = 2000;

function buildCharacterBlockFromChat(userName) {
    const notes = getCharacterNotes().map((note) => ({ ...note, description: substituteMacros(note.description) }));
    return buildCharacterBlock({ characters: collectCharacters(notes), userName });
}

// -> { description, names } with names = null when the answer carried no "Shown:" line.
async function askChatModel({ instruction, sceneBlock, userName, known }) {
    try {
        const request = buildLlmRequest({
            instruction,
            sceneBlock,
            characterBlock: buildCharacterBlockFromChat(userName),
            knownNames: known,
        });
        const answer = await generateText({ ...request, minResponseTokens: IMAGE_PROMPT_MIN_TOKENS });
        const { names, text } = splitShownLine(answer);
        const description = cleanLlmOutput(text);
        if (!description) console.warn(`${LOG_PREFIX} chat model returned an empty image prompt, using the direct prompt`);
        return { description, names: names.length > 0 ? names : null };
    } catch (error) {
        // An image is still better than none: fall back to the raw scene description.
        console.warn(`${LOG_PREFIX} image prompt via chat model failed, using the direct prompt:`, error?.message ?? error);
        return { description: '', names: null };
    }
}

// A picture that cannot be loaded (deleted file, offline) must not cost the whole image.
async function loadReferences(selected) {
    const results = await Promise.all(selected.map(async ({ url, names }) => {
        try {
            return { url, names, dataUrl: await toJpegDataUrl(url) };
        } catch (error) {
            console.warn(`${LOG_PREFIX} reference picture could not be loaded:`, url, error?.message ?? error);
            return null;
        }
    }));
    const references = results.filter(Boolean);
    return { references, failedReferences: selected.length - references.length };
}

export async function buildImagePrompt({ lastIndex, settings, maxPromptChars, candidates = [], maxReferences = 0 }) {
    const known = knownNames(candidates);
    const userName = getParticipantNames().user;
    // The user is drawn only when a checked picture shows them; otherwise the picture stays in their view.
    const userShown = Boolean(userName) && matchName(userName, known) !== null;

    const context = collectContext({
        chatLength: getChatLength(),
        replyIndex: lastIndex,
        recentCount: settings.contextMessages,
        getSnapshot: getMessageSnapshot,
    });
    const sceneBlock = buildSceneBlock(context);
    const instruction = substituteMacros(settings.instruction + (userShown ? USER_SHOWN_SENTENCE : POV_SENTENCE));

    let description = '';
    let reported = null;
    if (settings.useLlm) {
        ({ description, names: reported } = await askChatModel({ instruction, sceneBlock, userName, known }));
    }
    const usedLlm = Boolean(description);
    let shownNames = usedLlm && reported
        ? resolveShownNames(reported, known)
        : findNamesInText(context.recent.at(-1)?.text ?? '', known);
    if (!userShown && userName) shownNames = shownNames.filter((name) => matchName(name, [userName]) === null);

    const selected = selectReferences({ candidates, sceneNames: shownNames, maxImages: maxReferences });
    const { references, failedReferences } = await loadReferences(selected);
    const preamble = buildReferencePreamble(references);

    let text = description;
    if (!usedLlm) {
        // finalizePrompt cuts from the end, so a long first message would push the latest messages out;
        // the preamble goes in front and takes its share of the budget first.
        const budget = directSceneBudget({ instruction, styleSuffix: settings.styleSuffix, maxChars: maxPromptChars }) - preamble.length;
        const fitted = fitContext(context, budget);
        text = buildDirectPrompt({ instruction, sceneBlock: buildSceneBlock(fitted, { currentFirst: true }) });
    }

    return {
        prompt: finalizePrompt(preamble + text, { styleSuffix: settings.styleSuffix, maxChars: maxPromptChars }),
        usedLlm,
        shownNames,
        references,
        failedReferences,
    };
}
