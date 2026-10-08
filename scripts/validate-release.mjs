import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// One asset contract for the build validator and GitHub draft synchronization.
export const RELEASE_ASSET_NAMES = Object.freeze([
  'LICENSE', 'SHA256SUMS.txt', 'THIRD_PARTY_NOTICES.txt', 'main.js', 'manifest.json', 'styles.css',
]);

export async function inspectReleaseAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...RELEASE_ASSET_NAMES],
    'Release assets must exactly match the validated asset contract');
  assert.ok(entries.every((entry) => entry.isFile()), 'Release assets must be regular files');
  const assets = await Promise.all(RELEASE_ASSET_NAMES.map(async (name) => {
    const path = `${dir}/${name}`;
    const bytes = await readFile(path);
    assert.ok(bytes.length > 0, `${name} must not be empty`);
    return { name, path, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  }));
  const expectedSums = assets.filter((asset) => asset.name !== 'SHA256SUMS.txt')
    .map((asset) => `${asset.digest.slice(7)}  ${asset.name}`).join('\n') + '\n';
  assert.equal(await readFile(`${dir}/SHA256SUMS.txt`, 'utf8'), expectedSums,
    'Asset hash mismatch or invalid SHA256SUMS entries');
  return assets;
}

export function validateMetadata(manifest, pkg, lock, versions, tag) {
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  for (const key of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) {
    assert.equal(typeof manifest[key], 'string', `manifest.${key} must be a string`);
    assert.ok(manifest[key].trim(), `manifest.${key} must not be empty`);
  }
  assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
  assert.ok(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'), 'Invalid plugin ID');
  assert.match(manifest.name, /^[A-Za-z0-9 ()+-]+$/);
  assert.ok(!/obsidian|obsi-|sidian|plugin/i.test(manifest.name), 'Invalid plugin name');
  assert.match(manifest.version, semver);
  assert.match(manifest.minAppVersion, semver);
  assert.equal(typeof manifest.isDesktopOnly, 'boolean');
  assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
  assert.match(manifest.description, /^[\x20-\x7E]+$/);
  assert.equal(pkg.version, manifest.version, 'package version mismatch');
  assert.equal(lock.version, manifest.version, 'lock version mismatch');
  assert.equal(lock.packages[''].version, manifest.version, 'lock root version mismatch');
  assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json mismatch');
  assert.equal(pkg.license, 'MIT');
  for (const key of ['authorUrl', 'fundingUrl']) {
    if (manifest[key] === undefined) continue;
    const urls = typeof manifest[key] === 'string' ? [manifest[key]] : Object.values(manifest[key]);
    assert.ok(urls.length > 0);
    for (const url of urls) assert.equal(new URL(url).protocol, 'https:');
  }
  if (tag) assert.equal(tag, manifest.version, 'Release tag must equal manifest version (no v prefix)');
}

export async function validateRelease({ root = '.', metadataOnly = false, tag = process.env.RELEASE_TAG } = {}) {
  const json = async (file) => JSON.parse(await readFile(`${root}/${file}`, 'utf8'));
  const [manifest, pkg, lock, versions] = await Promise.all([
    json('manifest.json'), json('package.json'), json('package-lock.json'), json('versions.json'),
  ]);
  validateMetadata(manifest, pkg, lock, versions, tag);
  if (metadataOnly) return;
  const dir = `${root}/dist/${manifest.id}`;
  const expected = RELEASE_ASSET_NAMES.filter((name) => name !== 'SHA256SUMS.txt');
  assert.deepEqual((await readdir(dir)).filter((f) => f !== 'SHA256SUMS.txt').sort(), expected.sort(),
    'Release directory must contain only reviewed assets');
  assert.deepEqual(JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8')), manifest, 'Built manifest is stale');
  const meta = await json('dist/build-meta.json');
  for (const output of Object.values(meta.outputs)) {
    for (const dep of output.imports) assert.equal(dep.path, 'obsidian', `Unexpected runtime dependency: ${dep.path}`);
  }
  assert.ok(!Object.keys(meta.inputs).some((f) => /node_modules\/obsidian\//.test(f)), 'Host API must remain external');
  const js = await readFile(`${dir}/main.js`, 'utf8');
  assert.ok(!js.includes('sourceMappingURL='), 'Production JS must not include source maps');
  assert.ok(js.includes('MIT License') && js.includes('Third-party notices'), 'Missing bundled license notices');
  const css = await readFile(`${dir}/styles.css`, 'utf8');
  assert.ok(!/url\(\s*["']?(?:https?:|\/\/|\.\/fonts\/)/i.test(css), 'Fonts/assets must be bundled');
  const sums = [];
  for (const name of expected.sort()) {
    const bytes = await readFile(`${dir}/${name}`);
    assert.ok(bytes.length > 0, `${name} must not be empty`);
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await writeFile(`${dir}/SHA256SUMS.txt`, `${sums.join('\n')}\n`);
  await inspectReleaseAssets(dir);
  console.log(`Validated ${manifest.id} ${manifest.version}; runtime imports: obsidian only.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await validateRelease({ metadataOnly: process.argv.includes('--metadata-only') });
}
