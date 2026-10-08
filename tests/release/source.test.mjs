import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertReleaseSource, assertReleaseTag } from '../../scripts/validate-release-source.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'mermaid-release-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  await writeFile(join(root, 'fixture'), 'A');
  git('add', 'fixture'); git('commit', '--quiet', '-m', 'A');
  const ancestor = git('rev-parse', 'HEAD');
  git('tag', '0.1.0');
  await writeFile(join(root, 'fixture'), 'B');
  git('commit', '--quiet', '-am', 'B');
  const head = git('rev-parse', 'HEAD');
  git('tag', '-a', '0.2.0', '-m', 'Annotated release');
  git('update-ref', 'refs/remotes/origin/main', head);
  git('checkout', '--quiet', '-b', 'unmerged', ancestor);
  await writeFile(join(root, 'fixture'), 'X');
  git('commit', '--quiet', '-am', 'X');
  const unmerged = git('rev-parse', 'HEAD');
  git('tag', '0.3.0');
  git('checkout', '--quiet', 'main');
  return { root, git, ancestor, head, unmerged };
}

test('release source accepts an older main ancestor and main HEAD, including annotated tags', async (t) => {
  const { root, git, ancestor, head } = await repository(t);
  assert.doesNotThrow(() => assertReleaseSource({ root, commit: ancestor, tag: '0.1.0' }));
  assert.doesNotThrow(() => assertReleaseSource({ root, commit: head, tag: '0.2.0' }));
  assert.doesNotThrow(() => assertReleaseSource({ root, commit: git('rev-parse', 'refs/tags/0.2.0'), tag: '0.2.0' }));
});

test('release source rejects a valid version tag on an unmerged branch', async (t) => {
  const { root, unmerged } = await repository(t);
  assert.throws(() => assertReleaseSource({ root, commit: unmerged, tag: '0.3.0' }), /origin\/main history/);
});

test('release source rejects absent main, absent tags and tag/commit mismatch', async (t) => {
  const { root, git, ancestor, head } = await repository(t);
  assert.throws(() => assertReleaseTag({ root, commit: head, tag: '0.1.0' }), /workflow commit/);
  assert.throws(() => assertReleaseTag({ root, commit: head, tag: '9.9.9' }), /Git verification failed/);
  assert.throws(() => assertReleaseTag({ root, commit: head, tag: 'v0.2.0' }), /exact version tag/);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.throws(() => assertReleaseSource({ root, commit: ancestor, tag: '0.1.0' }), /Git verification failed/);
});

test('release source fails closed for shallow history instead of guessing ancestry', async (t) => {
  const { root, head } = await repository(t);
  const clone = join(root, 'shallow');
  execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${root}`, clone], { stdio: 'pipe' });
  assert.throws(() => assertReleaseSource({ root: clone, commit: head, tag: '0.2.0' }), /complete history/);
});
