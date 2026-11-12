// Chat access. chat[] is the truth (TauriTavern may virtualize the DOM), so every read goes through
// the context array and the DOM is only touched to re-render media of a message that is on screen.

import { EXTENSION_ID, LOG_PREFIX } from '../shared/constants.js';
import { getContext } from './st.js';

function isValidIndex(index) {
    return Number.isInteger(index) && index >= 0;
}

function findMessageElement(index) {
    return document.querySelector(`#chat .mes[mesid="${index}"]`);
}

export function getChatLength() {
    const chat = getContext().chat;
    return Array.isArray(chat) ? chat.length : 0;
}

export function getRawMessage(index) {
    if (!isValidIndex(index)) return null;
    const message = getContext().chat?.[index];
    return message && typeof message === 'object' ? message : null;
}

export function getMessageSnapshot(index) {
    const message = getRawMessage(index);
    if (!message) return null;
    return {
        index,
        name: String(message.name ?? ''),
        isUser: Boolean(message.is_user),
        isSystem: Boolean(message.is_system),
        text: String(message.extra?.display_text ?? message.mes ?? ''),
    };
}

export function getParticipantNames() {
    const ctx = getContext();
    return { user: String(ctx.name1 ?? ''), character: String(ctx.name2 ?? '') };
}

function toCharacterNote(character) {
    if (!character || typeof character !== 'object' || !character.name) return null;
    return {
        name: String(character.name),
        description: String(character.description ?? character.data?.description ?? ''),
    };
}

// Raw card text: cleaning and macro substitution happen in the prompt layers above.
export function getCharacterNotes() {
    const ctx = getContext();
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    let found = [];
    if (ctx.groupId) {
        const group = ctx.groups?.find?.(g => String(g.id) === String(ctx.groupId));
        const members = Array.isArray(group?.members) ? group.members : [];
        const disabled = Array.isArray(group?.disabled_members) ? group.disabled_members : [];
        found = members
            .filter(avatar => !disabled.includes(avatar))
            .map(avatar => characters.find(c => c?.avatar === avatar));
    } else if (ctx.characterId !== undefined && ctx.characterId !== null) {
        found = [ctx.characters?.[ctx.characterId]];
    }
    return found.map(toCharacterNote).filter(Boolean);
}

export function getImageFolderName() {
    const ctx = getContext();
    if (ctx.groupId) {
        const group = ctx.groups?.find?.(g => String(g.id) === String(ctx.groupId));
        if (group?.name) return String(group.name);
    } else if (ctx.characterId !== undefined && ctx.characterId !== null) {
        const name = ctx.characters?.[ctx.characterId]?.name;
        if (name) return String(name);
    }
    return EXTENSION_ID;
}

export function isMessageRendered(index) {
    return isValidIndex(index) && findMessageElement(index) !== null;
}

export function attachImageToMessage(index, { url, title }) {
    const message = getRawMessage(index);
    if (!message) return false;
    const ctx = getContext();

    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }
    // Migrates a legacy extra.image into media[]; afterwards extra.image is a read-only getter.
    ctx.ensureMessageMediaIsArray?.(message);
    const extra = message.extra;
    if (!Array.isArray(extra.media)) {
        extra.media = [];
    }
    if (extra.media.length === 0 && !extra.media_display) {
        extra.media_display = 'gallery';
    }
    extra.media.push({ url, type: 'image', title, source: 'generated' });
    extra.media_index = extra.media.length - 1;
    // false would hide the message text behind the image.
    extra.inline_image = true;

    const element = findMessageElement(index);
    if (element && typeof ctx.appendMediaToMessage === 'function') {
        try {
            // The host API works on jQuery objects (messageElement.find(...)).
            ctx.appendMediaToMessage(message, $(element));
        } catch (error) {
            // The data is attached; a failed re-render fixes itself on the next chat render.
            console.warn(LOG_PREFIX, 'appendMediaToMessage failed', error);
        }
    }
    return true;
}

// The hosts return upload paths with or without a leading slash, so both spellings must match.
function samePath(a, b) {
    return String(a).replace(/^\/+/, '') === String(b).replace(/^\/+/, '');
}

// Mirrors the host's own "delete one" media handler (deleteMessageMedia in public/scripts/chats.js),
// so the remaining state, including an empty media[] after the last image, is one the host renders.
function removeMediaEntry(extra, position) {
    extra.media.splice(position, 1);
    if (extra.media_index === position) {
        const newIndex = position > 0 ? position - 1 : 0;
        extra.media_index = Math.min(Math.max(newIndex, 0), extra.media.length - 1);
    }
}

export function detachImageFromChat(url) {
    const ctx = getContext();
    const chat = ctx.chat;
    if (!Array.isArray(chat) || !url) return 0;
    let changed = 0;
    chat.forEach((message, index) => {
        const media = message?.extra?.media;
        if (!Array.isArray(media)) return;
        let removed = false;
        // Backwards, so earlier positions stay valid while splicing.
        for (let position = media.length - 1; position >= 0; position--) {
            if (media[position]?.url && samePath(media[position].url, url)) {
                removeMediaEntry(message.extra, position);
                removed = true;
            }
        }
        if (!removed) return;
        changed++;
        const element = findMessageElement(index);
        if (element && typeof ctx.appendMediaToMessage === 'function') {
            try {
                ctx.appendMediaToMessage(message, $(element), 'keep');
            } catch (error) {
                console.warn(LOG_PREFIX, 'appendMediaToMessage failed', error);
            }
        }
    });
    return changed;
}

export async function saveChat() {
    try {
        await getContext().saveChat();
    } catch (error) {
        console.error(LOG_PREFIX, 'saveChat failed', error);
    }
}

export function scrollChatToBottom() {
    try {
        getContext().scrollChatToBottom?.();
    } catch (error) {
        console.warn(LOG_PREFIX, 'scrollChatToBottom failed', error);
    }
}
