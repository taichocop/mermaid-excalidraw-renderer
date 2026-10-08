import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { GitHub } from './github.mjs';
import { AgentLoop } from './service.mjs';

const args = process.argv.slice(2);
const value = key => args.find(arg => arg.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const number = Number(value('pr') || 1);
const interval = Number(value('interval') || 45);
if (!Number.isInteger(number) || number < 1 || interval < 30 || interval > 60) throw new Error('Use a PR number and 30–60 second interval');
const token = process.env.GH_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const api = new GitHub(process.env.GITHUB_REPOSITORY || 'taichocop/mermaid-excalidraw-renderer', token);
const loop = new AgentLoop(api, { mode: value('request-mode') || 'comment-fallback',
  graceMs: Number(process.env.REVIEW_START_GRACE_PERIOD_SECONDS || 420) * 1000 });
const end = Date.now() + Number(value('timeout-minutes') || 60) * 60_000;
let previous = null;
do {
  const plan = await loop.plan(number, { observeOnly: true });
  if (plan.mode === 'ready') plan.state = await loop.ready(plan);
  const compact = { state: plan.state, mode: plan.mode, headSha: plan.pr?.head.sha,
    reviewedHeadSha: plan.context?.reviewedHeadSha, reviewId: plan.context?.reviewId,
    fingerprint: plan.context?.fingerprint, findings: plan.context?.findings ?? [] };
  const serialized = JSON.stringify(compact);
  if (serialized !== previous || args.includes('--once')) console.log(serialized);
  previous = serialized;
  // The calling Codex session analyzes/fixes/validates and resumes this monitor.
  if (plan.mode === 'analyze' || ['READY_TO_MERGE', 'BLOCKED', 'FAILED', 'LOOP_LIMIT_REACHED'].includes(plan.state)
    || args.includes('--once')) break;
  if (Date.now() >= end) { console.log('Interactive timeout; persistent waiting state retained.'); break; }
  await setTimeout(interval * 1000);
} while (true);
