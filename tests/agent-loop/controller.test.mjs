import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteractiveHandoff } from '../../scripts/agent-loop/interactive-handoff.mjs';
import { AgentLoop } from '../../scripts/agent-loop/service.mjs';
import { CODEX_IDENTITY, initialState, hash } from '../../scripts/agent-loop/core.mjs';
const sha = 'a'.repeat(40), next = 'b'.repeat(40);
const actor = { login: CODEX_IDENTITY.login, id: Number(CODEX_IDENTITY.id), type: 'Bot' };
const app = { id: Number(CODEX_IDENTITY.appId), slug: CODEX_IDENTITY.appSlug };

class FakeGitHub {
  repository = 'owner/repo';
  record = { value: null, sha: null };
  phase = 'completed'; summarySha = sha; green = true; comments = []; threadsData = []; posts = []; mutations = [];
  pr = { number: 1, state: 'open', draft: false, mergeable: true, labels: [{ name: 'agent-loop' }],
    head: { sha, ref: 'codex/fix', repo: { full_name: 'owner/repo' } },
    base: { sha: 'base', ref: 'main', repo: { full_name: 'owner/repo' } } };
  async repo(path) {
    if (path === '/pulls/1') return structuredClone(this.pr);
    if (path.startsWith('/commits/')) return { sha: this.summarySha };
    if (path.startsWith('/actions/runs/')) return { status: 'completed' };
    throw new Error(`Unexpected API ${path}`);
  }
  async pages(path) {
    if (path === '/pulls/1/reviews') return this.phase === 'not-started' ? []
      : [{ id: 7, user: actor, commit_id: this.summarySha, submitted_at: '2026-10-08T00:00:00Z', state: 'COMMENTED', body: 'Summary' }];
    if (path === '/pulls/1/comments') return structuredClone(this.comments);
    if (path === '/issues/1/comments') return this.phase === 'not-started' ? [] : [{
      id: 8, user: actor, performed_via_github_app: app, updated_at: '2026-10-08T00:00:00Z',
      body: `<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **${this.phase === 'running' ? 'Running' : 'Completed'}** <relative-time datetime="2026-10-08T00:00:00Z">now</relative-time> | \`${this.summarySha.slice(0, 7)}\` | PR opened |`,
    }];
    throw new Error(`Unexpected pages ${path}`);
  }
  async threads() { return structuredClone(this.threadsData); }
  async loadState() { return this.record; }
  async saveState(record, value) { record.value = structuredClone(value); record.sha = 'saved'; this.mutations.push(value.state); }
  async removeReady() { this.pr.labels = this.pr.labels.filter(label => label.name !== 'agent-ready'); }
  async addReady() { this.pr.labels.push({ name: 'agent-ready' }); }
  async addComment(number, body) { this.posts.push(body); return { id: this.posts.length }; }
  async resolveThread(id) { this.threadsData.find(thread => thread.id === id).isResolved = true; }
  async ciData() { return { workflowId: 42, ignoredRunIds: [], required: [], checks: [], statuses: [], runs: [{
    pull_requests: [{ number: this.pr.number }], id: 10, workflow_id: 42, path: '.github/workflows/ci.yml@main', head_sha: this.pr.head.sha,
    event: 'pull_request', status: this.green ? 'completed' : 'in_progress', conclusion: this.green ? 'success' : null,
  }] }; }
  addFinding() {
    this.comments.push({ id: 100, user: actor, body: 'Concrete defect', commit_id: sha, pull_request_review_id: 7 });
    this.threadsData.push({ id: 'thread', isResolved: false, isOutdated: false, line: 1, path: 'src/a.ts',
      comments: { nodes: [{ databaseId: 100, body: 'Concrete defect', author: { login: actor.login } }] } });
  }
}
function setup() {
  const api = new FakeGitHub(); let now = '2026-10-08T00:00:00Z';
  const loop = new AgentLoop(api, { runId: '55', now: () => now });
  return { api, loop, advance: () => { now = '2026-10-08T00:08:00Z'; } };
}
const classify = (plan, status = 'informational') => plan.context.sources.map(source => ({ id: source.id, status, reason: 'Code evidence' }));

test('completed latest review with finding enters FIXING; no implementation while Running', async () => {
  const { api, loop } = setup(); api.addFinding();
  const plan = await loop.plan(1);
  const fixed = await loop.decide(plan, classify(plan, 'actionable'));
  assert.equal(fixed.mode, 'fix'); assert.equal(fixed.state, 'FIXING'); assert.equal(api.record.value.state, 'FIXING');
  api.phase = 'running'; const waiting = await loop.plan(1);
  assert.equal(waiting.mode, 'skip'); assert.equal(waiting.state, 'WAITING_FOR_REVIEW');
  assert.equal(api.posts.length, 0);
});
test('clean validation waits for pending CI; later check reconciliation certifies and posts once', async () => {
  const { api, loop } = setup(); api.green = false;
  const plan = await loop.plan(1), clean = await loop.decide(plan, classify(plan));
  assert.equal(await loop.ready(clean, { validated: true }), 'WAITING_FOR_CI');
  assert.equal(api.posts.length, 0);
  api.green = true;
  const resumed = await loop.plan(1);
  assert.equal(resumed.mode, 'ready'); assert.equal(await loop.ready(resumed), 'READY_TO_MERGE');
  assert.ok(api.pr.labels.some(label => label.name === 'agent-ready'));
  assert.equal(api.posts.length, 1); assert.match(api.posts[0], /READY_TO_MERGE/);
  await loop.ready(await loop.plan(1)); assert.equal(api.posts.length, 1);
});
test('new HEAD invalidates ready and resets review request counter', async () => {
  const { api, loop } = setup(); const p = await loop.plan(1), clean = await loop.decide(p, classify(p));
  await loop.ready(clean, { validated: true });
  api.pr.head.sha = next;
  const waiting = await loop.plan(1);
  assert.equal(waiting.state, 'WAITING_FOR_REVIEW_START');
  assert.ok(!api.pr.labels.some(label => label.name === 'agent-ready'));
  assert.equal(api.record.value.lastValidationSha, null); assert.equal(api.record.value.reviewRequestAttempts, 0);
});
test('same review ID with edited finding reprocesses and removes stale ready', async () => {
  const { api, loop } = setup(); const p = await loop.plan(1), clean = await loop.decide(p, classify(p));
  await loop.ready(clean, { validated: true }); api.addFinding();
  const changed = await loop.plan(1);
  assert.equal(changed.mode, 'analyze'); assert.equal(changed.context.reviewId, p.context.reviewId);
  assert.ok(!api.pr.labels.some(label => label.name === 'agent-ready'));
});
test('changed finding while fixing cannot reserve push or resolve a stale thread', async () => {
  const { api, loop } = setup(); api.addFinding();
  const p = await loop.plan(1), fix = await loop.decide(p, classify(p, 'actionable'));
  api.comments[0].body = 'Edited finding'; api.threadsData[0].comments.nodes[0].body = 'Edited finding';
  await assert.rejects(loop.reservePush(fix, next), /STALE_PLAN/);
  await loop.resolveUnchanged(fix); assert.equal(api.threadsData[0].isResolved, false);
  assert.equal(api.record.value.pendingPush, null);
});
test('one validated review/fix/push increments once and returns to review-start wait', async () => {
  const { api, loop } = setup(); api.addFinding();
  const p = await loop.plan(1), fix = await loop.decide(p, classify(p, 'actionable'));
  await loop.enterValidation(fix); assert.equal(api.record.value.state, 'VALIDATING');
  await loop.reservePush(fix, next); assert.equal(api.record.value.state, 'PUSHING');
  api.pr.head.sha = next;
  const result = await loop.published(fix, next);
  assert.equal(result.iteration, 1); assert.equal(result.state, 'WAITING_FOR_REVIEW_START');
  assert.equal(result.reviewRequestAttempts, 0); assert.equal(api.threadsData[0].isResolved, true);
});
test('interrupted successful push recovery counts once; unknown reservation blocks', async () => {
  const { api, loop } = setup(); const p = await loop.plan(1), fix = await loop.decide(p, classify(p, 'actionable'));
  await loop.reservePush(fix, next); api.pr.head.sha = next;
  await loop.plan(1); assert.equal(api.record.value.iteration, 1);
  await loop.plan(1); assert.equal(api.record.value.iteration, 1);
  api.record.value.pendingPush = { sha: 'unknown' };
  assert.equal((await loop.plan(1)).state, 'BLOCKED');
});
test('fallback grace, once-only accounting, Running guard, and new HEAD reset', async () => {
  const { api, loop, advance } = setup(); api.phase = 'not-started';
  await loop.plan(1); assert.equal(api.posts.length, 0); advance();
  await loop.plan(1); assert.equal(api.posts.length, 1); assert.match(api.posts[0], /@codex review/);
  await loop.plan(1); assert.equal(api.posts.length, 1);
  api.phase = 'running'; await loop.plan(1); assert.equal(api.posts.length, 1);
  api.pr.head.sha = next; await loop.plan(1); assert.equal(api.record.value.reviewRequestAttempts, 0);
});
test('automatic-only and manual policy never post review requests', async () => {
  for (const mode of ['automatic-only', 'manual']) {
    const { api, loop, advance } = setup(); loop.mode = mode; api.phase = 'not-started';
    await loop.plan(1); advance(); const p = await loop.plan(1);
    assert.equal(api.posts.length, 0);
    assert.equal(p.state, mode === 'manual' ? 'BLOCKED' : 'WAITING_FOR_REVIEW_START');
  }
});
test('fifth iteration can certify clean but cannot publish another actionable fix', async () => {
  const { api, loop } = setup(); api.record.value = { ...initialState(), iteration: 5 };
  const p = await loop.plan(1); const limit = await loop.decide(p, classify(p, 'actionable'));
  assert.equal(limit.mode, 'skip'); assert.equal(api.record.value.state, 'LOOP_LIMIT_REACHED');
  assert.equal(api.record.value.iteration, 5);
});
test('CI failure, merge conflict, and label removal invalidate READY_TO_MERGE', async () => {
  for (const cause of ['ci', 'conflict', 'label']) {
    const { api, loop } = setup(); const p = await loop.plan(1), clean = await loop.decide(p, classify(p));
    await loop.ready(clean, { validated: true });
    if (cause === 'ci') api.green = false;
    if (cause === 'conflict') api.pr.mergeable = false;
    if (cause === 'label') api.pr.labels = api.pr.labels.filter(label => label.name !== 'agent-loop');
    const resumed = await loop.plan(1);
    if (resumed.mode === 'ready') await loop.ready(resumed);
    assert.ok(!api.pr.labels.some(label => label.name === 'agent-ready'));
    assert.notEqual(api.record.value.state, 'READY_TO_MERGE');
  }
});
test('fresh job boundaries and production scripts contain no polling or publication/merge operations', () => {
  const yaml = readFileSync(new URL('../../.github/workflows/agent-loop-iteration.yml', import.meta.url), 'utf8');
  assert.equal((yaml.match(/uses: openai\/codex-action/g) || []).length, 2);
  assert.match(yaml, /  analyze:/); assert.match(yaml, /  fix:/); assert.match(yaml, /  validate:/); assert.match(yaml, /  publish:/);
  for (const job of ['analyze', 'fix']) {
    const section = yaml.split(`  ${job}:`)[1].split(/\n  [a-z]+:/)[0];
    assert.equal(section.split('uses: openai/codex-action')[1].includes('\n      - '), false);
  }
  const dispatcher = readFileSync(new URL('../../.github/workflows/agent-loop.yml', import.meta.url), 'utf8');
  assert.match(dispatcher, /check_run:/); assert.match(dispatcher, /status:/); assert.match(dispatcher, /schedule:/);
  assert.doesNotMatch(yaml + dispatcher, /sleep |while true|gh pr merge|release create/);
  assert.ok(hash(yaml));
});

test('initial implementation exposes IMPLEMENTING/VALIDATING/PUSHING without counting a repair', async () => {
  const { api, loop } = setup();
  await loop.implementation(1, 'IMPLEMENTING'); assert.equal(api.record.value.state, 'IMPLEMENTING');
  await loop.implementation(1, 'VALIDATING'); assert.equal(api.record.value.state, 'VALIDATING');
  await loop.implementation(1, 'PUSHING'); assert.equal(api.record.value.state, 'PUSHING');
  api.pr.head.sha = next;
  const waiting = await loop.plan(1);
  assert.equal(waiting.state, 'WAITING_FOR_REVIEW_START'); assert.equal(api.record.value.iteration, 0);
});

function interactive(t, loop, checkout) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new InteractiveHandoff(loop, dir, () => checkout);
}
const evidence = headSha => ({ headSha, lint: true, typecheck: true, tests: true, build: true, browser: true });
test('interactive handoff records clean analysis and validation, then monitor resumes READY', async t => {
  const { api, loop } = setup();
  const h = interactive(t, loop, { sha, parent: 'base', clean: true });
  h.snapshot(await loop.plan(1, { observeOnly: true }));
  await h.decide({ findings: classify(h.read('plan.json')) });
  await h.validated(evidence(sha));
  assert.equal(await h.ready(), 'READY_TO_MERGE');
  assert.equal(api.record.value.lastValidationSha, sha);
  assert.equal((await loop.plan(1, { observeOnly: true })).mode, 'ready');
});
test('interactive handoff reserves exact repair and records one iteration only after remote push', async t => {
  const { api, loop } = setup(); api.addFinding();
  const checkout = { sha: next, parent: sha, clean: true }, h = interactive(t, loop, checkout);
  h.snapshot(await loop.plan(1, { observeOnly: true }));
  await h.decide({ findings: classify(h.read('plan.json'), 'actionable') });
  await h.validated(evidence(next));
  await assert.rejects(h.ready(), /new HEAD review/);
  await h.reservePush(); assert.equal(api.record.value.iteration, 0);
  await assert.rejects(h.published(), /Published HEAD/);
  api.pr.head.sha = next;
  const saved = await h.published(); assert.equal(saved.iteration, 1); assert.equal(saved.state, 'WAITING_FOR_REVIEW_START');
  await assert.rejects(h.published(), /reservation/); assert.equal(api.record.value.iteration, 1);
});
test('interactive handoff rejects stale, dirty, or unvalidated checkout and enforces repair limit', async t => {
  const { api, loop } = setup(); api.addFinding();
  const checkout = { sha: next, parent: sha, clean: true }, h = interactive(t, loop, checkout);
  h.snapshot(await loop.plan(1, { observeOnly: true }));
  await h.decide({ findings: classify(h.read('plan.json'), 'actionable') });
  await assert.rejects(h.validated({ ...evidence(next), build: false }), /validation evidence/);
  checkout.clean = false; await assert.rejects(h.validated(evidence(next)), /checkout/);
  checkout.clean = true; await h.validated(evidence(next));
  api.comments[0].body = 'New body'; api.threadsData[0].comments.nodes[0].body = 'New body';
  await assert.rejects(h.reservePush(), /STALE_PLAN/);
  api.record.value.iteration = 5;
  h.snapshot(await loop.plan(1, { observeOnly: true }));
  assert.equal((await h.decide({ findings: classify(h.read('plan.json'), 'actionable') })).mode, 'skip');
  assert.equal(api.record.value.state, 'LOOP_LIMIT_REACHED');
});
test('protected publication failure blocks repeated same-context repairs and a new HEAD can resume', async () => {
  const { api, loop } = setup(); api.addFinding();
  const p = await loop.plan(1), fix = await loop.decide(p, classify(p, 'actionable'));
  await loop.fail(1, 'protected-path violation; manual correction required');
  assert.equal(api.record.value.state, 'BLOCKED');
  assert.equal((await loop.plan(1)).mode, 'skip'); assert.equal(api.record.value.iteration, 0);
  api.pr.head.sha = next; api.summarySha = next;
  assert.equal((await loop.plan(1)).mode, 'analyze');
  assert.equal(api.record.value.blockedContext, null); assert.equal(fix.mode, 'fix');
});
test('a changed clean context after the repair limit can certify without another automatic fix', async () => {
  const { api, loop } = setup(); api.addFinding(); api.record.value = { ...initialState(), iteration: 5 };
  const plan = await loop.plan(1); await loop.decide(plan, classify(plan, 'actionable'));
  assert.equal((await loop.plan(1)).state, 'LOOP_LIMIT_REACHED');
  api.threadsData[0].isResolved = true;
  const changed = await loop.plan(1); assert.equal(changed.mode, 'analyze'); assert.equal(changed.decision, 'analyze-only');
  const clean = await loop.decide(changed, classify(changed));
  assert.equal(await loop.ready(clean, { validated: true }), 'READY_TO_MERGE');
  assert.equal(api.record.value.iteration, 5);
});
test('a human correction at the repair limit accepts its new completed clean HEAD', async () => {
  const { api, loop } = setup(); api.addFinding(); api.record.value = { ...initialState(), iteration: 5 };
  const p = await loop.plan(1); await loop.decide(p, classify(p, 'actionable'));
  api.pr.head.sha = next; api.summarySha = next;
  const changed = await loop.plan(1); assert.equal(changed.mode, 'analyze');
  const clean = await loop.decide(changed, classify(changed));
  assert.equal(await loop.ready(clean, { validated: true }), 'READY_TO_MERGE');
  assert.equal(api.record.value.iteration, 5);
});
