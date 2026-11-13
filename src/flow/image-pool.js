// Runs image jobs with a cap on requests in flight and hands out the pictures in the order they finish.
// Pure: the caller supplies `produce` and `discard`.

const DEFAULT_LIMIT = 4;

function swallow(callback, value) {
    try {
        const result = callback(value);
        if (result && typeof result.then === 'function') result.then(undefined, () => {});
    } catch {
        // A failed clean-up must not break the run; the picture is lost either way.
    }
}

export function createImagePool({ jobs, produce, limit = DEFAULT_LIMIT, signal, discard }) {
    const list = Array.isArray(jobs) ? jobs : [];
    const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
    const controller = new AbortController();
    const failures = [];
    const results = [];
    const waiting = [];
    let started = 0;
    let settled = 0;
    let aborted = false;

    const finished = () => aborted || settled === list.length;

    function release() {
        signal?.removeEventListener?.('abort', abort);
        while (waiting.length > 0) waiting.shift()(null);
    }

    function onSettled(index, outcome) {
        settled++;
        if (aborted) {
            // Uploaded pictures of a cancelled run are removed; their errors no longer matter.
            if ('value' in outcome && discard) swallow(discard, outcome.value);
        } else if ('value' in outcome) {
            const result = { index, job: list[index], value: outcome.value };
            if (waiting.length > 0) waiting.shift()(result);
            else results.push(result);
        } else {
            failures.push({ index, job: list[index], error: outcome.error });
        }
        fill();
        if (finished() && results.length === 0) release();
    }

    function launch(index) {
        let promise;
        try {
            promise = Promise.resolve(produce(list[index], index, controller.signal));
        } catch (error) {
            promise = Promise.reject(error);
        }
        promise.then((value) => onSettled(index, { value }), (error) => onSettled(index, { error }));
    }

    function fill() {
        while (!aborted && started < list.length && started - settled < max) launch(started++);
    }

    function abort() {
        if (aborted) return;
        aborted = true;
        controller.abort();
        const queued = results.splice(0);
        if (discard) for (const result of queued) swallow(discard, result.value);
        release();
    }

    function next() {
        if (results.length > 0) return Promise.resolve(results.shift());
        if (finished()) return Promise.resolve(null);
        return new Promise((resolve) => waiting.push(resolve));
    }

    if (signal?.aborted) abort();
    else {
        signal?.addEventListener?.('abort', abort, { once: true });
        fill();
    }

    return { total: list.length, failures, next, abort };
}
