// Text generation through the user's connected chat model.

import { getContext } from './st.js';

// Only chat-completion presets get a longer reply: text-completion backends count the reply length against
// their context size. Both hosts restore the preset value after a generateRaw with responseLength themselves.
function responseLengthFor(ctx, minResponseTokens) {
    if (!(typeof minResponseTokens === 'number' && minResponseTokens > 0)) return null;
    if (ctx.mainApi !== 'openai') return null;
    const current = ctx.chatCompletionSettings?.openai_max_tokens;
    return typeof current === 'number' && current < minResponseTokens ? minResponseTokens : null;
}

export async function generateText({ prompt, systemPrompt, minResponseTokens }) {
    const ctx = getContext();
    const responseLength = responseLengthFor(ctx, minResponseTokens);
    const request = responseLength === null ? { prompt, systemPrompt } : { prompt, systemPrompt, responseLength };
    // generateRaw bypasses the chat history and the send pipeline, so it is safe inside MESSAGE_RECEIVED.
    const result = await ctx.generateRaw(request);
    return typeof result === 'string' ? result : '';
}
