import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, isCodex, eligible, selectReview, reviewDecision,
  markProcessed, contextHash, parseAnalysis, ciGreen } from '../../scripts/agent-loop/core.mjs';

const identity = { login: 'verified-codex[bot]', id: '101' };
const user = { login: identity.login, id: 101, type: 'Bot' };
const review = (id = 7, sha = 'head') => ({ id, user, commit_id: sha, state: 'COMMENTED', submitted_at: '2026-10-08' });

test('bot identity requires immutable ID, login, and type; missing configuration fails closed', () => {
  assert.equal(isCodex(user, identity), true);
  for (const candidate of [{ ...user, id: 102 }, { ...user, login: 'other[bot]' }, { ...user, type: 'User' }]) {
    assert.equal(isCodex(candidate, identity), false);
  }
  assert.equal(isCodex(user, {}), false);
});

test('only open non-draft opt-in same-repository PRs are eligible', () => {
  const pr = { state: 'open', draft: false, labels: [{ name: 'agent-loop' }],
    head: { repo: { full_name: 'owner/repo' } }, base: { repo: { full_name: 'owner/repo' } } };
  assert.equal(eligible(pr, 'owner/repo'), true);
  for (const change of [{ state: 'closed' }, { draft: true }, { labels: [] }, { head: { repo: { full_name: 'fork/repo' } } }]) {
    assert.equal(eligible({ ...pr, ...change }, 'owner/repo'), false);
  }
});

test('canonical review is latest submitted non-dismissed Codex review of current HEAD', () => {
  const reviews = [review(), review(8, 'old'), { ...review(9), state: 'PENDING' },
    { ...review(10), state: 'DISMISSED' }, { ...review(11), user: { ...user, id: 102 } }, review(6)];
  assert.equal(selectReview(reviews, 'head', identity).id, 7);
  assert.equal(selectReview(reviews, 'missing', identity), undefined);
});

test('summary and inline events deduplicate by the same review ID', () => {
  const state = markProcessed(initialState(), review(), 'head');
  assert.equal(reviewDecision(state, review(), 'head', 5), 'duplicate');
  assert.equal(reviewDecision(state, review(6), 'head', 5), 'stale');
  assert.equal(reviewDecision(state, review(8, 'old'), 'head', 5), 'skip');
  assert.equal(reviewDecision(state, review(8), 'head', 5), 'analyze');
  assert.equal(state.iteration, 0);
  assert.equal(markProcessed(state, review(), 'head').processedReviewIds.length, 1);
});

test('fifth push allows a final clean analysis but cannot allow another fix', () => {
  assert.equal(reviewDecision({ ...initialState(), iteration: 4 }, review(), 'head', 5), 'analyze');
  assert.equal(reviewDecision({ ...initialState(), iteration: 5 }, review(), 'head', 5), 'analyze-only');
  assert.equal(reviewDecision({ ...initialState(), state: 'LOOP_LIMIT_REACHED' }, review(), 'head', 5), 'limit');
});

test('analysis must classify every summary/inline source exactly once', () => {
  const sources = [{ id: 'review:1' }, { id: 'comment:2' }];
  const result = { findings: [
    { id: 'review:1', status: 'informational', reason: 'No defect identified' },
    { id: 'comment:2', status: 'actionable', reason: 'Unsafe access still exists' },
  ] };
  assert.equal(parseAnalysis(result, sources).length, 2);
  for (const bad of [null, {}, { findings: result.findings.slice(1) },
    { findings: [result.findings[0], result.findings[0]] },
    { findings: [result.findings[0], { ...result.findings[1], id: 'unknown' }] },
    { findings: [result.findings[0], { ...result.findings[1], reason: '' }] },
    { findings: [result.findings[0], { ...result.findings[1], status: 'ignored' }] }]) {
    assert.throws(() => parseAnalysis(bad, sources));
  }
});

test('edited or newly added findings invalidate the readiness snapshot', () => {
  const context = { review: review(), sources: [{ id: 'comment:1', body: 'Finding' }] };
  assert.equal(contextHash(context), contextHash(structuredClone(context)));
  assert.notEqual(contextHash(context), contextHash({ ...context, sources: [{ id: 'comment:1', body: 'Edited' }] }));
});

const run = { id: 10, path: '.github/workflows/ci.yml', event: 'pull_request', head_sha: 'head', status: 'completed', conclusion: 'success' };
const check = { id: 1, name: 'validate', status: 'completed', conclusion: 'success', app: { id: 1, slug: 'github-actions' } };
test('readiness needs successful current HEAD PR CI, not empty checks or old/main CI', () => {
  assert.equal(ciGreen([run], [check], [], 'head', '50'), true);
  assert.equal(ciGreen([], [], [], 'head', '50'), false);
  assert.equal(ciGreen([{ ...run, head_sha: 'old' }], [check], [], 'head', '50'), false);
  assert.equal(ciGreen([{ ...run, event: 'push' }], [check], [], 'head', '50'), false);
  assert.equal(ciGreen([run, { ...run, id: 11, conclusion: 'failure' }], [check], [], 'head', '50'), false);
});

test('pending/failing other checks or commit statuses prevent ready without waiting', () => {
  for (const other of [{ ...check, name: 'security', conclusion: 'failure' }, { ...check, name: 'security', status: 'in_progress', conclusion: null }]) {
    assert.equal(ciGreen([run], [check, other], [], 'head', '50'), false);
  }
  assert.equal(ciGreen([run], [check], [{ state: 'pending' }], 'head', '50'), false);
  assert.equal(ciGreen([run], [check], [{ state: 'failure' }], 'head', '50'), false);
});

test('latest check attempt supersedes old failure; current loop cannot block itself', () => {
  assert.equal(ciGreen([run], [{ ...check, id: 0, conclusion: 'failure' }, check,
    { ...check, id: 5, name: 'iteration (1)', status: 'in_progress', conclusion: null,
      details_url: 'https://github.com/owner/repo/actions/runs/50/job/1' }], [], 'head', '50'), true);
});
