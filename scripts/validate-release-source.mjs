import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `Git verification failed: ${args[0]}`);
  return result.stdout.trim();
}

export function assertReleaseTag({ root = '.', commit, tag }) {
  assert.match(commit ?? '', /^[0-9a-f]{40}$/i, 'A full release commit SHA is required');
  assert.match(tag ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'An exact version tag is required');
  const peeledCommit = git(root, ['rev-parse', '--verify', `${commit}^{commit}`]);
  assert.equal(git(root, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]), peeledCommit,
    'Release tag must exist and point to the workflow commit');
  return peeledCommit;
}

export function assertReleaseSource({ root = '.', commit, tag }) {
  assert.equal(git(root, ['rev-parse', '--is-shallow-repository']), 'false',
    'Release ancestry requires complete history (checkout fetch-depth: 0)');
  const peeledCommit = assertReleaseTag({ root, commit, tag });
  git(root, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', peeledCommit, 'refs/remotes/origin/main'],
    { cwd: root, encoding: 'utf8' });
  assert.equal(ancestry.status, 0, 'Release tag commit must be contained in origin/main history');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertReleaseSource({ commit: process.env.GITHUB_SHA, tag: process.env.RELEASE_TAG });
  console.log('Release tag commit belongs to main history.');
}
