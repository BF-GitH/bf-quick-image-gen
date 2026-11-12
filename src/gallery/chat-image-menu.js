// Long-press on one of our images in the chat opens the viewer (delete, save). On Android the host shows its
// image controls only on hover and turns a long-press into its "save image" confirmation instead.

import { listRecords } from './store.js';
import { openImageViewer } from './view.js';

let installed = false;

function stripLeadingSlashes(value) {
    return String(value ?? '').replace(/^\/+/, '');
}

// A mouse right-click keeps the browser menu; only a touch long-press is taken over.
function isTouch(event) {
    const type = event.pointerType;
    if (typeof type === 'string' && type !== '') return type !== 'mouse';
    return typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
}

// Images whose record fell out of the capped gallery are still ours when the upload name gives them away.
function hasOwnFileName(path) {
    return path.split(/[?#]/)[0].split('/').pop().startsWith('bfqig_');
}

function onContextMenu(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('#chat')) return;
    if (!isTouch(event)) return;
    const src = image.getAttribute('src');
    if (!src) return;
    const path = stripLeadingSlashes(src);
    const record = listRecords().find((entry) => stripLeadingSlashes(entry.url) === path);
    if (!record && !hasOwnFileName(path)) return;
    // The host reads defaultPrevented in a task after the dispatch, so this cancels its save confirmation.
    event.preventDefault();
    openImageViewer(record ?? { url: src, prompt: image.getAttribute('title') ?? '' });
}

export function installChatImageMenu() {
    if (installed) return;
    installed = true;
    document.addEventListener('contextmenu', onContextMenu, true);
}
