import { initialState, migrateState, onHead, eligible, lifecycleDecision, reviewRequestDecision,
  processed, ciGreen, assertFresh, hash, CODEX_IDENTITY } from './core.mjs';
import { getReviewContext } from './review.mjs';

export class AgentLoop {
  constructor(api, { identity = CODEX_IDENTITY, max = 5, mode = 'comment-fallback', graceMs = 420_000,
    now = () => new Date().toISOString(), runId = 'interactive' } = {}) {
    if (!Number.isInteger(max) || max < 1) throw new Error('Invalid iteration limit');
    this.api = api; this.identity = identity; this.max = max; this.mode = mode;
    this.graceMs = graceMs; this.now = now; this.runId = runId;
  }
  async load(number) {
    const [pr, record] = await Promise.all([this.api.repo(`/pulls/${number}`), this.api.loadState(number)]);
    return { pr, record, state: migrateState(record.value || initialState()) };
  }
  async save(record, state, pr) {
    state.updatedAt = this.now();
    await this.api.saveState(record, state, pr.base.sha);
    return state;
  }
  context(pr) { return getReviewContext(this.api, pr, this.identity); }
  async plan(number, { observeOnly = false } = {}) {
    const { pr, record } = await this.load(number);
    let state = migrateState(record.value || initialState());
    if (!eligible(pr, this.api.repository)) {
      await this.api.removeReady(number);
      if (record.value) await this.save(record, { ...state, state: 'IDLE', lease: null, reason: 'PR is not eligible' }, pr);
      return { mode: 'skip', state: 'IDLE', pr };
    }
    if (state.pendingPush) {
      if (pr.head.sha === state.pendingPush.sha) {
        state = processed({ ...state, iteration: state.pendingPush.iteration }, state.pendingPush.context, state.pendingPush.findingIds);
        state.pendingPush = null; state.lease = null;
      } else {
        await this.api.removeReady(number);
        await this.save(record, { ...state, state: 'BLOCKED', reason: 'Interrupted push requires reconciliation' }, pr);
        return { mode: 'skip', state: 'BLOCKED', pr };
      }
    }
    state = onHead(state, pr.head.sha, this.now());
    const context = await this.context(pr);
    const changed = state.reviewFingerprint && state.reviewFingerprint !== context.fingerprint;
    if (changed || state.state !== 'READY_TO_MERGE' || context.phase !== 'completed') await this.api.removeReady(number);
    const decision = lifecycleDecision(state, context, this.max);
    if (['wait-start', 'wait-review'].includes(decision)) {
      state = { ...state, reviewedHeadSha: context.reviewedHeadSha, reviewId: context.reviewId,
        reviewFingerprint: context.fingerprint, lastValidationSha: null, lease: null,
        state: state.state === 'LOOP_LIMIT_REACHED' ? state.state
          : decision === 'wait-start' ? 'WAITING_FOR_REVIEW_START' : 'WAITING_FOR_REVIEW' };
      await this.save(record, state, pr);
      const request = reviewRequestDecision(state, context, { mode: this.mode, graceMs: this.graceMs, now: Date.parse(this.now()) });
      if (request === 'blocked') {
        state.state = 'BLOCKED'; state.reason = 'Current HEAD review has not started; manual policy';
        await this.save(record, state, pr);
      } else if (request === 'request') {
        // Reserve before posting: delivery uncertainty never causes a second request.
        const current = await this.api.repo(`/pulls/${number}`);
        const fresh = await this.context(current);
        if (current.head.sha !== state.headSha || fresh.phase !== 'not-started') return { mode: 'skip', state: 'WAITING_FOR_REVIEW_START', pr: current, context: fresh };
        state.reviewRequestHeadSha = state.headSha; state.reviewRequestAttempts = 1; state.reviewRequestAt = this.now();
        await this.save(record, state, pr);
        await this.api.addComment(number, `<!-- agent-loop-review-request:${state.headSha} -->\n@codex review`);
      }
      return { mode: 'skip', state: state.state, pr, context };
    }
    if (decision === 'limit') return { mode: 'skip', state: 'LOOP_LIMIT_REACHED', pr, context };
    if (decision === 'duplicate' && state.lastValidationSha === pr.head.sha
      && state.reviewFingerprint === context.fingerprint) {
      return { mode: 'ready', state: state.state, pr, headSha: pr.head.sha, context, findings: state.analysis || [] };
    }
    if (observeOnly) {
      await this.save(record, { ...state, state: 'PROCESSING_REVIEW', reviewedHeadSha: context.reviewedHeadSha,
        reviewId: context.reviewId, reviewFingerprint: context.fingerprint }, pr);
      return { mode: 'analyze', state: 'PROCESSING_REVIEW', pr, headSha: pr.head.sha, context };
    }
    if (state.lease && state.lease.runId !== this.runId) {
      const run = await this.api.repo(`/actions/runs/${state.lease.runId}`);
      if (run.status !== 'completed') return { mode: 'skip', state: state.state, pr, context };
    }
    await this.api.removeReady(number);
    await this.save(record, { ...state, state: 'PROCESSING_REVIEW', reviewedHeadSha: context.reviewedHeadSha,
      reviewId: context.reviewId, reviewFingerprint: context.fingerprint, lastValidationSha: null,
      lease: { runId: this.runId, headSha: pr.head.sha } }, pr);
    return { mode: 'analyze', state: 'PROCESSING_REVIEW', pr, headSha: pr.head.sha, context, decision };
  }
  async implementation(number, phase) {
    const { pr, record, state } = await this.load(number);
    if (!eligible(pr, this.api.repository)) throw new Error('PR no longer eligible');
    const allowed = {
      IMPLEMENTING: ['IDLE', 'WAITING_FOR_REVIEW_START', 'FAILED', 'BLOCKED'],
      VALIDATING: ['IMPLEMENTING'], PUSHING: ['VALIDATING'],
    };
    if (!allowed[phase]?.includes(state.state)) throw new Error('Invalid implementation transition');
    const next = { ...onHead(state, pr.head.sha, this.now()), state: phase };
    await this.api.removeReady(number);
    await this.save(record, next, pr);
    return next;
  }
  async assertPlan(plan) {
    const loaded = await this.load(plan.pr.number);
    if (!eligible(loaded.pr, this.api.repository)) throw new Error('PR no longer eligible');
    const context = await this.context(loaded.pr);
    assertFresh(plan, loaded.pr, context);
    return { ...loaded, context };
  }
  async decide(plan, findings) {
    const { pr, record, state } = await this.assertPlan(plan);
    const actionable = findings.filter(finding => finding.status === 'actionable');
    if (actionable.length && state.iteration >= this.max) {
      await this.api.removeReady(pr.number);
      await this.save(record, { ...processed(state, plan.context, actionable.map(item => item.id)),
        state: 'LOOP_LIMIT_REACHED', lease: null }, pr);
      return { ...plan, mode: 'skip', findings };
    }
    await this.save(record, { ...state, state: actionable.length ? 'FIXING' : 'VALIDATING', analysis: findings }, pr);
    return { ...plan, mode: actionable.length ? 'fix' : 'clean', findings };
  }
  async enterValidation(plan) {
    const { pr, record, state } = await this.assertPlan(plan);
    await this.save(record, { ...state, state: 'VALIDATING' }, pr);
  }
  async reservePush(plan, sha) {
    const { pr, record, state } = await this.assertPlan(plan);
    if (state.iteration >= this.max) throw new Error('LOOP_LIMIT_REACHED');
    const findingIds = plan.findings.filter(item => item.status === 'actionable').map(item => item.id);
    await this.save(record, { ...state, state: 'PUSHING', pendingPush: {
      sha, parent: plan.headSha, iteration: state.iteration + 1, context: plan.context, findingIds,
    } }, pr);
  }
  async published(plan, sha) {
    const { pr, record, state } = await this.load(plan.pr.number);
    if (pr.head.sha !== sha || state.pendingPush?.sha !== sha) throw new Error('Published HEAD does not match reservation');
    const updated = processed({ ...state, iteration: state.pendingPush.iteration }, plan.context, state.pendingPush.findingIds);
    const next = onHead({ ...updated, pendingPush: null, lease: null }, sha, this.now());
    next.state = 'WAITING_FOR_REVIEW_START';
    await this.api.removeReady(pr.number);
    await this.save(record, next, pr);
    await this.resolveUnchanged(plan);
    return next;
  }
  async resolveUnchanged(plan) {
    const [threads, comments] = await Promise.all([this.api.threads(plan.pr.number), this.api.pages(`/pulls/${plan.pr.number}/comments`)]);
    for (const finding of plan.findings ?? []) {
      if (!['actionable', 'resolved'].includes(finding.status)) continue;
      const source = plan.context.sources.find(source => source.id === finding.id);
      if (!source?.threadId) continue;
      const thread = threads.find(item => item.id === source.threadId);
      const comment = comments.find(item => item.id === source.commentId);
      if (!thread || !comment || thread.isResolved) continue;
      const discussion = thread.comments.nodes.map(item => ({ id: item.databaseId, body: item.body, author: item.author?.login }));
      if (hash({ commentId: comment.id, body: comment.body, discussion }) !== source.sourceHash) continue;
      await this.api.resolveThread(source.threadId);
    }
  }
  async ready(plan, { validated = false } = {}) {
    let { pr, record, state, context } = await this.assertPlan(plan);
    if (validated) {
      if (plan.findings.some(item => item.status === 'actionable')) throw new Error('Actionable findings prevent ready');
      await this.resolveUnchanged(plan);
      context = await this.context(pr);
      // Only our validated resolutions may have changed the snapshot.
      const previous = new Map(plan.context.sources.map(source => [source.id, source]));
      if (context.sources.some(source => !previous.has(source.id) || hash(source) !== hash(previous.get(source.id)))) throw new Error('STALE_PLAN: new or edited finding');
      state = { ...processed(state, context), analysis: plan.findings, lastValidationSha: pr.head.sha,
        state: 'WAITING_FOR_CI', lease: null };
      await this.save(record, state, pr);
    }
    if (state.lastValidationSha !== pr.head.sha || state.reviewFingerprint !== context.fingerprint) throw new Error('Missing current validation');
    await this.api.removeReady(pr.number);
    if (pr.mergeable === false) {
      await this.save(record, { ...state, state: 'BLOCKED', reason: 'Merge conflict' }, pr); return 'BLOCKED';
    }
    const data = await this.api.ciData(pr);
    if (pr.mergeable !== true || !ciGreen(data.runs, data.checks, data.statuses, pr.head.sha,
      data.workflowId, data.ignoredRunIds, data.required)) {
      await this.save(record, { ...state, state: 'WAITING_FOR_CI' }, pr); return 'WAITING_FOR_CI';
    }
    const freshPR = await this.api.repo(`/pulls/${pr.number}`);
    const freshContext = await this.context(freshPR);
    assertFresh({ ...plan, context }, freshPR, freshContext);
    if (!eligible(freshPR, this.api.repository) || freshPR.mergeable !== true || state.iteration > this.max) throw new Error('Readiness conditions changed');
    await this.api.addReady(pr.number);
    const postLabelPR = await this.api.repo(`/pulls/${pr.number}`);
    if (!eligible(postLabelPR, this.api.repository) || postLabelPR.head.sha !== plan.headSha) {
      await this.api.removeReady(pr.number); throw new Error('HEAD changed while labeling');
    }
    const summaryKey = hash({ sha: plan.headSha, fingerprint: context.fingerprint, iteration: state.iteration });
    if (state.readySummaryKey !== summaryKey) {
      // Reserve the summary before delivery, just like the fallback request.
      await this.save(record, { ...state, readySummaryKey: summaryKey }, pr);
      await this.api.addComment(pr.number, `Agent loop completed.\n\nHEAD: ${pr.head.sha}\nIterations: ${state.iteration}\nLatest Codex Review: completed\nUnresolved actionable Codex findings: 0\nCI: PASS\nBuild: PASS\nTypecheck: PASS\nTests: PASS\n\nREADY_TO_MERGE\n\nMerge is left to a human.`);
    }
    await this.save(record, { ...state, state: 'READY_TO_MERGE', readySummaryKey: summaryKey }, pr);
    return 'READY_TO_MERGE';
  }
  async fail(number, reason) {
    const { pr, record, state } = await this.load(number);
    await this.api.removeReady(number);
    await this.save(record, { ...state, lease: null, state: state.pendingPush ? 'PUSHING'
      : reason?.includes('protected') ? 'BLOCKED' : 'FAILED', reason }, pr);
  }
}
