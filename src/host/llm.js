// Text generation through the user's connected chat model.

import { getContext } from './st.js';

export async function generateText({ prompt, systemPrompt }) {
    // generateRaw bypasses the chat history and the send pipeline, so it is safe inside MESSAGE_RECEIVED.
    const result = await getContext().generateRaw({ prompt, systemPrompt });
    return typeof result === 'string' ? result : '';
}
