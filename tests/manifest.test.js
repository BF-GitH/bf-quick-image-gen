// The host loads the extension purely from manifest.json, so a dangling path breaks it silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('manifest js and css point at existing files', () => {
    for (const key of ['js', 'css']) {
        assert.equal(typeof manifest[key], 'string', `manifest.${key} must be a string`);
        assert.ok(existsSync(join(ROOT, manifest[key])), `manifest.${key} -> ${manifest[key]} does not exist`);
    }
});

test('manifest has no required host modules', () => {
    assert.deepEqual(manifest.requires, []);
});

test('manifest version equals package.json version', () => {
    assert.equal(manifest.version, pkg.version);
});
