// Wand-menu entry. The markup mirrors the host's own extension entries so it looks native.

import { LOG_PREFIX } from '../shared/constants.js';

const WAIT_MS = 30000;
const POLL_MS = 250;

const MARKUP = '<div id="bfqig_wand_container" class="extension_container">'
    + '<div id="bfqig_send_with_image" class="list-group-item flex-container flexGap5" role="button" tabindex="0"'
    + ' title="Text senden und Antwort mit Bild erhalten">'
    + '<div class="fa-fw fa-solid fa-image extensionsMenuExtensionButton"></div><span>Senden + Bild</span>'
    + '</div></div>';

let pending = null;

async function waitForMenu() {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
        const menu = document.getElementById('extensionsMenu');
        if (menu || Date.now() >= deadline) return menu;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

function runClick(onClick) {
    Promise.resolve()
        .then(() => onClick?.())
        .catch((error) => console.error(LOG_PREFIX, 'Wand action failed', error));
}

async function insertEntry(onClick) {
    const menu = await waitForMenu();
    if (!menu) {
        console.warn(LOG_PREFIX, '#extensionsMenu not found, wand entry not added');
        return false;
    }
    if (document.getElementById('bfqig_send_with_image')) return true;
    const template = document.createElement('template');
    template.innerHTML = MARKUP;
    const container = template.content.firstElementChild;
    const button = container.querySelector('#bfqig_send_with_image');
    button.addEventListener('click', () => runClick(onClick));
    button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        runClick(onClick);
    });
    menu.append(container);
    return true;
}

export async function addWandEntry({ onClick } = {}) {
    if (document.getElementById('bfqig_send_with_image')) return true;
    // Concurrent callers share one wait so the entry is never inserted twice.
    pending ??= insertEntry(onClick).finally(() => {
        pending = null;
    });
    return pending;
}
