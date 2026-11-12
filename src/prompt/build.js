// WIRING: turns the live chat into a finished image prompt (scene logic lives in scene.js).

import { LOG_PREFIX } from '../shared/constants.js';
import { getChatLength, getMessageSnapshot } from '../host/chat.js';
import { substituteMacros } from '../host/st.js';
import { generateText } from '../host/llm.js';
import {
    collectContext,
    buildSceneBlock,
    buildLlmRequest,
    buildDirectPrompt,
    cleanLlmOutput,
    finalizePrompt,
} from './scene.js';

export async function buildImagePrompt({ replyIndex, settings, maxPromptChars }) {
    const context = collectContext({
        chatLength: getChatLength(),
        replyIndex,
        recentCount: settings.contextMessages,
        getSnapshot: getMessageSnapshot,
    });
    const sceneBlock = buildSceneBlock(context);
    const instruction = substituteMacros(settings.instruction);

    let text = '';
    if (settings.useLlm) {
        try {
            text = cleanLlmOutput(await generateText(buildLlmRequest({ instruction, sceneBlock })));
            if (!text) console.warn(`${LOG_PREFIX} chat model returned an empty image prompt, using the direct prompt`);
        } catch (error) {
            // An image is still better than none: fall back to the raw scene description.
            console.warn(`${LOG_PREFIX} image prompt via chat model failed, using the direct prompt:`, error?.message ?? error);
            text = '';
        }
    }
    const usedLlm = Boolean(text);
    if (!usedLlm) text = buildDirectPrompt({ instruction, sceneBlock });

    return {
        prompt: finalizePrompt(text, { styleSuffix: settings.styleSuffix, maxChars: maxPromptChars }),
        usedLlm,
    };
}
