// WIRING: turns the live chat into a finished image prompt (scene logic lives in scene.js) and picks the
// reference pictures for the people in it (selection logic lives in references/select.js).

import { LOG_PREFIX } from '../shared/constants.js';
import { getChatLength, getMessageSnapshot, getParticipantNames } from '../host/chat.js';
import { substituteMacros } from '../host/st.js';
import { generateText } from '../host/llm.js';
import { toJpegDataUrl } from '../host/images.js';
import {
    collectContext,
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
import { splitPictureLines } from './pictures.js';
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

const EMPTY_ANSWER = 'leere Antwort';
// Each further picture description needs room in the reply on top of the one description of today.
const TOKENS_PER_EXTRA_PROMPT = 300;

// -> { descriptions, names } with names = null when the answer carried no "Shown:" line.
async function askChatModel({ instruction, sceneBlock, known, settings, maxPrompts, requestMessage, textModel, signal }) {
    try {
        const request = buildLlmRequest({
            instruction,
            sceneBlock,
            knownNames: known,
            description: settings.description,
            maxWords: settings.descriptionWords,
            maxPrompts,
            requestMessage,
        });
        const minResponseTokens = IMAGE_PROMPT_MIN_TOKENS + TOKENS_PER_EXTRA_PROMPT * (maxPrompts - 1);
        const answer = textModel
            ? await textModel.provider.generateText({
                apiKey: textModel.apiKey,
                model: textModel.model,
                systemPrompt: request.systemPrompt,
                prompt: request.prompt,
                maxTokens: minResponseTokens,
                signal,
            })
            : await generateText({ ...request, minResponseTokens });
        const { names, text } = splitShownLine(answer);
        const pictures = maxPrompts > 1 ? splitPictureLines(text, { max: maxPrompts }) : [];
        const single = pictures.length > 0 ? '' : cleanLlmOutput(text);
        const descriptions = pictures.length > 0 ? pictures : (single ? [single] : []);
        if (descriptions.length === 0) console.warn(`${LOG_PREFIX} chat model returned an empty image prompt, using the direct prompt`);
        return { descriptions, names: names.length > 0 ? names : null, problem: descriptions.length > 0 ? null : EMPTY_ANSWER };
    } catch (error) {
        // An image is still better than none: fall back to the raw scene description.
        console.warn(`${LOG_PREFIX} image prompt via chat model failed, using the direct prompt:`, error?.message ?? error);
        return { descriptions: [], names: null, problem: String(error?.message ?? error) || EMPTY_ANSWER };
    }
}

// A picture that cannot be loaded (deleted file, offline) must not cost the whole image.
// `loaded` is shared by the models of one run, so a picture several of them use is converted once.
async function loadReferences(selected, loaded) {
    const results = await Promise.all(selected.map(async ({ url, names }) => {
        if (!loaded.has(url)) loaded.set(url, toJpegDataUrl(url));
        try {
            return { url, names, dataUrl: await loaded.get(url) };
        } catch (error) {
            console.warn(`${LOG_PREFIX} reference picture could not be loaded:`, url, error?.message ?? error);
            return null;
        }
    }));
    const references = results.filter(Boolean);
    return { references, failedReferences: selected.length - references.length };
}

// Asks the chat model once per run; composeImagePrompt then fits the result to each model of the run.
// textModel = { provider, apiKey, model } sends the request to the picture's provider instead of the chat model.
export async function describeScene({ lastIndex, settings, candidates = [], maxPrompts = 1, textModel = null, signal }) {
    const prompts = Number.isInteger(maxPrompts) && maxPrompts > 1 ? maxPrompts : 1;
    const known = knownNames(candidates);
    const userName = getParticipantNames().user;
    // The user is drawn only when a checked picture shows them; otherwise the picture stays in their view.
    const userShown = Boolean(userName) && matchName(userName, known) !== null;

    const context = collectContext({
        chatLength: getChatLength(),
        replyIndex: lastIndex,
        getSnapshot: getMessageSnapshot,
    });
    const sceneBlock = buildSceneBlock(context);
    const instruction = substituteMacros(settings.instruction + (userShown ? USER_SHOWN_SENTENCE : POV_SENTENCE));

    let descriptions = [];
    let reported = null;
    // Why the chat model gave no description; the caller tells the owner, who otherwise only sees a worse picture.
    let llmProblem = null;
    if (settings.useLlm) {
        // The owner writes the picture wishes into the own message, so the triggering message carries them.
        const requestMessage = prompts > 1 && context.trigger ? `${context.trigger.name}: ${context.trigger.text}` : '';
        ({ descriptions, names: reported, problem: llmProblem } = await askChatModel({
            instruction, sceneBlock, known, settings, maxPrompts: prompts, requestMessage, textModel, signal,
        }));
    }
    const usedLlm = descriptions.length > 0;
    let shownNames = usedLlm && reported
        ? resolveShownNames(reported, known)
        : findNamesInText(context.recent.at(-1)?.text ?? '', known);
    if (!userShown && userName) shownNames = shownNames.filter((name) => matchName(name, [userName]) === null);

    return { context, instruction, descriptions, usedLlm, shownNames, llmProblem, loaded: new Map() };
}

export async function composeImagePrompt(scene, { settings, candidates = [], maxPromptChars, maxReferences = 0 }) {
    const { context, instruction, descriptions, usedLlm, shownNames, loaded } = scene;
    const selected = selectReferences({ candidates, sceneNames: shownNames, maxImages: maxReferences });
    const { references, failedReferences } = await loadReferences(selected, loaded);
    const preamble = buildReferencePreamble(references);

    let texts = descriptions;
    if (!usedLlm) {
        // finalizePrompt cuts from the end, so a long first message would push the latest messages out;
        // the preamble goes in front and takes its share of the budget first.
        const budget = directSceneBudget({ instruction, styleSuffix: settings.styleSuffix, maxChars: maxPromptChars }) - preamble.length;
        const fitted = fitContext(context, budget);
        texts = [buildDirectPrompt({ instruction, sceneBlock: buildSceneBlock(fitted, { currentFirst: true }) })];
    }

    return {
        prompts: texts.map((text) => finalizePrompt(preamble + text, { styleSuffix: settings.styleSuffix, maxChars: maxPromptChars })),
        references,
        failedReferences,
    };
}
