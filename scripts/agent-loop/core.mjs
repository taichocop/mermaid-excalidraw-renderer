import { createHash } from 'node:crypto';

export const CODEX_IDENTITY = { login: 'chatgpt-codex-connector[bot]', id: '199175422', appId: '1144995', appSlug: 'chatgpt-codex-connector' };
export const STATES = ['IDLE', 'IMPLEMENTING', 'VALIDATING', 'PUSHING', 'WAITING_FOR_REVIEW_START',
  'WAITING_FOR_REVIEW', 'PROCESSING_REVIEW', 'FIXING', 'WAITING_FOR_CI', 'READY_TO_MERGE',
  'BLOCKED', 'FAILED', 'LOOP_LIMIT_REACHED'];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const initialState = () => ({ schemaVersion: 2, state: 'IDLE', iteration: 0, headSha: null,
  reviewedHeadSha: null, reviewId: null, reviewFingerprint: null, processedContexts: [],
  lastProcessedReviewId: null, lastProcessedHeadSha: null, lastProcessedFindingIds: [],
  reviewRequestHeadSha: null, reviewRequestAttempts: 0, reviewRequestAt: null,
  reviewStartAt: null, lastValidationSha: null, pendingPush: null, lease: null, updatedAt: null });

export function migrateState(old = {}) {
  const map = { ANALYZING: 'PROCESSING_REVIEW', PUBLISHING: 'PUSHING', READY_FOR_HUMAN: 'WAITING_FOR_REVIEW_START',
    INACTIVE: 'IDLE', VALIDATION_FAILED: 'FAILED', NEEDS_HUMAN: 'BLOCKED' };
  const value = { ...initialState(), ...old, schemaVersion: 2,
    headSha: old.headSha ?? old.currentHeadSha ?? null,
    lastValidationSha: old.lastValidationSha ?? old.localValidationHeadSha ?? null,
    state: map[old.state] ?? old.state ?? 'IDLE' };
  if (!Number.isSafeInteger(value.iteration) || value.iteration < 0 || !STATES.includes(value.state)
    || !Array.isArray(value.processedContexts)) throw new Error('Invalid persisted agent-loop state');
  if (old.schemaVersion !== 2 && value.pendingPush && !value.pendingPush.context) {
    value.pendingPush = { ...value.pendingPush, findingIds: [], context: {
      reviewId: value.pendingPush.review?.id ?? 'legacy', headSha: value.pendingPush.parent,
      reviewedHeadSha: value.pendingPush.parent, fingerprint: `legacy:${value.pendingPush.sha}`,
    } };
  }
  // A v1 review ID alone never proves v2 context completion or readiness.
  if (old.schemaVersion !== 2) value.processedContexts = [];
  return value;
}

export function isCodex(user, identity = CODEX_IDENTITY, app = null) {
  return user?.type === 'Bot' && user.login === identity.login && String(user.id) === String(identity.id)
    && (!app || (String(app.id) === String(identity.appId) && app.slug === identity.appSlug));
}
export const eligible = (pr, repo) => pr.state === 'open' && !pr.draft
  && pr.head.repo?.full_name === repo && pr.base.repo?.full_name === repo
  && pr.labels.some(label => label.name === 'agent-loop');

export function onHead(state, sha, now = new Date().toISOString()) {
  if (state.headSha === sha) return state.reviewStartAt ? state : { ...state, reviewStartAt: now, reviewRequestHeadSha: sha };
  return { ...state, headSha: sha, reviewedHeadSha: null, reviewId: null, reviewFingerprint: null,
    lastValidationSha: null, reviewStartAt: now, reviewRequestHeadSha: sha,
    reviewRequestAttempts: 0, reviewRequestAt: null, pendingPush: null, lease: null,
    state: state.state === 'LOOP_LIMIT_REACHED' ? state.state : 'WAITING_FOR_REVIEW_START' };
}

export function parseSummary(comment, identity = CODEX_IDENTITY) {
  if (!isCodex(comment.user, identity, comment.performed_via_github_app)
    || !comment.body?.startsWith('<!-- codex-pull-request-review-summary -->')) return null;
  const row = comment.body.split('\n').find(line => /^\|\s*📝 \*\*Code Review\*\*\s*\|/.test(line));
  if (!row) return null;
  const cells = row.split('|').map(cell => cell.trim());
  const phase = /\*\*(Running|Completed)\*\*/.exec(cells[2])?.[1];
  const commit = /^`([a-f0-9]{7,40})`$/.exec(cells[3])?.[1];
  if (!phase || !commit) return null;
  return { id: comment.id, phase: phase.toLowerCase(), commit, body: row,
    epoch: /datetime="([^"]+)"/.exec(cells[2])?.[1] ?? comment.updated_at };
}

export function lifecycleDecision(state, context, max = 5) {
  if (context.reviewedHeadSha !== state.headSha || context.phase === 'not-started') return 'wait-start';
  if (context.phase === 'running') return 'wait-review';
  if (context.phase !== 'completed') return 'wait-start';
  if (state.state === 'LOOP_LIMIT_REACHED') return 'limit';
  const key = `${context.reviewId}:${context.headSha}:${context.fingerprint}`;
  if (state.processedContexts.includes(key)) return 'duplicate';
  return state.iteration >= max ? 'analyze-only' : 'analyze';
}
export const contextKey = context => `${context.reviewId}:${context.headSha}:${context.fingerprint}`;
export function processed(state, context, findingIds = []) {
  return { ...state, reviewId: context.reviewId, reviewedHeadSha: context.reviewedHeadSha,
    reviewFingerprint: context.fingerprint, lastProcessedReviewId: context.reviewId,
    lastProcessedHeadSha: context.headSha, lastProcessedFindingIds: findingIds,
    processedContexts: [...new Set([...state.processedContexts, contextKey(context)])] };
}

export function reviewRequestDecision(state, context, { mode = 'comment-fallback', graceMs = 420_000, now = Date.now() } = {}) {
  if (!['automatic-only', 'comment-fallback', 'manual'].includes(mode)) throw new Error('Invalid review request policy');
  if (context.phase !== 'not-started' && context.reviewedHeadSha === state.headSha) return 'none';
  if (state.pendingPush || state.lease || state.state === 'LOOP_LIMIT_REACHED') return 'none';
  if (state.reviewRequestHeadSha === state.headSha && state.reviewRequestAttempts >= 1) return 'none';
  if (!state.reviewStartAt || now - Date.parse(state.reviewStartAt) < graceMs) return 'none';
  return mode === 'comment-fallback' ? 'request' : mode === 'manual' ? 'blocked' : 'none';
}

export function parseAnalysis(result, sources) {
  if (!Array.isArray(result?.findings) || result.findings.length !== sources.length) throw new Error('Classify every source exactly once');
  const allowed = new Set(sources.map(source => source.id)), seen = new Set();
  for (const finding of result.findings) {
    if (!allowed.has(finding.id) || seen.has(finding.id) || !['actionable', 'resolved', 'informational'].includes(finding.status)
      || typeof finding.reason !== 'string' || !finding.reason.trim()) throw new Error('Invalid analysis classification');
    seen.add(finding.id);
  }
  return result.findings;
}
export function ciGreen(runs, checks, statuses, headSha, workflowId, ignoredRunIds = [], required = []) {
  const validation = runs.filter(run => (workflowId ? run.workflow_id === workflowId
    : run.path?.split('@')[0] === '.github/workflows/ci.yml') && run.head_sha === headSha && run.event === 'pull_request')
    .sort((a, b) => b.id - a.id)[0];
  if (validation?.status !== 'completed' || validation.conclusion !== 'success') return false;
  const latest = new Map();
  for (const check of checks) {
    const runId = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(check.details_url ?? '')?.[1];
    if (runId && ignoredRunIds.map(String).includes(runId)) continue;
    const key = `${check.app?.id}:${check.name}`;
    if (!latest.has(key) || check.id > latest.get(key).id) latest.set(key, check);
  }
  const statusMap = new Map();
  for (const status of statuses) if (!statusMap.has(status.context)
    || status.id > statusMap.get(status.context).id) statusMap.set(status.context, status);
  const good = [...latest.values()].every(check => check.status === 'completed' && ['success', 'neutral', 'skipped'].includes(check.conclusion))
    && [...statusMap.values()].every(status => status.state === 'success');
  return good && required.every(requirement => [...latest.values()].some(check => check.name === requirement.context
    && (!requirement.app_id || requirement.app_id === -1 || requirement.app_id === check.app?.id)
    && check.status === 'completed' && ['success', 'neutral', 'skipped'].includes(check.conclusion))
    || ((!requirement.app_id || requirement.app_id === -1) && statusMap.get(requirement.context)?.state === 'success'));
}

export function assertFresh(plan, pr, context) {
  if (pr.head.sha !== plan.headSha || context.phase !== 'completed'
    || context.reviewedHeadSha !== plan.headSha || context.fingerprint !== plan.context.fingerprint) {
    throw new Error('STALE_PLAN: HEAD or review context changed');
  }
}
export const protectedPath = path => /^(\.github\/|\.codex\/|\.agents\/|scripts\/agent-loop\/)/.test(path)
  || /(^|\/)(AGENTS\.md|\.gitmodules|\.gitattributes)$/.test(path);
