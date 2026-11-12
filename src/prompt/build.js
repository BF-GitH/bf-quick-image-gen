// WIRING: turns the live chat into a finished image prompt (scene logic lives in scene.js).

import { LOG_PREFIX } from '../shared/constants.js';
import { getChatLength, getMessageSnapshot, getCharacterNotes, getParticipantNames } from '../host/chat.js';
import { substituteMacros } from '../host/st.js';
import { generateText } from '../host/llm.js';
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
} from './scene.js';

// Reasoning models spend up to ~1800 tokens thinking; a usual roleplay reply length cut the prompt mid-sentence.
export const IMAGE_PROMPT_MIN_TOKENS = 2000;

function buildCharacterBlockFromChat() {
    const notes = getCharacterNotes().map((note) => ({ ...note, description: substituteMacros(note.description) }));
    return buildCharacterBlock({ characters: collectCharacters(notes), userName: getParticipantNames().user });
}

export async function buildImagePrompt({ lastIndex, settings, maxPromptChars }) {
    const context = collectContext({
        chatLength: getChatLength(),
        replyIndex: lastIndex,
        recentCount: settings.contextMessages,
        getSnapshot: getMessageSnapshot,
    });
    const sceneBlock = buildSceneBlock(context);
    const instruction = substituteMacros(settings.instruction);

    let text = '';
    if (settings.useLlm) {
        try {
            const request = buildLlmRequest({ instruction, sceneBlock, characterBlock: buildCharacterBlockFromChat() });
            text = cleanLlmOutput(await generateText({ ...request, minResponseTokens: IMAGE_PROMPT_MIN_TOKENS }));
            if (!text) console.warn(`${LOG_PREFIX} chat model returned an empty image prompt, using the direct prompt`);
        } catch (error) {
            // An image is still better than none: fall back to the raw scene description.
            console.warn(`${LOG_PREFIX} image prompt via chat model failed, using the direct prompt:`, error?.message ?? error);
            text = '';
        }
    }
    const usedLlm = Boolean(text);
    if (!usedLlm) {
        // finalizePrompt cuts from the end, so a long first message would push the latest messages out.
        const budget = directSceneBudget({ instruction, styleSuffix: settings.styleSuffix, maxChars: maxPromptChars });
        const fitted = fitContext(context, budget);
        text = buildDirectPrompt({ instruction, sceneBlock: buildSceneBlock(fitted, { currentFirst: true }) });
    }

    return {
        prompt: finalizePrompt(text, { styleSuffix: settings.styleSuffix, maxChars: maxPromptChars }),
        usedLlm,
    };
}
