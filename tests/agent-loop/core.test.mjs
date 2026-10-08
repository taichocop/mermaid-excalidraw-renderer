import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODEX_IDENTITY, STATES, initialState, migrateState, onHead, isCodex, parseSummary,
  lifecycleDecision, processed, reviewRequestDecision, parseAnalysis, ciGreen, assertFresh, isCodexReviewEvent } from '../../scripts/agent-loop/core.mjs';
import { buildContext } from '../../scripts/agent-loop/review.mjs';

const actor = { login: CODEX_IDENTITY.login, id: Number(CODEX_IDENTITY.id), type: 'Bot' };
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const completed = { phase: 'completed', headSha: sha, reviewedHeadSha: sha, reviewId: 7, fingerprint: 'fingerprint' };
const started = { ...completed, phase: 'running' }, missing = { ...completed, phase: 'not-started', reviewedHeadSha: null };

test('all formal states are represented and legacy state migrates without trusting old dedupe', () => {
  assert.ok(STATES.includes("WAITING_FOR_REVIEW_START") && STATES.includes("WAITING_FOR_REVIEW"));
  const state = migrateState({ state: 'READY_FOR_HUMAN', iteration: 2, currentHeadSha: sha, processedReviewIds: [7] });
  assert.equal(state.state, 'WAITING_FOR_REVIEW_START'); assert.equal(state.headSha, sha);
  assert.deepEqual(state.processedContexts, []); assert.equal(state.iteration, 2);
  assert.throws(() => migrateState({ state: 'unknown' }));
});
test('new push starts review-start wait and resets per-HEAD request accounting', () => {
  const state = onHead({ ...initialState(), headSha: sha, state: 'READY_TO_MERGE', reviewRequestAttempts: 1 }, other, '2026-10-08T00:00:00Z');
  assert.equal(state.state, 'WAITING_FOR_REVIEW_START'); assert.equal(state.reviewRequestAttempts, 0);
  assert.equal(state.reviewRequestHeadSha, other); assert.equal(state.reviewedHeadSha, null);
});
test('actor requires immutable identity and checks app identity whenever available', () => {
  assert.equal(isCodex(actor), true); assert.equal(isCodex({ ...actor, id: 123 }), false);
  assert.equal(isCodex({ ...actor, type: 'User' }), false); assert.equal(isCodex({ ...actor, login: 'other[bot]' }), false);
  assert.equal(isCodex(actor, CODEX_IDENTITY, { id: 1, slug: CODEX_IDENTITY.appSlug }), false);
});
test('real observed summary supports Running and Completed and has real GitHub App identity', () => {
  const running = JSON.parse(readFileSync(new URL('./evidence/issue-comment-running.json', import.meta.url))).payload.comment;
  const completed = JSON.parse(readFileSync(new URL('./evidence/issue-comments-completed.json', import.meta.url)))[0];
  assert.equal(parseSummary(running).phase, 'running'); assert.equal(parseSummary(completed).phase, 'completed');
  assert.equal(completed.performed_via_github_app.id, 1144995);
  assert.equal(parseSummary({ ...completed, user: { ...actor, id: 99 } }), null);
});
test('actual completed summary never masks six observed inline findings', () => {
  const reviews = JSON.parse(readFileSync(new URL('./evidence/submitted-reviews.json', import.meta.url)));
  const comments = JSON.parse(readFileSync(new URL('./evidence/inline-comments.json', import.meta.url)));
  const threads = JSON.parse(readFileSync(new URL('./evidence/review-threads.json', import.meta.url))).data.repository.pullRequest.reviewThreads.nodes;
  const issue = JSON.parse(readFileSync(new URL('./evidence/issue-comments-completed.json', import.meta.url)))[0];
  const summary = { ...parseSummary(issue), sha: reviews[0].commit_id };
  const context = buildContext({ number: 1, head: { sha: reviews[0].commit_id } }, { reviews, comments, threads, summaries: [summary] });
  assert.equal(context.phase, 'completed'); assert.equal(context.findings.length, 6);
  assert.equal(context.findings.filter(f => f.severity === 'P1').length, 3);
  const current = buildContext({ number: 1, head: { sha: other } }, { reviews, comments, threads, summaries: [summary] });
  assert.equal(current.phase, 'not-started'); assert.equal(current.findings.length, 0);
});
test('Running metadata overrides an already submitted review of the same HEAD', () => {
  const data = { reviews: [{ id: 7, user: actor, commit_id: sha, submitted_at: 'now', state: 'COMMENTED' }],
    comments: [], threads: [], summaries: [{ sha, phase: 'running', id: 1, epoch: '2026-10-08', body: 'Running' }] };
  assert.equal(buildContext({ number: 1, head: { sha } }, data).phase, 'running');
});
test('same ID with changed comment/thread fingerprint reprocesses; same context duplicates', () => {
  const state = processed(onHead(initialState(), sha), completed);
  assert.equal(lifecycleDecision(state, completed), 'duplicate');
  assert.equal(lifecycleDecision(state, { ...completed, fingerprint: 'edited' }), 'analyze');
  assert.equal(lifecycleDecision(state, { ...completed, reviewedHeadSha: other }), 'wait-start');
  assert.equal(lifecycleDecision(state, started), 'wait-review');
});
test('only current, unresolved, not outdated Codex threads become sources', () => {
  const reviews = [{ id: 7, user: actor, commit_id: sha, submitted_at: 'now', state: 'COMMENTED' }];
  const comments = [1, 2, 3, 4].map(id => ({ id, user: id === 4 ? { ...actor, id: 99 } : actor,
    commit_id: sha, pull_request_review_id: 7, body: 'Defect' }));
  const threads = comments.map(c => ({ id: `thread${c.id}`, path: 'src/a.ts', line: 1,
    isResolved: c.id === 2, isOutdated: c.id === 3,
    comments: { nodes: [{ databaseId: c.id, body: c.body, author: { login: c.user.login } }] } }));
  const data = { reviews, comments, threads, summaries: [] };
  const first = buildContext({ number: 1, head: { sha } }, data);
  assert.deepEqual(first.findings.map(f => f.commentId), [1]);
  threads[0].comments.nodes.push({ databaseId: 10, body: 'Updated context', author: { login: 'human' } });
  assert.notEqual(first.fingerprint, buildContext({ number: 1, head: { sha } }, data).fingerprint);
});
test('grace fallback is once per HEAD; Running and started/completed reviews never request', () => {
  const state = onHead(initialState(), sha, '2026-10-08T00:00:00Z');
  const opts = { graceMs: 420_000, now: Date.parse('2026-10-08T00:06:00Z') };
  assert.equal(reviewRequestDecision(state, missing, opts), 'none');
  opts.now += 120_000;
  assert.equal(reviewRequestDecision(state, missing, opts), 'request');
  assert.equal(reviewRequestDecision(state, started, opts), 'none');
  assert.equal(reviewRequestDecision(state, completed, opts), 'none');
  assert.equal(reviewRequestDecision({ ...state, reviewRequestAttempts: 1 }, missing, opts), 'none');
  assert.equal(reviewRequestDecision(state, missing, { ...opts, mode: 'automatic-only' }), 'none');
  assert.equal(reviewRequestDecision(state, missing, { ...opts, mode: 'manual' }), 'blocked');
});
test('exact SHA and review fingerprint must match before publish/resolve', () => {
  const plan = { headSha: sha, context: completed };
  assert.doesNotThrow(() => assertFresh(plan, { head: { sha } }, completed));
  assert.throws(() => assertFresh(plan, { head: { sha } }, { ...completed, fingerprint: 'edited' }), /STALE_PLAN/);
  assert.throws(() => assertFresh(plan, { head: { sha: other } }, completed), /STALE_PLAN/);
});
test('analysis requires all source IDs exactly once; no severity-based omission', () => {
  const sources = [{ id: 'one' }, { id: 'two' }];
  assert.throws(() => parseAnalysis({ findings: [] }, sources));
  assert.throws(() => parseAnalysis({ findings: [{ id: 'one', status: 'resolved', reason: 'fixed' }, { id: 'one', status: 'resolved', reason: 'fixed' }] }, sources));
  assert.equal(parseAnalysis({ findings: sources.map(s => ({ ...s, status: 'actionable', reason: 'Concrete defect' })) }, sources).length, 2);
});
const base = { ref: 'main', sha: 'base' };
const run = { pull_requests: [{ number: 1, base }], id: 1, workflow_id: 42, path: '.github/workflows/ci.yml@main', head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success' };
const check = { id: 1, name: 'validate', app: { id: 1 }, status: 'completed', conclusion: 'success' };
test('CI uses stable workflow ID or strips @ref, and cannot trust old/push CI', () => {
  assert.equal(ciGreen([run], [check], [], sha, 42, [], [], 1, base), true);
  assert.equal(ciGreen([run], [check], [], sha, null, [], [], 1, base), true);
  assert.equal(ciGreen([{ ...run, head_sha: other }], [], [], sha, 42, [], [], 1, base), false);
  assert.equal(ciGreen([{ ...run, event: 'push' }], [], [], sha, 42, [], [], 1, base), false);
  assert.equal(ciGreen([], [], [], sha, 42, [], [], 1, base), false);
});
test('pending, failed, missing required checks block readiness and later completion passes', () => {
  const pending = { ...check, id: 2, name: 'external', status: 'in_progress', conclusion: null };
  assert.equal(ciGreen([run], [check, pending], [], sha, 42, [], [], 1, base), false);
  assert.equal(ciGreen([run], [check, { ...pending, status: 'completed', conclusion: 'success' }], [], sha, 42, [], [], 1, base), true);
  assert.equal(ciGreen([run], [check], [], sha, 42, [], [{ context: 'missing' }], 1, base), false);
  assert.equal(ciGreen([run], [check], [{ id: 2, context: 'security', state: 'failure' }], sha, 42, [], [], 1, base), false);
});
test('fifth fix is the last; final review can still certify clean', () => {
  assert.equal(lifecycleDecision({ ...onHead(initialState(), sha), iteration: 5 }, completed), 'analyze-only');
  assert.equal(lifecycleDecision(processed({ ...onHead(initialState(), sha), iteration: 5, state: 'LOOP_LIMIT_REACHED' }, completed), completed), 'limit');
  assert.equal(lifecycleDecision({ ...onHead(initialState(), sha), iteration: 5, state: 'LOOP_LIMIT_REACHED' }, completed), 'analyze-only');
});

test('a visible current Codex comment without verified parent metadata cannot become clean', () => {
  assert.throws(() => buildContext({ number: 1, head: { sha } }, { reviews: [], summaries: [], threads: [],
    comments: [{ id: 1, user: actor, commit_id: sha, pull_request_review_id: 9, body: 'Defect' }] }), /Incomplete review snapshot/);
});
test('legacy pending push gains a recoverable context; same legacy HEAD starts a grace clock', () => {
  const old = migrateState({ state: 'PUBLISHING', iteration: 1, currentHeadSha: sha,
    pendingPush: { sha: other, parent: sha, iteration: 2, review: { id: 7 } } });
  assert.equal(old.pendingPush.context.headSha, sha); assert.equal(old.pendingPush.context.reviewId, 7);
  assert.equal(onHead(old, sha, '2026-10-08T00:00:00Z').reviewStartAt, '2026-10-08T00:00:00Z');
});

test('captured webhook metadata distinguishes stale reviewed commit from current PR HEAD', () => {
  const event = JSON.parse(readFileSync(new URL('./evidence/review-submitted-webhook.json', import.meta.url)));
  const meta = JSON.parse(readFileSync(new URL('./evidence/review-submitted-metadata.json', import.meta.url)));
  assert.equal(meta.eventName, 'pull_request_review'); assert.equal(event.action, 'submitted');
  assert.equal(isCodex(event.review.user), true); assert.equal(event.review.id, 5449597296);
  assert.notEqual(event.review.commit_id, event.pull_request.head.sha);
});
test('another PR using the same HEAD cannot supply successful validation for this PR', () => {
  const otherPR = { ...run, id: 99, pull_requests: [{ number: 2 }] };
  for (const status of ['in_progress', 'completed']) {
    const current = { ...run, status, conclusion: status === 'completed' ? 'failure' : null };
    assert.equal(ciGreen([current, otherPR], [], [], sha, 42, [], [], 1, base), false);
  }
  assert.equal(ciGreen([otherPR], [], [], sha, 42, [], [], 1, base), false);
  assert.equal(ciGreen([{ ...run, pull_requests: [] }], [], [], sha, 42, [], [], 1, base), false);
  assert.equal(ciGreen([run, otherPR], [], [], sha, 42, [], [], 1, base), true);
});
test('CI must match this PR base ref and SHA after retargeting or base advancement', () => {
  const retargeted = { ref: 'release', sha: 'release-base' };
  assert.equal(ciGreen([run], [], [], sha, 42, [], [], 1, retargeted), false);
  assert.equal(ciGreen([run], [], [], sha, 42, [], [], 1, { ...base, sha: 'advanced-main' }), false);
  const fresh = { ...run, id: 3, pull_requests: [{ number: 1, base: retargeted }] };
  assert.equal(ciGreen([run, { ...fresh, status: 'queued', conclusion: null }], [], [], sha, 42, [], [], 1, retargeted), false);
  assert.equal(ciGreen([run, fresh], [], [], sha, 42, [], [], 1, retargeted), true);
});
test('human invalidations authenticate the affected Codex object rather than its deleting actor', () => {
  const human = { login: 'maintainer', id: 1, type: 'User' }, object = { user: actor, performed_via_github_app: { id: Number(CODEX_IDENTITY.appId), slug: CODEX_IDENTITY.appSlug } };
  assert.equal(isCodexReviewEvent('pull_request_review', { action: 'dismissed', sender: human, review: object }), true);
  assert.equal(isCodexReviewEvent('pull_request_review', { action: 'submitted', sender: human, review: object }), false);
  assert.equal(isCodexReviewEvent('pull_request_review_comment', { action: 'deleted', sender: human, comment: object }), true);
  assert.equal(isCodexReviewEvent('pull_request_review_comment', { action: 'created', sender: human, comment: object }), false);
  assert.equal(isCodexReviewEvent('pull_request_review', { action: 'dismissed', sender: human, review: { user: human } }), false);
  assert.equal(isCodexReviewEvent('pull_request_review', { action: 'submitted', sender: actor, review: object }), true);
});
