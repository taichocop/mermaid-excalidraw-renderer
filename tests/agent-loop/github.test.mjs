import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../../scripts/agent-loop/github.mjs';

test('CI reads every commit status from the paginated list endpoint', async () => {
  const api = new GitHub('owner/repo', 'test'), calls = [];
  api.repo = async path => {
    calls.push(path);
    const url = new URL(path, 'https://example.test');
    if (url.pathname === '/actions/workflows/ci.yml') return { id: 42 };
    if (url.pathname === '/actions/runs') return { workflow_runs: [] };
    if (url.pathname === '/commits/head/check-runs') return { check_runs: [] };
    if (url.pathname === '/branches/main') return { protected: false };
    if (url.pathname === '/commits/head/statuses') return url.searchParams.get('page') === '1'
      ? Array.from({ length: 100 }, (_, id) => ({ id, context: `check-${id}`, state: 'success' }))
      : [{ id: 100, context: 'external', state: 'pending' }];
    throw new Error(`Unexpected endpoint ${path}`);
  };
  const data = await api.ciData({ head: { sha: 'head' }, base: { ref: 'main' } });
  assert.equal(data.statuses.length, 101); assert.equal(data.statuses.at(-1).state, 'pending');
  assert.equal(calls.filter(path => path.startsWith('/commits/head/statuses?')).length, 2);
});
test('pagination refuses non-array data rather than returning incomplete CI/review evidence', async () => {
  const api = new GitHub('owner/repo', 'test'); api.repo = async () => ({ state: 'success' });
  await assert.rejects(api.pages('/statuses'), /paginated GitHub array/);
});
test('required checks from later branch-rule pages are included', async () => {
  const api = new GitHub('owner/repo', 'test');
  api.request = async () => ({ data: { repository: { ref: { branchProtectionRule: { requiredStatusChecks: [] } } } } });
  api.repo = async path => {
    const url = new URL(path, 'https://example.test');
    if (url.pathname === '/actions/workflows/ci.yml') return { id: 42 };
    if (url.pathname === '/actions/runs') return { workflow_runs: [] };
    if (url.pathname === '/commits/head/check-runs') return { check_runs: [] };
    if (url.pathname === '/commits/head/statuses') return [];
    if (url.pathname === '/branches/main') return { protected: true };
    if (url.pathname === '/rules/branches/main') return url.searchParams.get('page') === '1'
      ? Array.from({ length: 100 }, () => ({ type: 'creation' }))
      : [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'late-security', integration_id: 17 }] } }];
    throw new Error(`Unexpected endpoint ${path}`);
  };
  assert.deepEqual((await api.ciData({ head: { sha: 'head' }, base: { ref: 'main' } })).required,
    [{ context: 'late-security', app_id: 17 }]);
});
