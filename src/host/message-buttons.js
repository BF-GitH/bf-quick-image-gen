// Extra button in the "..." menu of every chat message. Both hosts clone #message_template for each message,
// so the button goes into the template and, for messages already on screen, into each of them.

import { LOG_PREFIX } from '../shared/constants.js';

const WAIT_MS = 30000;
const POLL_MS = 500;

const installed = new Set();

function createButton({ className, iconClass, title }) {
    const button = document.createElement('div');
    button.className = `mes_button ${className} ${iconClass}`;
    button.title = title;
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    return button;
}

function addTo(mes, options) {
    const bar = mes.querySelector('.extraMesButtons');
    if (!bar || bar.querySelector(`.${options.className}`)) return;
    bar.append(createButton(options));
}

function messageIndexOf(target) {
    const index = Number(target.closest('.mes')?.getAttribute('mesid'));
    return Number.isInteger(index) && index >= 0 ? index : null;
}

function runClick(onClick, index) {
    Promise.resolve()
        .then(() => onClick?.(index))
        .catch((error) => console.error(LOG_PREFIX, 'Message button action failed', error));
}

function attach(chat, template, options) {
    const templateMes = template.content?.querySelector('.mes') ?? template.querySelector('.mes');
    if (templateMes) addTo(templateMes, options);
    for (const mes of chat.querySelectorAll('.mes')) addTo(mes, options);
    // TauriTavern may mount messages later than the clone, so the template alone does not cover every message.
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches('.mes')) addTo(node, options);
                for (const mes of node.querySelectorAll('.mes')) addTo(mes, options);
            }
        }
    }).observe(chat, { childList: true, subtree: true });
}

// Delegated, because the buttons are cloned with the template and no per-node listener survives that.
// No keydown handler: the host's keyboard.js already turns Enter on '.mes_buttons .mes_button' into a click.
function wire(options) {
    const selector = `.${options.className}`;
    document.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest(selector) : null;
        if (!button) return;
        const index = messageIndexOf(button);
        if (index !== null) runClick(options.onClick, index);
    });
}

export function installMessageButton({ className, iconClass, title, onClick }) {
    if (installed.has(className)) return;
    installed.add(className);
    const options = { className, iconClass, title, onClick };
    wire(options);
    const deadline = Date.now() + WAIT_MS;
    const tryAttach = () => {
        const chat = document.getElementById('chat');
        const template = document.getElementById('message_template');
        if (chat && template) {
            attach(chat, template, options);
            return;
        }
        if (Date.now() >= deadline) {
            console.warn(LOG_PREFIX, '#chat or #message_template not found, message button not added');
            return;
        }
        setTimeout(tryAttach, POLL_MS);
    };
    tryAttach();
}
