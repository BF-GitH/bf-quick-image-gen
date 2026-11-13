// Hides everything after the user's message with CSS, so the reply text stays hidden in the DOM
// until the image is attached. CSS survives re-renders and virtualized chat lists, unlike per-node hiding.

const STYLE_ID = 'bfqig-hold-style';
const STATUS_ID = 'bfqig-status';
const CANCEL_LABEL = 'Text sofort zeigen';
const PROMPT_SHOW_LABEL = 'Prompt anzeigen';
const PROMPT_HIDE_LABEL = 'Prompt verbergen';

function placeStatusBar(bar) {
    const sendForm = document.getElementById('send_form');
    if (sendForm?.parentNode) {
        if (bar.nextSibling !== sendForm) sendForm.parentNode.insertBefore(bar, sendForm);
    } else if (!bar.isConnected) {
        document.body.append(bar);
    }
}

export function createHold() {
    function engage(userIndex) {
        const index = Number(userIndex);
        if (!Number.isInteger(index)) return;
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.head.append(style);
        }
        style.textContent = `#chat .mes[mesid="${index}"] ~ .mes { display: none !important; }`;
    }

    function release() {
        document.getElementById(STYLE_ID)?.remove();
    }

    // What the shown bar carries, so a prompt or a toggle can draw it again; null while no bar is shown.
    let shown = null;
    let prompt = null;
    let promptOpen = false;

    function setStatus(text, options) {
        if (text === null || text === undefined) {
            shown = null;
            prompt = null;
            promptOpen = false;
            document.getElementById(STATUS_ID)?.remove();
            return;
        }
        shown = { text, options };
        draw();
    }

    function setPrompt(text) {
        if (typeof text !== 'string' || text === '') {
            prompt = null;
            promptOpen = false;
        } else if (shown) {
            prompt = text;
        } else {
            return;
        }
        if (shown) draw();
    }

    function promptButton() {
        const button = document.createElement('button');
        button.id = 'bfqig-status-prompt';
        button.type = 'button';
        button.className = 'menu_button';
        button.setAttribute('aria-expanded', String(promptOpen));
        button.textContent = promptOpen ? PROMPT_HIDE_LABEL : PROMPT_SHOW_LABEL;
        button.addEventListener('click', () => {
            promptOpen = !promptOpen;
            draw();
        });
        return button;
    }

    function draw() {
        const { text, options } = shown;
        const { onCancel, cancelLabel = CANCEL_LABEL } = options ?? {};
        let bar = document.getElementById(STATUS_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = STATUS_ID;
            bar.className = 'bfqig-status';
            bar.setAttribute('role', 'status');
            bar.setAttribute('aria-live', 'polite');
        }
        const spinner = document.createElement('i');
        spinner.className = 'fa-solid fa-spinner fa-spin';
        const label = document.createElement('span');
        label.className = 'bfqig-status-text';
        label.textContent = String(text);
        bar.replaceChildren(spinner, label);
        if (prompt) bar.append(promptButton());
        if (typeof onCancel === 'function') {
            const cancel = document.createElement('button');
            cancel.id = 'bfqig-status-cancel';
            cancel.type = 'button';
            cancel.className = 'menu_button';
            cancel.textContent = String(cancelLabel);
            cancel.addEventListener('click', () => onCancel());
            bar.append(cancel);
        }
        if (prompt && promptOpen) {
            const promptText = document.createElement('div');
            promptText.id = 'bfqig-status-prompt-text';
            promptText.className = 'bfqig-status-prompt-text';
            promptText.textContent = prompt;
            bar.append(promptText);
        }
        placeStatusBar(bar);
    }

    return { engage, release, setStatus, setPrompt };
}
