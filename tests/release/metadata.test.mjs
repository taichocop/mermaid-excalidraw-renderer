import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateMetadata } from '../../scripts/validate-release.mjs';
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [manifest, pkg, lock, versions] = await Promise.all([
  json('manifest.json'), json('package.json'), json('package-lock.json'), json('versions.json'),
]);
test('release rejects version drift and prefixed tags before publication', () => {
  assert.doesNotThrow(() => validateMetadata(manifest, pkg, lock, versions, manifest.version));
  assert.throws(() => validateMetadata(manifest, { ...pkg, version: '9.9.9' }, lock, versions));
  assert.throws(() => validateMetadata(manifest, pkg, lock, {}, manifest.version));
  assert.throws(() => validateMetadata(manifest, pkg, lock, versions, `v${manifest.version}`));
});
test('release rejects invalid identities and malformed manifest fields', () => {
  for (const id of ['obsidian-renderer', 'renderer-plugin', 'Renderer', 'renderer_2']) {
    assert.throws(() => validateMetadata({ ...manifest, id }, pkg, lock, versions));
  }
  for (const name of ['Obsidian Renderer', 'Renderer Plugin', 'Renderer!']) {
    assert.throws(() => validateMetadata({ ...manifest, name }, pkg, lock, versions));
  }
  assert.throws(() => validateMetadata({ ...manifest, isDesktopOnly: 'true' }, pkg, lock, versions));
  assert.throws(() => validateMetadata({ ...manifest, description: 'Missing period' }, pkg, lock, versions));
});
