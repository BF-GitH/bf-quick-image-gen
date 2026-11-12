// Removing a generated picture, shared by the viewer and the Referenzen tab so both delete the same way.

import { LOG_PREFIX } from '../shared/constants.js';
import { deleteImage } from '../host/images.js';
import { detachImageFromChat, saveChat } from '../host/chat.js';
import { removeGalleryRecord } from './store.js';

export async function deleteGeneratedImage(url) {
    // A false result usually means the file is already gone; the record must go either way.
    const deleted = await deleteImage(url);
    if (!deleted) console.warn(LOG_PREFIX, 'Image file could not be deleted', url);
    removeGalleryRecord(url);
    // Otherwise the chat message keeps a media entry pointing at the deleted file.
    if (detachImageFromChat(url) > 0) await saveChat();
}
