import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inspectReleaseAssets, RELEASE_ASSET_NAMES, validateMetadata } from './validate-release.mjs';
import { assertReleaseTag } from './validate-release-source.mjs';

function assertDraft(release, tag, id = release?.id) {
  assert.ok(Number.isSafeInteger(id) && id > 0, 'Invalid release ID');
  assert.equal(release.id, id, 'Release identity changed');
  assert.equal(release.tag_name, tag, 'Release tag changed');
  assert.equal(release.draft, true, 'Published releases cannot be changed; use a new version');
}

function assetNames(assets) {
  assert.ok(Array.isArray(assets), 'Invalid release assets response');
  for (const asset of assets) {
    assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0, 'Invalid asset ID');
    assert.ok(typeof asset.name === 'string' && asset.name.length > 0, 'Invalid asset name');
  }
  const names = assets.map((asset) => asset.name).sort();
  assert.equal(new Set(names).size, names.length, 'Duplicate release asset names');
  assert.equal(new Set(assets.map((asset) => asset.id)).size, assets.length, 'Duplicate release asset IDs');
  return names;
}

function sameAsset(actual, expected) {
  return actual?.state === 'uploaded' && actual.size === expected.size && actual.digest === expected.digest;
}

export function releaseNotes(changelog, tag) {
  const sections = [...changelog.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  const matches = sections.filter((section) => section[1].trim() === `[${tag}]`);
  assert.equal(matches.length, 1, `CHANGELOG.md must contain exactly one ## [${tag}] section`);
  const section = matches[0];
  const next = sections[sections.indexOf(section) + 1];
  const notes = changelog.slice(section.index + section[0].length, next?.index).trim();
  assert.ok(notes.length > 0, `CHANGELOG.md release notes are empty for ${tag}`);
  return notes + '\n';
}

// API reads and all mutations are injected so failure/partial-upload cases can be tested offline.
export async function syncDraftRelease({ client, tag, commit, title, notes, assets }) {
  assert.deepEqual(assets.map((asset) => asset.name).sort(), [...RELEASE_ASSET_NAMES],
    'Expected assets must match the validated asset contract');
  const releases = await client.listReleases(); // Auth/API errors must not be treated as "no release".
  assert.ok(Array.isArray(releases), 'Invalid releases response');
  const matches = releases.filter((release) => release.tag_name === tag);
  assert.ok(matches.length <= 1, 'Multiple releases found for the tag');
  let release = matches[0];
  if (release) assertDraft(release, tag);
  else release = await client.createDraft({ tag_name: tag, target_commitish: commit, name: title, body: notes, draft: true });
  assertDraft(release, tag);
  const id = release.id;
  const requireDraft = async () => assertDraft(await client.getRelease(id), tag, id);
  await requireDraft();
  const existing = await client.listAssets(id);
  assetNames(existing);
  const expectedNames = new Set(assets.map((asset) => asset.name));
  for (const asset of existing.filter((asset) => !expectedNames.has(asset.name))) {
    await requireDraft();
    await client.deleteAsset(asset.id);
  }
  for (const asset of assets) {
    const previous = existing.find((candidate) => candidate.name === asset.name);
    if (sameAsset(previous, asset)) continue;
    if (previous) {
      await requireDraft();
      await client.deleteAsset(previous.id);
    }
    await requireDraft();
    await client.uploadAsset(id, asset);
  }
  await requireDraft();
  await client.updateDraft(id, { tag_name: tag, target_commitish: commit, name: title, body: notes });
  const actual = await client.listAssets(id); // Refetch ALL pages; never trust only upload responses.
  assert.deepEqual(assetNames(actual), [...RELEASE_ASSET_NAMES], 'Actual release assets differ from validated assets');
  for (const asset of assets) {
    assert.ok(sameAsset(actual.find((candidate) => candidate.name === asset.name), asset),
      `Release asset hash/size/state mismatch: ${asset.name}`);
  }
  await requireDraft();
  return id;
}

export function createGitHubClient(repo) {
  assert.match(repo ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid GITHUB_REPOSITORY');
  const base = `repos/${repo}/releases`;
  const request = (method, endpoint, { json, inputFile, paginate = false, binary = false } = {}) => {
    const args = ['api', endpoint, '--method', method, '--header', 'Accept: application/vnd.github+json',
      '--header', 'X-GitHub-Api-Version: 2026-03-10'];
    if (paginate) args.push('--paginate', '--slurp');
    if (json !== undefined) args.push('--input', '-');
    if (inputFile) args.push('--input', inputFile);
    if (binary) args.push('--header', 'Content-Type: application/octet-stream');
    const result = spawnSync('gh', args, { encoding: 'utf8', input: json === undefined ? undefined : JSON.stringify(json),
      maxBuffer: 32 * 1024 * 1024 });
    // Never print credentials, request bodies, environment variables or raw CLI error output.
    assert.equal(result.status, 0, `GitHub ${method} request failed`);
    const response = result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
    if (!paginate) return response;
    assert.ok(Array.isArray(response) && response.every(Array.isArray), 'Invalid paginated API response');
    return response.flat();
  };
  return {
    listReleases: async () => request('GET', `${base}?per_page=100`, { paginate: true }),
    getRelease: async (id) => request('GET', `${base}/${id}`),
    createDraft: async (metadata) => request('POST', base, { json: metadata }),
    listAssets: async (id) => request('GET', `${base}/${id}/assets?per_page=100`, { paginate: true }),
    deleteAsset: async (id) => request('DELETE', `${base}/assets/${id}`),
    uploadAsset: async (id, asset) => request('POST',
      `https://uploads.github.com/${base}/${id}/assets?name=${encodeURIComponent(asset.name)}`,
      { inputFile: asset.path, binary: true }),
    updateDraft: async (id, metadata) => request('PATCH', `${base}/${id}`, { json: metadata }),
  };
}

async function main() {
  const tag = process.env.RELEASE_TAG;
  const commit = assertReleaseTag({ tag, commit: process.env.GITHUB_SHA }); // Preserve --verify-tag semantics.
  const json = async (name) => JSON.parse(await readFile(name, 'utf8'));
  const [manifest, pkg, lock, versions] = await Promise.all([
    json('manifest.json'), json('package.json'), json('package-lock.json'), json('versions.json'),
  ]);
  validateMetadata(manifest, pkg, lock, versions, tag);
  const assets = await inspectReleaseAssets('release-assets'); // Validate names AND checksum contents before any API mutation.
  assert.deepEqual(await json('release-assets/manifest.json'), manifest, 'Uploaded manifest must match source manifest');
  const notes = releaseNotes(await readFile('CHANGELOG.md', 'utf8'), tag);
  await syncDraftRelease({ client: createGitHubClient(process.env.GITHUB_REPOSITORY), tag, commit,
    title: `${manifest.name} ${tag}`, notes, assets });
  console.log(`Verified draft ${tag}: exact validated asset names, sizes and SHA-256 digests.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
