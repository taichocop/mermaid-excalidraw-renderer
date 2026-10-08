import { CODEX_IDENTITY, isCodex, parseSummary, hash } from './core.mjs';

export function buildContext(pr, data, identity = CODEX_IDENTITY) {
  const reviews = data.reviews.filter(review => isCodex(review.user, identity, review.performed_via_github_app)
    && review.commit_id === pr.head.sha && review.submitted_at && !['PENDING', 'DISMISSED'].includes(review.state))
    .sort((a, b) => b.id - a.id);
  const summary = data.summaries.filter(item => item.sha === pr.head.sha)
    .sort((a, b) => Date.parse(b.epoch) - Date.parse(a.epoch))[0];
  const phase = summary?.phase ?? (reviews.length ? 'completed' : 'not-started');
  const reviewId = reviews[0]?.id ?? (summary ? `summary:${summary.id}:${summary.epoch}` : null);
  const reviewedHeadSha = summary?.sha ?? reviews[0]?.commit_id ?? null;
  const currentReviewIds = new Set(data.reviews.filter(review => isCodex(review.user, identity, review.performed_via_github_app)
    && review.commit_id === pr.head.sha).map(review => review.id));
  for (const comment of data.comments) {
    if (isCodex(comment.user, identity, comment.performed_via_github_app) && comment.commit_id === pr.head.sha
      && !data.reviews.some(review => review.id === comment.pull_request_review_id)) {
      throw new Error('Incomplete review snapshot: current Codex comment has no verified parent review');
    }
  }
  const comments = new Map(data.comments.filter(comment => isCodex(comment.user, identity, comment.performed_via_github_app)
    && comment.commit_id === pr.head.sha && currentReviewIds.has(comment.pull_request_review_id)).map(comment => [comment.id, comment]));
  const observations = [], findings = [], sources = [];
  for (const thread of data.threads) {
    const first = thread.comments.nodes[0];
    const comment = comments.get(first?.databaseId);
    if (!comment) continue;
    const discussion = thread.comments.nodes.map(item => ({ id: item.databaseId, body: item.body, author: item.author?.login }));
    const item = { threadId: thread.id, commentId: comment.id, path: thread.path,
      line: thread.line, body: comment.body, severity: /badge\/(P[0-3])-/.exec(comment.body)?.[1] ?? null,
      resolved: thread.isResolved, outdated: thread.isOutdated, headSha: comment.commit_id,
      discussion, sourceHash: hash({ commentId: comment.id, body: comment.body, discussion }) };
    observations.push(item);
    if (!item.resolved && !item.outdated) {
      findings.push(item);
      sources.push({ ...item, id: `comment:${item.commentId}` });
    }
  }
  for (const review of reviews) sources.push({ id: `review:${review.id}`, body: review.body || '', threadId: null });
  // The status table is completion evidence, never a substitute for fetching threads.
  if (!sources.length && summary) sources.push({ id: `summary:${summary.id}`, body: summary.body, threadId: null });
  observations.sort((a, b) => a.commentId - b.commentId);
  findings.sort((a, b) => a.commentId - b.commentId);
  sources.sort((a, b) => a.id.localeCompare(b.id));
  const context = { pullRequest: pr.number, base: pr.base ? { ref: pr.base.ref, sha: pr.base.sha } : null, headSha: pr.head.sha, reviewedHeadSha, reviewId, phase,
    summary: summary ? { id: summary.id, epoch: summary.epoch, phase: summary.phase, sha: summary.sha, body: summary.body } : null,
    reviews: reviews.map(review => ({ id: review.id, state: review.state, body: review.body || '', sha: review.commit_id })),
    findings, sources, observations };
  return { ...context, fingerprint: hash(context) };
}

export async function getReviewContext(api, pr, identity = CODEX_IDENTITY) {
  const [reviews, comments, threads, issueComments] = await Promise.all([
    api.pages(`/pulls/${pr.number}/reviews`), api.pages(`/pulls/${pr.number}/comments`),
    api.threads(pr.number), api.pages(`/issues/${pr.number}/comments`),
  ]);
  const summaries = [];
  for (const comment of issueComments) {
    const item = parseSummary(comment, identity);
    if (!item || !pr.head.sha.startsWith(item.commit)) continue;
    // Resolve GitHub's observed abbreviation to an unambiguous full commit SHA.
    const commit = await api.repo(`/commits/${item.commit}`);
    if (commit.sha === pr.head.sha) summaries.push({ ...item, sha: commit.sha });
  }
  return buildContext(pr, { reviews, comments, threads, summaries }, identity);
}
