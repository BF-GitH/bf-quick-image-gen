// Static guard for the layering and module rules of dev/SPEC.md sections 3 and 7.
// Pure text scan: nothing under src/ is imported, so host globals never need to exist here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINES = 400;

const PURE_FORBIDDEN = [
    ['document', /\bdocument\b/], ['window', /\bwindow\b/], ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/], ['SillyTavern', /\bSillyTavern\b/], ['toastr', /\btoastr\b/],
    ['jQuery', /\bjQuery\b/], ['$(', /(^|[^\w$])\$\(/],
];
const WIRING_FORBIDDEN = [
    ['SillyTavern', /\bSillyTavern\b/], ['__TAURITAVERN__', /__TAURITAVERN__/], ['toastr', /\btoastr\b/],
    ['a string starting with /api/', /['"`]\/api\//],
];
const PURE_FILES = new Set([
    'src/prompt/scene.js', 'src/flow/run-state.js', 'src/flow/messages.js', 'src/flow/preflight.js',
    'src/flow/parallel-run.js', 'src/gallery/records.js', 'src/settings/defaults.js', 'src/references/select.js',
    'src/prompt/pictures.js', 'src/flow/image-pool.js', 'src/gallery/chat-diff.js',
]);

// Removes // and /* */ comments while keeping strings, regex literals and nested template expressions intact.
function stripComments(src) {
    let out = '';
    let i = 0;
    let lastSignificant = '';
    const stack = [{ type: 'code', depth: 0 }];
    const top = () => stack[stack.length - 1];
    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];
        if (top().type === 'template') {
            if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
            if (ch === '`') { stack.pop(); out += ch; i++; lastSignificant = '`'; continue; }
            if (ch === '$' && next === '{') { stack.push({ type: 'code', depth: 0 }); out += '${'; i += 2; lastSignificant = '{'; continue; }
            out += ch; i++; continue;
        }
        if (ch === '/' && next === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end === -1 ? src.length : end + 2;
            out += src.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
            continue;
        }
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
            out += src.slice(i, j + 1); i = j + 1; lastSignificant = ch; continue;
        }
        if (ch === '`') { stack.push({ type: 'template' }); out += ch; i++; continue; }
        if (ch === '/' && (lastSignificant === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant) || /\b(return|typeof|case|in|of)$/.test(out.slice(-16).trimEnd()))) {
            let j = i + 1;
            let inClass = false;
            while (j < src.length && src[j] !== '\n') {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if (src[j] === '/' && !inClass) break;
                j++;
            }
            out += src.slice(i, j + 1); i = j + 1; lastSignificant = 'a'; continue;
        }
        if (ch === '{') top().depth++;
        if (ch === '}') {
            if (stack.length > 1 && top().depth === 0) { stack.pop(); out += ch; i++; continue; }
            top().depth--;
        }
        if (!/\s/.test(ch)) lastSignificant = /[\w$]/.test(ch) ? 'a' : ch;
        out += ch; i++;
    }
    return out;
}

function collectExports(code) {
    const names = new Set();
    for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) names.add(m[1]);
    for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop().trim();
            if (name) names.add(name);
        }
    }
    if (/\bexport\s+default\b/.test(code)) names.add('default');
    const starFrom = [...code.matchAll(/\bexport\s*\*\s*from\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
    return { names, starFrom };
}

function collectImports(code) {
    const imports = [];
    for (const m of code.matchAll(/\bimport\s+([\w$*{][^;]*?)\s+from\s*(['"])([^'"]+)\2/g)) {
        imports.push({ specifier: m[3], names: parseClause(m[1]) });
    }
    for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) imports.push({ specifier: m[2], names: [] });
    for (const m of code.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)) imports.push({ specifier: m[2], names: [] });
    for (const m of code.matchAll(/\bexport\s+(\*|\{[^}]*\})\s*from\s*(['"])([^'"]+)\2/g)) {
        imports.push({ specifier: m[3], names: m[1] === '*' ? [] : parseClause(m[1]) });
    }
    return imports;
}

function parseClause(clause) {
    const names = [];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
        for (const part of braces[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].trim();
            if (name) names.push(name);
        }
    }
    const head = clause.replace(/\{[^}]*\}/, '').split(',')[0].trim();
    if (head && !head.startsWith('*')) names.push('default');
    return names;
}

function layerOf(rel) {
    if (rel.startsWith('src/shared/') || rel.startsWith('src/providers/') || PURE_FILES.has(rel)) return 'PURE';
    if (rel.startsWith('src/host/')) return 'HOST';
    return 'WIRING';
}

function isHostModuleSpecifier(spec) {
    return spec.includes('script.js') || spec.includes('/scripts/') || spec.startsWith('../../../');
}

// Returns human-readable violations for one file; `files` maps repo paths to { raw, code }.
function checkFile(rel, files) {
    const out = [];
    const { raw, code } = files.get(rel);
    const lines = raw.split(/\r?\n/).length - (raw.endsWith('\n') ? 1 : 0);
    if (lines > MAX_LINES) out.push(`${rel}: ${lines} lines (limit ${MAX_LINES})`);
    const layer = layerOf(rel);
    const forbidden = layer === 'PURE' ? PURE_FORBIDDEN : layer === 'WIRING' ? WIRING_FORBIDDEN : [];
    for (const [label, re] of forbidden) {
        if (re.test(code)) out.push(`${rel}: ${layer} file contains forbidden ${label}`);
    }
    for (const { specifier, names } of collectImports(code)) {
        if (isHostModuleSpecifier(specifier)) {
            out.push(`${rel}: imports host module "${specifier}"`);
            continue;
        }
        if (!specifier.startsWith('.')) continue;
        const target = relative(ROOT, resolve(ROOT, dirname(rel), specifier)).split(sep).join('/');
        if (!files.has(target)) {
            out.push(`${rel}: import "${specifier}" -> ${target} does not exist`);
            continue;
        }
        const targetLayer = layerOf(target);
        if (layer === 'PURE' && targetLayer !== 'PURE') out.push(`${rel}: PURE file imports ${targetLayer} file ${target}`);
        if (layer === 'HOST' && !target.startsWith('src/host/') && !target.startsWith('src/shared/')) {
            out.push(`${rel}: HOST file imports ${target} (only src/host and src/shared allowed)`);
        }
        const exported = resolveExports(target, files, new Set());
        for (const name of names) {
            if (!exported.has(name)) out.push(`${rel}: imports "${name}" which ${target} does not export`);
        }
    }
    return out;
}

function resolveExports(rel, files, seen) {
    if (seen.has(rel) || !files.has(rel)) return new Set();
    seen.add(rel);
    const { names, starFrom } = collectExports(files.get(rel).code);
    const all = new Set(names);
    for (const spec of starFrom) {
        const target = relative(ROOT, resolve(ROOT, dirname(rel), spec)).split(sep).join('/');
        for (const name of resolveExports(target, files, seen)) if (name !== 'default') all.add(name);
    }
    return all;
}

function listSourceFiles() {
    const result = [];
    const walk = (dir) => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            const rel = `${dir}/${entry}`;
            if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
            else if (rel.endsWith('.js')) result.push(rel);
        }
    };
    if (existsSync(join(ROOT, 'src'))) walk('src');
    if (existsSync(join(ROOT, 'index.js'))) result.push('index.js');
    return result.sort();
}

function loadFiles(entries) {
    return new Map(entries.map(([rel, raw]) => [rel, { raw, code: stripComments(raw) }]));
}

test('scanner keeps strings and regex literals, drops comments', () => {
    const code = stripComments([
        "const u = 'https://x.y/api'; // window",
        'const r = /(^|[\\/-])edit([\\/-]|$)/i; /* document */',
        'const t = `a ${[1].map((n) => `//${n}`)} b`; // jQuery',
    ].join('\n'));
    assert.match(code, /https:\/\/x\.y\/api/);
    assert.match(code, /`\/\/\$\{n\}`/);
    assert.doesNotMatch(code, /window|document|jQuery/);
});

test('scanner detects every rule on synthetic files', () => {
    const files = loadFiles([
        ['src/shared/a.js', "export const A = 1;\nexport { A as B };\nexport async function f() {}\n"],
        ['src/host/h.js', "import { x } from '../flow/w.js';\nexport class H {}\n"],
        ['src/providers/p.js', "import { H } from '../host/h.js';\nimport { B, C } from '../shared/a.js';\nimport '../../../../script.js';\ndocument.title = 'x';\n"],
        ['src/flow/w.js', "import * as ns from '../shared/a.js';\nimport { f } from './gone.js';\nfetch('/api/x'); toastr.info(ns);\nexport const x = 1;\n"],
        ['src/big.js', 'x\n'.repeat(401)],
    ]);
    const all = [...files.keys()].flatMap((rel) => checkFile(rel, files));
    const expected = [
        'src/host/h.js: HOST file imports src/flow/w.js',
        'src/providers/p.js: PURE file imports HOST file src/host/h.js',
        'src/providers/p.js: imports "C" which src/shared/a.js does not export',
        'src/providers/p.js: imports host module',
        'src/providers/p.js: PURE file contains forbidden document',
        'src/flow/w.js: import "./gone.js"',
        'src/flow/w.js: WIRING file contains forbidden toastr',
        'src/flow/w.js: WIRING file contains forbidden a string starting with /api/',
        'src/big.js: 401 lines',
    ];
    for (const fragment of expected) assert.ok(all.some((v) => v.startsWith(fragment)), `missing: ${fragment}\n${all.join('\n')}`);
    assert.equal(all.length, expected.length, all.join('\n'));
});

test('index.js and src/** follow the layering and module rules', () => {
    const rels = listSourceFiles();
    assert.ok(rels.includes('index.js'), 'index.js is missing');
    const files = loadFiles(rels.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]));
    const violations = rels.flatMap((rel) => checkFile(rel, files));
    assert.deepEqual(violations, [], `\n${violations.join('\n')}`);
});
