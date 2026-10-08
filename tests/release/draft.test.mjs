import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectReleaseAssets, RELEASE_ASSET_NAMES } from '../../scripts/validate-release.mjs';
import { syncDraftRelease } from '../../scripts/sync-draft-release.mjs';

const tag = '0.1.0';
const commit = 'a'.repeat(40);
async function artifacts(t) {
  const dir = await mkdtemp(join(tmpdir(), 'mermaid-release-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sums = [];
  for (const name of RELEASE_ASSET_NAMES.filter((name) => name !== 'SHA256SUMS.txt')) {
    const bytes = Buffer.from(`validated fixture: ${name}`);
    await writeFile(join(dir, name), bytes);
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await writeFile(join(dir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  return { dir, assets: await inspectReleaseAssets(dir) };
}

function github(assets, { draft = true, absent = false, releaseId = 1 } = {}) {
  let release = absent ? undefined : { id: releaseId, tag_name: tag, draft, target_commitish: commit };
  let remote = assets.map((asset, i) => ({ id: i + 10, name: asset.name, size: asset.size, digest: asset.digest, state: 'uploaded' }));
  let nextId = 100;
  let reads = 0;
  const mutations = [];
  const client = {
    mutations,
    remote: () => remote,
    publishOnRead: undefined,
    omitUpload: false,
    badDigest: false,
    unexpectedAsset: false,
    listReleases: async () => release ? [structuredClone(release)] : [],
    getRelease: async () => {
      reads++;
      if (reads === client.publishOnRead) release.draft = false;
      return structuredClone(release);
    },
    createDraft: async (metadata) => {
      mutations.push({ type: 'create', metadata });
      release = { id: 1, ...metadata }; remote = [];
      return structuredClone(release);
    },
    listAssets: async () => structuredClone(remote),
    deleteAsset: async (id) => {
      mutations.push({ type: 'delete', id });
      remote = remote.filter((asset) => asset.id !== id);
    },
    uploadAsset: async (id, asset) => {
      mutations.push({ type: 'upload', id, name: asset.name });
      if (client.omitUpload) return;
      remote.push({ id: nextId++, name: asset.name, size: asset.size, state: 'uploaded',
        digest: client.badDigest ? `sha256:${'0'.repeat(64)}` : asset.digest });
    },
    updateDraft: async (id, metadata) => {
      mutations.push({ type: 'edit', id, metadata }); release = { ...release, ...metadata };
      // Reproduce GitHub's observed draft tag normalization when PATCH omits tag_name.
      release.tag_name = metadata.tag_name ?? 'untagged-f8c396541679ec809ff3';
      if (client.changeTagOnUpdate) release.tag_name = 'untagged-f8c396541679ec809ff3';
      if (client.changeIdOnUpdate) release.id++;
      if (client.publishOnUpdate) release.draft = false;
      if (client.unexpectedAsset) remote.push({ id: nextId++, name: 'unexpected.zip' });
    },
  };
  return client;
}
const refresh = (client, assets) => syncDraftRelease({ client, assets, tag, commit, title: 'Test release', notes: 'Test notes' });

test('draft with the exact validated assets passes without deleting matching assets', async (t) => {
  const { assets } = await artifacts(t);
  const client = github(assets);
  await refresh(client, assets);
  assert.deepEqual(client.mutations.map((item) => item.type), ['edit']);
  assert.deepEqual(client.remote().map((asset) => asset.name).sort(), [...RELEASE_ASSET_NAMES]);
});

test('metadata PATCH preserves the approved tag and original draft ID with matching assets', async (t) => {
  const { assets } = await artifacts(t);
  const client = github(assets, { releaseId: 406265576 });
  const originalAssets = structuredClone(client.remote());
  const id = await refresh(client, assets);
  assert.equal(id, 406265576);
  assert.deepEqual(client.mutations, [{ type: 'edit', id: 406265576,
    metadata: { tag_name: tag, target_commitish: commit, name: 'Test release', body: 'Test notes' } }]);
  assert.deepEqual(client.remote(), originalAssets);
});

test('tag, identity or published-state changes after metadata PATCH still fail closed', async (t) => {
  const { assets } = await artifacts(t);
  for (const [flag, message] of [
    ['changeTagOnUpdate', /Release tag changed/],
    ['changeIdOnUpdate', /Release identity changed/],
    ['publishOnUpdate', /Published releases cannot be changed/],
  ]) {
    const client = github(assets, { releaseId: 406265576 });
    client[flag] = true;
    await assert.rejects(refresh(client, assets), message);
    assert.deepEqual(client.mutations.map(({ type, id }) => ({ type, id })), [{ type: 'edit', id: 406265576 }]);
  }
});

test('draft removes obsolete assets and replaces files with stale hashes', async (t) => {
  const { assets } = await artifacts(t);
  const stale = assets.map((asset) => asset.name === 'main.js' ? { ...asset, digest: `sha256:${'0'.repeat(64)}` } : asset);
  const client = github([...stale, { name: 'old-main.js', size: 1, digest: 'obsolete' }]);
  const obsolete = client.remote().find((asset) => asset.name === 'old-main.js').id;
  await refresh(client, assets);
  assert.ok(client.mutations.some((item) => item.type === 'delete' && item.id === obsolete));
  assert.deepEqual(client.remote().map((asset) => asset.name).sort(), [...RELEASE_ASSET_NAMES]);
  assert.equal(client.remote().find((asset) => asset.name === 'main.js').digest, assets.find((asset) => asset.name === 'main.js').digest);
});

test('absent release is created as a draft with the complete validated set', async (t) => {
  const { assets } = await artifacts(t);
  const client = github([], { absent: true });
  await refresh(client, assets);
  assert.equal(client.mutations[0].metadata.draft, true);
  assert.equal(client.mutations[0].metadata.tag_name, tag);
  assert.deepEqual(client.remote().map((asset) => asset.name).sort(), [...RELEASE_ASSET_NAMES]);
});

test('published release cannot be edited, deleted or uploaded to', async (t) => {
  const { assets } = await artifacts(t);
  const client = github([...assets, { name: 'obsolete.js', size: 1, digest: 'obsolete' }], { draft: false });
  await assert.rejects(refresh(client, assets), /Published releases cannot be changed/);
  assert.deepEqual(client.mutations, []);
});

test('draft state is rechecked immediately before mutations', async (t) => {
  const { assets } = await artifacts(t);
  const client = github([...assets, { name: 'obsolete.js', size: 1, digest: 'obsolete' }]);
  client.publishOnRead = 2;
  await assert.rejects(refresh(client, assets), /Published releases cannot be changed/);
  assert.deepEqual(client.mutations, []);
});

test('API read errors fail closed without creating a replacement release', async (t) => {
  const { assets } = await artifacts(t);
  const client = github([], { absent: true });
  client.listReleases = async () => { throw new Error('API unavailable'); };
  await assert.rejects(refresh(client, assets), /API unavailable/);
  assert.deepEqual(client.mutations, []);
});

test('missing expected local assets fail before any release mutation', async (t) => {
  const { dir, assets } = await artifacts(t);
  const client = github(assets);
  await rm(join(dir, 'styles.css'));
  await assert.rejects(inspectReleaseAssets(dir), /exactly match/);
  await assert.rejects(refresh(client, assets.filter((asset) => asset.name !== 'styles.css')), /validated asset contract/);
  assert.deepEqual(client.mutations, []);
});

test('local hash mismatch and unvalidated attachment names are rejected', async (t) => {
  const { dir } = await artifacts(t);
  await writeFile(join(dir, 'main.js'), 'tampered');
  await assert.rejects(inspectReleaseAssets(dir), /hash mismatch/);
  await writeFile(join(dir, 'unexpected.zip'), 'not reviewed');
  await assert.rejects(inspectReleaseAssets(dir), /exactly match/);
});

test('checksum entries cannot contain duplicate names or traversal paths', async (t) => {
  const { dir } = await artifacts(t);
  const sums = await readFile(join(dir, 'SHA256SUMS.txt'), 'utf8');
  await writeFile(join(dir, 'SHA256SUMS.txt'), sums + sums.split('\n')[0] + '\n');
  await assert.rejects(inspectReleaseAssets(dir), /invalid SHA256SUMS/);
  await writeFile(join(dir, 'SHA256SUMS.txt'), sums.replace('main.js', '../main.js'));
  await assert.rejects(inspectReleaseAssets(dir), /invalid SHA256SUMS/);
});

test('missing uploaded assets, unexpected remote names and incorrect remote hashes all fail', async (t) => {
  const { assets } = await artifacts(t);
  const client = github([], { absent: true });
  client.omitUpload = true;
  await assert.rejects(refresh(client, assets), /Actual release assets differ/);
  const extra = github(assets); extra.unexpectedAsset = true;
  await assert.rejects(refresh(extra, assets), /Actual release assets differ/);
  const bad = github([], { absent: true }); bad.badDigest = true;
  await assert.rejects(refresh(bad, assets), /hash\/size\/state mismatch/);
});

test('upload failures fail instead of returning a verified draft', async (t) => {
  const { assets } = await artifacts(t);
  const client = github([], { absent: true });
  client.uploadAsset = async () => { throw new Error('Upload failed'); };
  await assert.rejects(refresh(client, assets), /Upload failed/);
  assert.ok(!client.mutations.some((item) => item.type === 'edit'));
});
