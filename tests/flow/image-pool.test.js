import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImagePool } from '../../src/flow/image-pool.js';
import { deferred, flush } from './fake-host.js';

// Every call of `produce` gets its own deferred, so a test settles the jobs in any order it likes.
function recorder() {
    const calls = [];
    let inFlight = 0;
    let peak = 0;
    const produce = (job, index, signal) => {
        const d = deferred();
        inFlight++;
        peak = Math.max(peak, inFlight);
        calls.push({ job, index, signal, ...d });
        d.promise.then(() => { inFlight--; }, () => { inFlight--; });
        return d.promise;
    };
    return { calls, produce, peak: () => peak };
}

test('total is the number of jobs; the first `limit` jobs start synchronously, in order', () => {
    const r = recorder();
    const pool = createImagePool({ jobs: ['a', 'b', 'c', 'd', 'e', 'f'], produce: r.produce, limit: 4 });
    assert.equal(pool.total, 6);
    assert.deepEqual(r.calls.map((c) => [c.job, c.index]), [['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
});

test('never more than `limit` in flight, the next job starts as soon as one settles, in start order', async () => {
    const r = recorder();
    const jobs = Array.from({ length: 10 }, (_, i) => `j${i}`);
    const pool = createImagePool({ jobs, produce: r.produce, limit: 3 });
    assert.equal(r.calls.length, 3);
    r.calls[1].resolve('v1');
    await flush();
    assert.deepEqual(r.calls.map((c) => c.index), [0, 1, 2, 3]);
    r.calls[0].reject(new Error('boom'));
    r.calls[2].resolve('v2');
    await flush();
    assert.deepEqual(r.calls.map((c) => c.index), [0, 1, 2, 3, 4, 5]);
    for (let i = 3; i < 10; i++) {
        r.calls[i].resolve(`v${i}`);
        await flush();
    }
    assert.equal(r.calls.length, 10);
    assert.ok(r.peak() <= 3, `peak ${r.peak()}`);
    assert.equal(pool.failures.length, 1);
});

test('the default limit is 4', () => {
    const r = recorder();
    createImagePool({ jobs: [1, 2, 3, 4, 5, 6], produce: r.produce });
    assert.equal(r.calls.length, 4);
});

test('next() gives results in arrival order, queued ones included, then null', async () => {
    const r = recorder();
    const pool = createImagePool({ jobs: ['a', 'b', 'c'], produce: r.produce, limit: 3 });
    r.calls[2].resolve('C');
    r.calls[0].resolve('A');
    await flush();
    assert.deepEqual(await pool.next(), { index: 2, job: 'c', value: 'C' });
    assert.deepEqual(await pool.next(), { index: 0, job: 'a', value: 'A' });
    const pending = pool.next();
    r.calls[1].resolve('B');
    assert.deepEqual(await pending, { index: 1, job: 'b', value: 'B' });
    assert.equal(await pool.next(), null);
    assert.equal(await pool.next(), null);
});

test('several pending next() calls are served in call order; the extra ones get null at the end', async () => {
    const r = recorder();
    const pool = createImagePool({ jobs: ['a', 'b'], produce: r.produce });
    const first = pool.next();
    const second = pool.next();
    const third = pool.next();
    r.calls[1].resolve('B');
    r.calls[0].resolve('A');
    assert.deepEqual(await first, { index: 1, job: 'b', value: 'B' });
    assert.deepEqual(await second, { index: 0, job: 'a', value: 'A' });
    assert.equal(await third, null);
});

test('no jobs: next() resolves null at once', async () => {
    const pool = createImagePool({ jobs: [], produce: () => { throw new Error('never'); } });
    assert.equal(pool.total, 0);
    assert.equal(await pool.next(), null);
});

test('failures are collected in order without stopping the other jobs', async () => {
    const r = recorder();
    const pool = createImagePool({ jobs: ['a', 'b', 'c', 'd'], produce: r.produce, limit: 2 });
    const e1 = new Error('first');
    const e2 = new Error('second');
    r.calls[1].reject(e1);
    await flush();
    r.calls[0].reject(e2);
    await flush();
    assert.deepEqual(pool.failures, [{ index: 1, job: 'b', error: e1 }, { index: 0, job: 'a', error: e2 }]);
    assert.equal(r.calls.length, 4);
    r.calls[2].resolve('C');
    r.calls[3].resolve('D');
    assert.deepEqual(await pool.next(), { index: 2, job: 'c', value: 'C' });
    assert.deepEqual(await pool.next(), { index: 3, job: 'd', value: 'D' });
    assert.equal(await pool.next(), null);
});

test('only failures: next() resolves null', async () => {
    const r = recorder();
    const pool = createImagePool({ jobs: ['a', 'b'], produce: r.produce });
    const pending = pool.next();
    r.calls[0].reject(new Error('x'));
    r.calls[1].reject(new Error('y'));
    assert.equal(await pending, null);
    assert.equal(pool.failures.length, 2);
});

test('a produce that throws synchronously counts as a failure', async () => {
    const error = new Error('sync');
    const pool = createImagePool({ jobs: ['a', 'b'], produce: (job) => { if (job === 'a') throw error; return Promise.resolve('B'); } });
    assert.deepEqual(await pool.next(), { index: 1, job: 'b', value: 'B' });
    assert.equal(await pool.next(), null);
    assert.deepEqual(pool.failures, [{ index: 0, job: 'a', error }]);
});

test('abort(): nothing new starts, the signal is aborted, queued and late results go to discard, pending next() is null', async () => {
    const r = recorder();
    const discarded = [];
    const pool = createImagePool({ jobs: ['a', 'b', 'c', 'd', 'e'], produce: r.produce, limit: 3, discard: (v) => discarded.push(v) });
    const signal = r.calls[0].signal;
    r.calls[0].resolve('A');
    await flush();
    assert.equal(r.calls.length, 4);
    const pending = pool.next();
    const pendingResult = await pending;
    assert.deepEqual(pendingResult, { index: 0, job: 'a', value: 'A' });
    r.calls[1].resolve('B');
    await flush();
    const waiting = pool.next();
    const waiting2 = pool.next();
    assert.deepEqual(await waiting, { index: 1, job: 'b', value: 'B' });
    r.calls[2].resolve('C');
    await flush();
    assert.equal(r.calls.length, 5);
    assert.deepEqual(await waiting2, { index: 2, job: 'c', value: 'C' });

    r.calls[3].resolve('D');
    await flush();
    const before = pool.next();
    assert.deepEqual(await before, { index: 3, job: 'd', value: 'D' });
    const hanging = pool.next();
    pool.abort();
    assert.equal(await hanging, null);
    assert.equal(signal.aborted, true);
    assert.ok(r.calls.every((c) => c.signal === signal));
    r.calls[4].resolve('E');
    await flush();
    assert.deepEqual(discarded, ['E']);
    assert.equal(await pool.next(), null);
});

test('abort() hands queued results to discard, stops new starts, ignores later failures; twice is harmless', async () => {
    const r = recorder();
    const discarded = [];
    const pool = createImagePool({ jobs: ['a', 'b', 'c', 'd', 'e', 'f'], produce: r.produce, limit: 3, discard: (v) => discarded.push(v) });
    r.calls[0].resolve('A');
    r.calls[1].resolve('B');
    await flush();
    assert.equal(r.calls.length, 5);
    pool.abort();
    pool.abort();
    assert.deepEqual(discarded, ['A', 'B']);
    assert.equal(r.calls[0].signal.aborted, true);
    r.calls[2].resolve('C');
    r.calls[3].reject(new Error('late'));
    r.calls[4].resolve('E');
    await flush();
    assert.equal(r.calls.length, 5);
    assert.deepEqual(discarded, ['A', 'B', 'C', 'E']);
    assert.deepEqual(pool.failures, []);
    assert.equal(await pool.next(), null);
});

test('abort() without discard drops the results quietly', async () => {
    const r = recorder();
    const pool = createImagePool({ jobs: ['a', 'b'], produce: r.produce });
    r.calls[0].resolve('A');
    await flush();
    pool.abort();
    r.calls[1].resolve('B');
    await flush();
    assert.equal(await pool.next(), null);
});

test('an abort of the outer signal works like abort()', async () => {
    const r = recorder();
    const outer = new AbortController();
    const discarded = [];
    const pool = createImagePool({ jobs: ['a', 'b', 'c'], produce: r.produce, limit: 2, signal: outer.signal, discard: (v) => discarded.push(v) });
    r.calls[0].resolve('A');
    await flush();
    assert.equal(r.calls.length, 3);
    const pending = pool.next();
    assert.deepEqual(await pending, { index: 0, job: 'a', value: 'A' });
    const hanging = pool.next();
    outer.abort();
    assert.equal(await hanging, null);
    assert.equal(r.calls[1].signal.aborted, true);
    r.calls[1].resolve('B');
    r.calls[2].resolve('C');
    await flush();
    assert.deepEqual(discarded, ['B', 'C']);
});

test('an outer signal that is already aborted starts nothing', async () => {
    const r = recorder();
    const outer = new AbortController();
    outer.abort();
    const pool = createImagePool({ jobs: ['a', 'b'], produce: r.produce, signal: outer.signal });
    assert.equal(r.calls.length, 0);
    assert.equal(pool.total, 2);
    assert.equal(await pool.next(), null);
});

test('a discard that throws or rejects is swallowed', async () => {
    const r = recorder();
    let calls = 0;
    const pool = createImagePool({
        jobs: ['a', 'b', 'c'],
        produce: r.produce,
        discard: (v) => { calls++; if (v === 'A') throw new Error('sync'); return Promise.reject(new Error('async')); },
    });
    r.calls[0].resolve('A');
    await flush();
    assert.doesNotThrow(() => pool.abort());
    r.calls[1].resolve('B');
    r.calls[2].resolve('C');
    await flush();
    await flush();
    assert.equal(calls, 3);
    assert.equal(await pool.next(), null);
});
