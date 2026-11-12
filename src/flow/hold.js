// Hides everything after the user's message with CSS, so the reply text stays hidden in the DOM
// until the image is attached. CSS survives re-renders and virtualized chat lists, unlike per-node hiding.

const STYLE_ID = 'bfqig-hold-style';
const STATUS_ID = 'bfqig-status';
const CANCEL_LABEL = 'Text sofort zeigen';

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

    function setStatus(text, { onCancel, cancelLabel = CANCEL_LABEL } = {}) {
        let bar = document.getElementById(STATUS_ID);
        if (text === null || text === undefined) {
            bar?.remove();
            return;
        }
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
        if (typeof onCancel === 'function') {
            const cancel = document.createElement('button');
            cancel.id = 'bfqig-status-cancel';
            cancel.type = 'button';
            cancel.className = 'menu_button';
            cancel.textContent = String(cancelLabel);
            cancel.addEventListener('click', () => onCancel());
            bar.append(cancel);
        }
        placeStatusBar(bar);
    }

    return { engage, release, setStatus };
}
