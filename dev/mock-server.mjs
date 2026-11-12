// Local stand-in for an OpenAI-compatible chat backend plus the NanoGPT and OpenRouter image APIs,
// so the full send + image flow can be tested without real keys or costs. Node built-ins only.
//   PORT (default 8124), MOCK_IMAGE_DELAY_MS (default 2500)

import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 8124;
const parsedDelay = Number.parseInt(process.env.MOCK_IMAGE_DELAY_MS ?? '', 10);
const IMAGE_DELAY_MS = Number.isFinite(parsedDelay) && parsedDelay >= 0 ? parsedDelay : 2500;

const IMAGE_PROMPT_ANSWER = 'a cozy tavern at night, warm lantern light';
const ROLEPLAY_ANSWER = 'Die Wirtin stellt dir lächelnd einen dampfenden Krug Met hin und setzt sich zu dir an den Tisch.';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

// 256x256 RGB gradient, so a broken decode or a swapped image is visible at a glance.
function createPng(size = 256) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type RGB
    const raw = Buffer.alloc(size * (1 + size * 3));
    for (let y = 0; y < size; y++) {
        const row = y * (1 + size * 3);
        raw[row] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            const p = row + 1 + x * 3;
            raw[p] = x;
            raw[p + 1] = y;
            raw[p + 2] = 160;
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

const PNG = createPng();
const PNG_BASE64 = PNG.toString('base64');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '600',
};

function sendJson(res, status, payload) {
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function chatAnswer(body) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const wantsImagePrompt = messages.some((m) => m?.role === 'system'
        && typeof m.content === 'string' && m.content.includes('image generator'));
    return wantsImagePrompt ? IMAGE_PROMPT_ANSWER : ROLEPLAY_ANSWER;
}

function handleChat(res, body) {
    const content = chatAnswer(body);
    const id = `chatcmpl-mock-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = body.model ?? 'mock-model';
    if (body.stream !== true) {
        sendJson(res, 200, {
            id, object: 'chat.completion', created, model,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
        return;
    }
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
    res.write(chunk({ role: 'assistant', content: '' }));
    for (const word of content.split(/(?<= )/)) res.write(chunk({ content: word }));
    res.write(chunk({}, 'stop'));
    res.end('data: [DONE]\n\n');
}

async function handleImage(req, res, url, body, provider) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) {
        sendJson(res, 401, { error: { message: 'Missing or invalid API key', type: 'authentication_error', code: 'unauthorized' } });
        return;
    }
    await sleep(IMAGE_DELAY_MS);
    if (String(body.prompt ?? '').includes('FAIL')) {
        sendJson(res, 500, { error: { message: 'mock failure' } });
        return;
    }
    if (provider === 'nanogpt') {
        if (url.searchParams.get('mode') === 'url') {
            sendJson(res, 200, { data: [{ url: `http://${req.headers.host}/static/image.png` }] });
        } else {
            sendJson(res, 200, { data: [{ b64_json: PNG_BASE64 }] });
        }
        return;
    }
    sendJson(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: PNG_BASE64, media_type: 'image/png' }] });
}

async function route(req, res, url) {
    const key = `${req.method} ${url.pathname}`;
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }
    if (key === 'GET /health') return sendJson(res, 200, { ok: true });
    if (key === 'GET /v1/models') {
        return sendJson(res, 200, { object: 'list', data: [{ id: 'mock-model', object: 'model', owned_by: 'mock' }] });
    }
    if (key === 'GET /static/image.png') {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'image/png', 'Content-Length': PNG.length });
        res.end(PNG);
        return;
    }
    const posts = {
        'POST /v1/chat/completions': (body) => handleChat(res, body),
        'POST /nanogpt/api/v1/images': (body) => handleImage(req, res, url, body, 'nanogpt'),
        'POST /openrouter/api/v1/images': (body) => handleImage(req, res, url, body, 'openrouter'),
    };
    if (!posts[key]) return sendJson(res, 404, { error: { message: `not found: ${key}` } });
    let body;
    try {
        body = await readJson(req);
    } catch {
        return sendJson(res, 400, { error: { message: 'invalid JSON body' } });
    }
    await posts[key](body);
}

const server = createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    res.on('finish', () => {
        console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} -> ${res.statusCode} (${Date.now() - started} ms)`);
    });
    route(req, res, url).catch((error) => {
        console.error('mock server error:', error);
        if (!res.headersSent) sendJson(res, 500, { error: { message: 'mock server error' } });
        else res.end();
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`mock server on http://127.0.0.1:${PORT} (image delay ${IMAGE_DELAY_MS} ms)`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
