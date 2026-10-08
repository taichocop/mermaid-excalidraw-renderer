import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseAnalysis } from './core.mjs';

export function inspectCheckout(cwd = process.cwd()) {
  const git = args => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    { cwd, encoding: 'utf8' }).trim();
  return { sha: git(['rev-parse', 'HEAD']), parent: git(['rev-parse', 'HEAD^']),
    clean: !git(['status', '--porcelain']) };
}

// The calling Codex session runs validation and supplies its result. This local
// handoff persists it against the exact checkout, review fingerprint and push.
export class InteractiveHandoff {
  constructor(loop, directory, checkout = inspectCheckout) {
    this.loop = loop; this.directory = resolve(directory); this.checkout = checkout;
    mkdirSync(this.directory, { recursive: true });
  }
  read(name) { return JSON.parse(readFileSync(resolve(this.directory, name), 'utf8')); }
  write(name, value) { writeFileSync(resolve(this.directory, name), JSON.stringify(value, null, 2)); return value; }
  snapshot(plan) {
    if (plan.mode !== 'analyze') throw new Error('Only completed reviews can be handed off');
    return this.write('plan.json', plan);
  }
  async decide(result) {
    const plan = this.read('plan.json');
    const next = await this.loop.decide(plan, parseAnalysis(result, plan.context.sources));
    return this.write('plan.json', next);
  }
  assertCheckout(plan, sha) {
    const checkout = this.checkout();
    if (!checkout.clean || checkout.sha !== sha || (plan.mode === 'fix' ? checkout.parent !== plan.headSha : sha !== plan.headSha)) {
      throw new Error('Interactive checkout must be clean and match the exact planned parent/validated SHA');
    }
    return checkout;
  }
  async validated(evidence) {
    const plan = this.read('plan.json');
    if (!['fix', 'clean'].includes(plan.mode) || !/^[a-f0-9]{40}$/.test(evidence?.headSha ?? '')
      || !['lint', 'typecheck', 'tests', 'build', 'browser'].every(key => evidence[key] === true)) {
      throw new Error('Explicit passing validation evidence is required');
    }
    this.assertCheckout(plan, evidence.headSha);
    await this.loop.enterValidation(plan);
    return this.write('validation.json', { ...evidence, fingerprint: plan.context.fingerprint });
  }
  validatedPlan() {
    const plan = this.read('plan.json'), evidence = this.read('validation.json');
    if (evidence.fingerprint !== plan.context.fingerprint) throw new Error('Validation belongs to another review snapshot');
    this.assertCheckout(plan, evidence.headSha);
    return { plan, evidence };
  }
  async reservePush() {
    const { plan, evidence } = this.validatedPlan();
    if (plan.mode !== 'fix') throw new Error('Only a repair may reserve a push');
    await this.loop.reservePush(plan, evidence.headSha);
    return { sha: evidence.headSha, parent: plan.headSha, branch: plan.pr.head.ref };
  }
  async published() {
    const { plan, evidence } = this.validatedPlan();
    return this.loop.published(plan, evidence.headSha);
  }
  async ready() {
    const { plan } = this.validatedPlan();
    if (plan.mode !== 'clean') throw new Error('A repair needs a new HEAD review before ready');
    return this.loop.ready(plan, { validated: true });
  }
}
