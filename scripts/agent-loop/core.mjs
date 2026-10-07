import { createHash } from 'node:crypto';

export const initialState = () => ({
  iteration: 0, lastProcessedReviewId: null, lastProcessedHeadSha: null,
  state: 'WAITING_FOR_REVIEW', processedReviewIds: [], pendingPush: null,
});

export function isCodex(user, identity) {
  return Boolean(identity.login && identity.id && user?.type === 'Bot'
    && user.login === identity.login && String(user.id) === String(identity.id));
}

export function eligible(pr, repository) {
  return pr.state === 'open' && !pr.draft && pr.head.repo?.full_name === repository
    && pr.base.repo?.full_name === repository
    && pr.labels.some(label => label.name === 'agent-loop');
}

export function selectReview(reviews, headSha, identity) {
  return reviews.filter(review => isCodex(review.user, identity)
    && review.commit_id === headSha && review.submitted_at
    && !['PENDING', 'DISMISSED'].includes(review.state))
    .sort((a, b) => b.id - a.id)[0];
}

export function reviewDecision(state, review, headSha, maxIterations) {
  if (!review || review.commit_id !== headSha) return 'skip';
  if (state.processedReviewIds.includes(review.id)) return 'duplicate';
  if (state.lastProcessedReviewId && review.id <= state.lastProcessedReviewId) return 'stale';
  if (state.state === 'LOOP_LIMIT_REACHED') return 'limit';
  // The final review after the fifth push may still certify a clean result.
  return state.iteration >= maxIterations ? 'analyze-only' : 'analyze';
}

export function markProcessed(state, review, headSha) {
  return { ...state, lastProcessedReviewId: review.id, lastProcessedHeadSha: headSha,
    processedReviewIds: [...new Set([...state.processedReviewIds, review.id])] };
}

export function contextHash(context) {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex');
}

export function parseAnalysis(result, sources) {
  if (!Array.isArray(result?.findings) || result.findings.length !== sources.length) {
    throw new Error('Analysis must classify every supplied finding exactly once');
  }
  const allowed = new Set(sources.map(source => source.id));
  const seen = new Set();
  for (const finding of result.findings) {
    if (!allowed.has(finding.id) || seen.has(finding.id)
      || !['actionable', 'resolved', 'informational'].includes(finding.status)
      || typeof finding.reason !== 'string' || !finding.reason.trim()) {
      throw new Error('Invalid or incomplete finding classification');
    }
    seen.add(finding.id);
  }
  return result.findings;
}

export function ciGreen(runs, checks, statuses, headSha, runId) {
  const validation = runs.filter(run => run.path === '.github/workflows/ci.yml'
    && run.head_sha === headSha && run.event === 'pull_request')
    .sort((a, b) => b.id - a.id)[0];
  if (validation?.status !== 'completed' || validation.conclusion !== 'success') return false;
  // latest check per app/name; exclude only this loop/observer, never other CI.
  const latest = new Map();
  for (const check of checks) {
    if (/\/actions\/runs\//.test(check.details_url ?? '') &&
      (check.details_url.includes(`/actions/runs/${runId}/`) ||
       check.details_url.endsWith(`/actions/runs/${runId}`))) continue;
    if (['observe', 'resolve', 'iteration'].includes(check.name)
      && check.app?.slug === 'github-actions') continue;
    const key = `${check.app?.id}:${check.name}`;
    if (!latest.has(key) || check.id > latest.get(key).id) latest.set(key, check);
  }
  return [...latest.values()].every(check => check.status === 'completed'
    && ['success', 'neutral', 'skipped'].includes(check.conclusion))
    && statuses.every(status => status.state === 'success');
}
