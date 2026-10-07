import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { initialState } from '../../scripts/agent-loop/core.mjs';

const controller = resolve('scripts/agent-loop/run.mjs');
const login = 'verified-codex[bot]';
const user = { login, id: 101, type: 'Bot' };
const review = { id: 7, user, commit_id: 'head', state: 'COMMENTED', submitted_at: '2026-10-08', body: 'Review summary' };
const pr = { number: 1, state: 'open', draft: false, labels: [{ name: 'agent-loop' }],
  head: { sha: 'head', ref: 'codex/fix', repo: { full_name: 'owner/repo' } },
  base: { sha: 'base', repo: { full_name: 'owner/repo' } } };

async function harness(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-loop-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'work'));
  writeFileSync(join(bin, 'git'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_GIT_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'rev-parse') console.log(fs.existsSync(process.env.TEST_COMMITTED) ? 'fixed-sha' : 'head');
if (args[0] === 'status' && process.env.TEST_FIX === 'true') console.log(' M src/example.ts');
if (args[0] === 'diff' && args.includes('--name-only') && !args.includes('--diff-filter=T') && process.env.TEST_FIX === 'true') console.log('src/example.ts');
if (args.includes('commit')) fs.writeFileSync(process.env.TEST_COMMITTED, 'yes');
`, { mode: 0o755 });
  const planDir = join(dir, 'agent-loop-50-1');
  mkdirSync(planDir);
  const eventPath = join(dir, 'event.json');
  const outputPath = join(dir, 'outputs');
  writeFileSync(eventPath, JSON.stringify({ sender: user, review, pull_request: pr }));
  writeFileSync(outputPath, '');
  const state = { value: overrides.state || initialState(), calls: [], pr: structuredClone(pr), reviews: [review], ciGreen: false };
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    state.calls.push({ method: request.method, url: request.url, body: body && JSON.parse(body) });
    let value;
    if (request.url.startsWith('/repos/owner/repo/contents/')) {
      if (request.method === 'PUT') {
        state.value = JSON.parse(Buffer.from(JSON.parse(body).content, 'base64').toString());
        value = { content: { sha: 'new-file-sha' } };
      } else value = { sha: 'file-sha', content: Buffer.from(JSON.stringify(state.value)).toString('base64') };
    } else if (request.url === '/repos/owner/repo/pulls/1') value = state.pr;
    else if (request.url.startsWith('/repos/owner/repo/pulls/1/reviews')) value = state.reviews;
    else if (request.url.startsWith('/repos/owner/repo/pulls/1/comments')) value = [];
    else if (request.url.startsWith('/repos/owner/repo/actions/runs')) value = { workflow_runs: [{
      id: 40, path: '.github/workflows/ci.yml', head_sha: 'head', event: 'pull_request',
      status: state.ciGreen ? 'completed' : 'in_progress', conclusion: state.ciGreen ? 'success' : null,
    }] };
    else if (request.url.startsWith('/repos/owner/repo/commits/head/check-runs')) value = { check_runs: [] };
    else if (request.url.startsWith('/repos/owner/repo/commits/head/status')) value = { statuses: [] };
    else if (request.method === 'POST' && request.url.endsWith('/labels')) value = {};
    else if (request.url === '/graphql') value = { data: { repository: { pullRequest: {
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    } } } };
    else if (request.method === 'DELETE' && request.url.endsWith('/labels/agent-ready')) { response.writeHead(204).end(); return; }
    else { response.writeHead(500).end(JSON.stringify({ unexpected: request.url })); return; }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const env = { ...process.env, GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'fixture-token',
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'pull_request_review', CODEX_REVIEW_LOGIN: login, CODEX_REVIEW_USER_ID: '101',
    CODEX_REVIEW_EVENTS: 'pull_request_review,pull_request_review_comment', MAX_AGENT_ITERATIONS: '5',
    RUNNER_TEMP: dir, GITHUB_RUN_ID: '50', PR_NUMBER: '1', GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: join(dir, 'summary'), PATH: `${bin}:${process.env.PATH}`,
    TEST_GIT_LOG: join(dir, 'git-log'), TEST_COMMITTED: join(dir, 'committed') };
  async function execute(command, extra = {}) {
    const child = spawn(process.execPath, [controller, command], { cwd: dir, env: { ...env, ...extra } });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise(resolve => child.on('close', resolve));
    return { code, output, outputs: readFileSync(outputPath, 'utf8') };
  }
  return { ...state, state, execute, planDir, eventPath, dir };
}

test('unverified configuration never analyzes or mutates state', async t => {
  const h = await harness(t);
  const result = await h.execute('prepare', { CODEX_REVIEW_USER_ID: '' });
  assert.equal(result.code, 0, result.output);
  assert.match(result.outputs, /mode=skip/);
  assert.equal(h.state.calls.some(call => call.method === 'PUT'), false);
});

test('fresh review persists analysis plan and returns immediately', async t => {
  const h = await harness(t);
  const result = await h.execute('prepare');
  assert.equal(result.code, 0, result.output);
  assert.match(result.outputs, /mode=analyze/);
  assert.equal(h.state.value.state, 'ANALYZING');
  assert.equal(h.state.value.iteration, 0);
  assert.equal(JSON.parse(readFileSync(join(h.planDir, 'plan.json'))).context.review.id, 7);
});

test('summary and inline duplicate events never fix again', async t => {
  const h = await harness(t, { state: { ...initialState(), processedReviewIds: [7], lastProcessedReviewId: 7 } });
  writeFileSync(h.eventPath, JSON.stringify({ sender: user, comment: { user, pull_request_review_id: 7 }, pull_request: pr }));
  const result = await h.execute('prepare', { GITHUB_EVENT_NAME: 'pull_request_review_comment' });
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.outputs, /mode=analyze/);
  assert.equal(h.state.value.iteration, 0);
});

test('old HEAD and impersonated bot events cannot start an iteration', async t => {
  const h = await harness(t);
  h.state.reviews = [{ ...review, commit_id: 'old' }];
  assert.doesNotMatch((await h.execute('prepare')).outputs, /mode=analyze/);
  h.state.reviews = [review];
  writeFileSync(h.eventPath, JSON.stringify({ sender: { ...user, id: 999 }, review, pull_request: pr }));
  assert.doesNotMatch((await h.execute('prepare')).outputs, /mode=analyze/);
});

test('workflow_run cannot initiate a new fixing iteration', async t => {
  const h = await harness(t);
  writeFileSync(h.eventPath, JSON.stringify({ workflow_run: { head_sha: 'head' } }));
  const result = await h.execute('prepare', { GITHUB_EVENT_NAME: 'workflow_run' });
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.outputs, /mode=analyze/);
});

test('successful push interrupted before state update is counted exactly once', async t => {
  const h = await harness(t, { state: { ...initialState(), iteration: 2, state: 'PUBLISHING',
    pendingPush: { sha: 'head', parent: 'old', review: { ...review, commit_id: 'old' }, iteration: 3 } } });
  const result = await h.execute('prepare');
  assert.equal(result.code, 0, result.output);
  assert.equal(h.state.value.iteration, 3);
  assert.equal(h.state.value.state, 'WAITING_FOR_REVIEW');
  assert.equal(h.state.value.lastProcessedHeadSha, 'old');
  assert.equal(h.state.value.pendingPush, null);
  assert.equal((await h.execute('prepare')).code, 0);
  assert.equal(h.state.value.iteration, 3);
});

test('interrupted unpublished reservation stops for recovery rather than duplicate pushing', async t => {
  const h = await harness(t, { state: { ...initialState(), state: 'PUBLISHING',
    pendingPush: { sha: 'unpublished', parent: 'head', review, iteration: 1 } } });
  assert.equal((await h.execute('prepare')).code, 0);
  assert.equal(h.state.value.state, 'NEEDS_HUMAN');
  assert.equal(h.state.value.iteration, 0);
});

test('actionable fifth-iteration review stops before validation or fix', async t => {
  const h = await harness(t, { state: { ...initialState(), iteration: 5 } });
  assert.equal((await h.execute('prepare')).code, 0);
  writeFileSync(join(h.planDir, 'analysis.json'), JSON.stringify({ findings: [
    { id: 'review:7', status: 'actionable', reason: 'Concrete defect still present' },
  ] }));
  const result = await h.execute('analyze');
  assert.equal(result.code, 0, result.output);
  assert.equal(h.state.value.state, 'LOOP_LIMIT_REACHED');
  assert.equal(h.state.value.iteration, 5);
  assert.doesNotMatch(result.outputs, /fix=true/);
  assert.doesNotMatch(result.outputs, /validate=true/);
});

test('clean review after fifth push may still validate and reach readiness', async t => {
  const h = await harness(t, { state: { ...initialState(), iteration: 5 } });
  assert.equal((await h.execute('prepare')).code, 0);
  writeFileSync(join(h.planDir, 'analysis.json'), JSON.stringify({ findings: [
    { id: 'review:7', status: 'informational', reason: 'No concrete findings' },
  ] }));
  const result = await h.execute('analyze');
  assert.equal(result.code, 0, result.output);
  assert.match(result.outputs, /validate=true/);
  assert.doesNotMatch(result.outputs, /fix=true/);
  assert.equal(h.state.value.iteration, 5);
});

test('missing classifications fail without advancing iteration', async t => {
  const h = await harness(t);
  assert.equal((await h.execute('prepare')).code, 0);
  writeFileSync(join(h.planDir, 'analysis.json'), '{"findings":[]}');
  assert.notEqual((await h.execute('analyze')).code, 0);
  assert.equal(h.state.value.iteration, 0);
});

async function classify(h, status) {
  const prepare = await h.execute('prepare');
  assert.equal(prepare.code, 0, prepare.output);
  writeFileSync(join(h.planDir, 'analysis.json'), JSON.stringify({ findings: [
    { id: 'review:7', status, reason: status === 'actionable' ? 'Defect persists' : 'No defect present' },
  ] }));
  const analysis = await h.execute('analyze');
  assert.equal(analysis.code, 0, analysis.output);
}

test('clean review exits while CI is pending, then CI event certifies without reanalysis', async t => {
  const h = await harness(t);
  await classify(h, 'informational');
  const pending = await h.execute('finish');
  assert.equal(pending.code, 0, pending.output);
  assert.equal(h.state.value.state, 'WAITING_FOR_CI');
  assert.equal(h.state.calls.some(call => call.method === 'POST' && call.url.endsWith('/issues/1/labels')), false);
  h.state.ciGreen = true;
  writeFileSync(h.eventPath, JSON.stringify({ workflow_run: { head_sha: 'head' } }));
  const ready = await h.execute('prepare', { GITHUB_EVENT_NAME: 'workflow_run' });
  assert.equal(ready.code, 0, ready.output);
  assert.match(ready.outputs, /mode=ready/);
  const certified = await h.execute('finish');
  assert.equal(certified.code, 0, certified.output);
  assert.equal(h.state.value.state, 'READY_FOR_HUMAN');
  assert.equal(h.state.value.iteration, 0);
  assert.equal(h.state.calls.filter(call => call.method === 'POST' && call.url.endsWith('/issues/1/labels')).length, 1);
});

test('fix publishes exactly one commit with expected HEAD lease and increments once', async t => {
  const h = await harness(t);
  await classify(h, 'actionable');
  writeFileSync(join(h.planDir, 'fix.json'), JSON.stringify({ fixedFindingIds: ['review:7'], summary: 'Fixed defect' }));
  const result = await h.execute('finish', { TEST_FIX: 'true', AGENT_LOOP_TOKEN: 'fixture-publisher' });
  assert.equal(result.code, 0, result.output);
  const calls = readFileSync(join(h.dir, 'git-log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.filter(args => args.includes('commit')).length, 1);
  const pushes = calls.filter(args => args.includes('push'));
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].includes('--force-with-lease=refs/heads/codex/fix:head'));
  assert.equal(h.state.value.iteration, 1);
  assert.equal(h.state.value.state, 'WAITING_FOR_REVIEW');
  assert.deepEqual(h.state.value.processedReviewIds, [7]);
  assert.equal(h.state.value.currentHeadSha, 'fixed-sha');
  assert.equal(h.state.calls.some(call => call.url.includes('requested_reviewers')), false);
});

test('HEAD racing with analysis prevents any commit or push', async t => {
  const h = await harness(t);
  await classify(h, 'actionable');
  h.state.pr.head.sha = 'human-push';
  const result = await h.execute('finish', { TEST_FIX: 'true', AGENT_LOOP_TOKEN: 'fixture-publisher' });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /HEAD\/eligibility changed/);
  assert.equal(h.state.value.iteration, 0);
});

test('missing push token fails before reserving a publication', async t => {
  const h = await harness(t);
  await classify(h, 'actionable');
  const result = await h.execute('finish', { TEST_FIX: 'true', AGENT_LOOP_TOKEN: '' });
  assert.notEqual(result.code, 0);
  assert.equal(h.state.value.pendingPush, null);
  assert.equal(h.state.value.iteration, 0);
});

test('validation failure is persisted without marking review processed', async t => {
  const h = await harness(t);
  await classify(h, 'actionable');
  const result = await h.execute('fail');
  assert.equal(result.code, 0, result.output);
  assert.equal(h.state.value.state, 'VALIDATION_FAILED');
  assert.equal(h.state.value.iteration, 0);
  assert.deepEqual(h.state.value.processedReviewIds, []);
});
