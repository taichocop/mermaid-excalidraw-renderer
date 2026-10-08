import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { hash } from '../../scripts/agent-loop/core.mjs';
const runner = resolve('scripts/agent-loop/run.mjs');
function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-artifact-')), work = join(root, 'work'), loop = join(root, 'loop');
  mkdirSync(work); mkdirSync(loop);
  const git = args => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: work, encoding: 'utf8' }).trim();
  git(['init', '-q']); writeFileSync(join(work, 'file.txt'), 'before\n'); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base']);
  const headSha = git(['rev-parse', 'HEAD']), output = join(root, 'step-output');
  const run = command => spawnSync(process.execPath, [runner, command], { cwd: root, encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: '', AGENT_LOOP_INTERACTIVE: 'false', PR_NUMBER: '1',
      LOOP_DIR: loop, WORK_DIR: work, GITHUB_OUTPUT: output, REVIEW_START_GRACE_PERIOD_SECONDS: '420' } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { work, loop, git, headSha, run, output };
}
test('fresh validation applies only the candidate and attests the exact canonical patch/tree', t => {
  const h = checkout(t);
  writeFileSync(join(h.work, 'file.txt'), 'after\n'); const patch = h.git(['diff', '--binary', 'HEAD']) + '\n';
  h.git(['restore', '.']);
  writeFileSync(join(h.loop, 'candidate.json'), JSON.stringify({ patch, patchHash: hash(patch), plan: { mode: 'fix', headSha: h.headSha } }));
  const applied = h.run('materialize'); assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(h.work, 'file.txt'), 'utf8'), 'after\n');
  const attested = h.run('attest'); assert.equal(attested.status, 0, attested.stderr);
  const result = JSON.parse(readFileSync(join(h.loop, 'validated.json')));
  assert.equal(result.treeSha, h.git(['write-tree'])); assert.equal(result.patchHash, hash(result.patch));
  assert.equal(result.validation.headSha, h.headSha);
});
test('post-application mutation makes validation attestation fail', t => {
  const h = checkout(t);
  const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+after\n';
  writeFileSync(join(h.loop, 'candidate.json'), JSON.stringify({ patch, patchHash: hash(patch), plan: { headSha: h.headSha } }));
  assert.equal(h.run('materialize').status, 0);
  writeFileSync(join(h.work, 'file.txt'), 'changed after validation\n');
  assert.notEqual(h.run('attest').status, 0);
});
test('protected control-plane patch and tampered digest fail before application', t => {
  const h = checkout(t);
  const patch = 'diff --git a/.github/workflows/evil.yml b/.github/workflows/evil.yml\nnew file mode 100644\n--- /dev/null\n+++ b/.github/workflows/evil.yml\n@@ -0,0 +1 @@\n+name: evil\n';
  writeFileSync(join(h.loop, 'candidate.json'), JSON.stringify({ patch, patchHash: hash(patch), plan: { headSha: h.headSha } }));
  const result = h.run('materialize'); assert.notEqual(result.status, 0); assert.match(result.stderr, /protected-path/);
  writeFileSync(join(h.loop, 'candidate.json'), JSON.stringify({ patch: '', patchHash: 'forged', plan: { headSha: h.headSha } }));
  const forged = h.run('materialize'); assert.notEqual(forged.status, 0); assert.match(forged.stderr, /digest mismatch/);
});
test('publisher downloads original candidate by immutable ID independently of validation', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/agent-loop-iteration.yml', import.meta.url), 'utf8');
  const publisher = workflow.split('  publish:')[1].split('  certify:')[0];
  assert.match(publisher, /needs.candidate.outputs.artifact_id/); assert.match(publisher, /needs.validate.outputs.artifact_id/);
  assert.doesNotMatch(publisher, /npm |openai\/codex-action/);
});
test('renaming a protected preimage to an ordinary destination fails before workspace mutation', t => {
  const h = checkout(t);
  mkdirSync(join(h.work, '.github/workflows'), { recursive: true });
  writeFileSync(join(h.work, '.github/workflows/ci.yml'), 'name: Validate\n');
  h.git(['add', '.']); h.git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'workflow']);
  const headSha = h.git(['rev-parse', 'HEAD']);
  h.git(['mv', '.github/workflows/ci.yml', 'ci.yml']); const patch = h.git(['diff', '--binary', 'HEAD']) + '\n';
  h.git(['reset', '--hard', headSha]);
  writeFileSync(join(h.loop, 'candidate.json'), JSON.stringify({ patch, patchHash: hash(patch), plan: { headSha } }));
  const result = h.run('materialize'); assert.notEqual(result.status, 0); assert.match(result.stderr, /protected-path/);
  assert.equal(readFileSync(join(h.work, '.github/workflows/ci.yml'), 'utf8'), 'name: Validate\n');
  assert.equal(h.git(['status', '--porcelain']), '');
});
test('the secret-bearing fix runner does not execute PR package scripts before Codex', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/agent-loop-iteration.yml', import.meta.url), 'utf8');
  const fix = workflow.split('  fix:')[1].split('  candidate:')[0];
  assert.doesNotMatch(fix, /run:.*(?:npm|npx|yarn|pnpm)/);
});
test('gitlink additions are rejected and expose the protected failure classification', t => {
  const h = checkout(t);
  const patch = 'diff --git a/dependency b/dependency\nnew file mode 160000\nindex 0000000..aaaaaaa\n--- /dev/null\n+++ b/dependency\n@@ -0,0 +1 @@\n+Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
  writeFileSync(join(h.loop, 'candidate.json'), JSON.stringify({ patch, patchHash: hash(patch), plan: { headSha: h.headSha } }));
  const result = h.run('materialize'); assert.notEqual(result.status, 0); assert.match(result.stderr, /protected-path/);
  assert.match(readFileSync(h.output, 'utf8'), /failure_kind=protected-path/);
  assert.equal(h.git(['status', '--porcelain']), '');
});
test('failure job carries protected-path outputs and plan can reclaim terminated Actions leases', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/agent-loop-iteration.yml', import.meta.url), 'utf8');
  const plan = workflow.split('  plan:')[1].split('  analyze:')[0]; assert.match(plan, /actions: read/);
  const validator = workflow.split('  validate:')[1].split('  publish:')[0];
  assert.match(validator, /failure_kind:.*steps.materialize.outputs.failure_kind/);
  assert.match(workflow.split('  failure:')[1], /FAILURE_KIND:.*needs.validate.outputs.failure_kind.*needs.publish.outputs.failure_kind/);
});
