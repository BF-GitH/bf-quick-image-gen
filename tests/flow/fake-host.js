// Test doubles for run-state: a manual event bus that awaits listeners like the host,
// manual timers driven by advance(), and a recording hold/notify.
import { createSendWithImageController } from '../../src/flow/run-state.js';

export function createTimers() {
    let now = 0;
    let nextId = 1;
    const pending = new Map();
    function add(fn, ms, every) {
        const id = nextId++;
        pending.set(id, { fn, at: now + ms, every });
        return id;
    }
    return {
        setTimeout: (fn, ms) => add(fn, ms, 0),
        clearTimeout: (id) => pending.delete(id),
        setInterval: (fn, ms) => add(fn, ms, ms),
        clearInterval: (id) => pending.delete(id),
        pendingCount: () => pending.size,
        advance(ms) {
            const end = now + ms;
            for (;;) {
                let nextEntry = null;
                for (const entry of pending) {
                    if (entry[1].at <= end && (!nextEntry || entry[1].at < nextEntry[1].at)) nextEntry = entry;
                }
                if (!nextEntry) break;
                const [id, timer] = nextEntry;
                now = timer.at;
                if (timer.every) timer.at += timer.every;
                else pending.delete(id);
                timer.fn();
            }
            now = end;
        },
    };
}

export function createBus() {
    const handlers = new Map();
    return {
        on(key, handler) {
            if (!handlers.has(key)) handlers.set(key, []);
            handlers.get(key).push(handler);
            return () => {
                const list = handlers.get(key);
                list.splice(list.indexOf(handler), 1);
            };
        },
        // Same semantics as the host's eventSource.emit: listeners awaited one after another.
        async emit(key, ...args) {
            for (const handler of [...(handlers.get(key) ?? [])]) await handler(...args);
        },
        count(key) {
            return handlers.get(key)?.length ?? 0;
        },
    };
}

export function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

export function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

export function setup({ processReply, precheck, streaming = true, onFailure, config } = {}) {
    const bus = createBus();
    const timers = createTimers();
    const log = [];
    const state = {
        chatOpen: true,
        generating: false,
        composer: 'Hallo Welt',
        clickResult: true,
        clicks: 0,
        restores: 0,
        chat: [{ name: 'Bob', mes: 'Greeting' }, { name: 'User', mes: 'Hi', is_user: true }],
    };
    const host = {
        isChatOpen: () => state.chatOpen,
        isGenerating: () => state.generating,
        getComposerText: () => state.composer,
        clickSend: () => { state.clicks++; return state.clickResult; },
        getChatLength: () => state.chat.length,
        getRawMessage: (index) => state.chat[index] ?? null,
        disableStreamingOnce: () => (streaming ? () => { state.restores++; } : null),
        onEvent: (key, handler) => bus.on(key, handler),
    };
    const hold = {
        engage: (index) => log.push(['engage', index]),
        release: () => log.push(['release']),
        setStatus: (text, options) => log.push(['status', text, options]),
    };
    const notes = [];
    const notify = {
        warning: (msg) => notes.push(['warning', msg]),
        error: (msg) => notes.push(['error', msg]),
    };
    const failures = [];
    const replies = [];
    const controller = createSendWithImageController({
        host,
        precheck: precheck ?? (async () => {}),
        processReply: processReply ?? (async (index, signal) => { replies.push({ index, signal }); }),
        hold,
        notify,
        onFailure: onFailure ?? ((index, error) => failures.push({ index, error })),
        timers,
        config,
    });
    return { bus, timers, log, state, host, notes, failures, replies, controller };
}

// Appends the reply the host would push before MESSAGE_RECEIVED and returns its index.
export function pushReply(state, extra = {}) {
    state.chat.push({ name: 'Bob', mes: 'Answer', ...extra });
    return state.chat.length - 1;
}
