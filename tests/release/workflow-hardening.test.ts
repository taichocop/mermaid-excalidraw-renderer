import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

const WORKFLOW_PATH = ".github/workflows/release.yml";
const EXPECTED_REPO = "taichocop/mermaid-excalidraw-renderer";
const EXPECTED_COMMIT = "ce12a9fd801a8abec74cdf8a7d3b0b50dfca40f6";
const EXPECTED_RUN_ID = "40184760282";
const EXPECTED_RUN_ATTEMPT = "1";
const EXPECTED_RELEASE_ASSETS = [
  "LICENSE",
  "SHA256SUMS.txt",
  "THIRD_PARTY_NOTICES.txt",
  "main.js",
  "manifest.json",
  "styles.css",
] as const;

export interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
}

export interface WorkflowJob {
  needs?: string | string[];
  runsOn?: string;
  timeoutMinutes?: string;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

export interface ParsedWorkflow {
  name?: string;
  triggers: string[];
  permissions: Record<string, string>;
  concurrency: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

interface AttestationSubject {
  name: string;
  digest: { sha256: string };
}

interface MockAttestationRecord {
  verificationResult: {
    mediaType: string;
    verifiedTimestamps: Array<{ type: string; timestamp: string }>;
    signature: {
      certificate: {
        certificateIssuer: string;
        subjectAlternativeName: string;
        issuer: string;
        runnerEnvironment: string;
        sourceRepositoryURI: string;
        sourceRepositoryOwnerURI: string;
        sourceRepositoryRef: string;
        sourceRepositoryDigest: string;
        buildSignerURI: string;
        buildSignerDigest: string;
        buildConfigURI: string;
        buildConfigDigest: string;
        runInvocationURI: string;
      };
    };
    statement: {
      _type: string;
      predicateType: string;
      subject: AttestationSubject[];
      predicate: {
        buildDefinition: {
          externalParameters: {
            workflow: {
              repository: string;
              path: string;
              ref: string;
            };
          };
          resolvedDependencies: Array<{
            uri: string;
            digest: { gitCommit: string };
          }>;
        };
        runDetails: {
          metadata: {
            invocationId: string;
          };
        };
      };
    };
  };
}

export function parseReleaseWorkflow(yamlText: string): ParsedWorkflow {
  const lines = yamlText.split(/\r?\n/);
  const result: ParsedWorkflow = {
    triggers: [],
    permissions: {},
    concurrency: {},
    jobs: {},
  };

  let topSection: "" | "on" | "permissions" | "concurrency" | "jobs" = "";
  let currentJob = "";
  let jobSection: "" | "needs" | "permissions" | "steps" = "";
  let currentStep: WorkflowStep | null = null;
  let stepSubSection: "" | "with" | "env" = "";
  let blockKey: "" | "run" | "with" = "";
  let blockWithSubKey = "";
  let blockIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    assert.ok(!rawLine.includes("\t"), `Tab indentation is prohibited at line ${i + 1}`);
    const trimmed = rawLine.trim();

    if (blockKey) {
      const indent = rawLine.search(/\S/);
      if (trimmed === "" || indent >= blockIndent) {
        const content = trimmed === "" ? "" : rawLine.slice(blockIndent);
        if (blockKey === "run" && currentStep) {
          currentStep.run = currentStep.run ? `${currentStep.run}\n${content}` : content;
        } else if (blockKey === "with" && currentStep?.with && blockWithSubKey) {
          const prev = currentStep.with[blockWithSubKey] ?? "";
          currentStep.with[blockWithSubKey] = prev ? `${prev}\n${content}` : content;
        }
        continue;
      }
      blockKey = "";
      blockWithSubKey = "";
    }

    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = rawLine.search(/\S/);

    if (indent === 0) {
      currentJob = "";
      jobSection = "";
      currentStep = null;
      stepSubSection = "";
      if (trimmed.startsWith("name:")) {
        result.name = trimmed.slice(5).trim();
        topSection = "";
      } else if (trimmed === "on:") {
        topSection = "on";
      } else if (trimmed === "permissions:") {
        topSection = "permissions";
      } else if (trimmed === "concurrency:") {
        topSection = "concurrency";
      } else if (trimmed === "jobs:") {
        topSection = "jobs";
      } else {
        throw new Error(`Unexpected top-level key at line ${i + 1}: ${trimmed}`);
      }
      continue;
    }

    if (topSection === "on") {
      result.triggers.push(trimmed);
      continue;
    }
    if (topSection === "permissions" && indent === 2) {
      const [k, v] = trimmed.split(":").map((s) => s.trim());
      if (k && v) result.permissions[k] = v;
      continue;
    }
    if (topSection === "concurrency" && indent === 2) {
      const [k, v] = trimmed.split(":").map((s) => s.trim());
      if (k && v) result.concurrency[k] = v;
      continue;
    }

    if (topSection === "jobs") {
      if (indent === 2 && trimmed.endsWith(":")) {
        currentJob = trimmed.slice(0, -1);
        result.jobs[currentJob] = { steps: [] };
        jobSection = "";
        currentStep = null;
        stepSubSection = "";
        continue;
      }
      const job = result.jobs[currentJob];
      assert.ok(job, `Missing current job context at line ${i + 1}`);

      if (indent === 4) {
        currentStep = null;
        stepSubSection = "";
        if (trimmed.startsWith("needs:")) {
          const inline = trimmed.slice(6).trim();
          if (inline) {
            job.needs = inline;
            jobSection = "";
          } else {
            job.needs = [];
            jobSection = "needs";
          }
        } else if (trimmed.startsWith("runs-on:")) {
          job.runsOn = trimmed.slice(8).trim();
          jobSection = "";
        } else if (trimmed.startsWith("timeout-minutes:")) {
          job.timeoutMinutes = trimmed.slice(16).trim();
          jobSection = "";
        } else if (trimmed === "permissions:") {
          job.permissions = {};
          jobSection = "permissions";
        } else if (trimmed === "steps:") {
          jobSection = "steps";
        } else {
          throw new Error(`Unexpected job key in ${currentJob} at line ${i + 1}: ${trimmed}`);
        }
        continue;
      }

      if (jobSection === "needs" && indent === 6 && trimmed.startsWith("- ")) {
        assert.ok(Array.isArray(job.needs));
        job.needs.push(trimmed.slice(2).trim());
        continue;
      }

      if (jobSection === "permissions" && indent === 6) {
        const [k, v] = trimmed.split(":").map((s) => s.trim());
        if (k && v && job.permissions) job.permissions[k] = v;
        continue;
      }

      if (jobSection === "steps") {
        if (indent === 6 && trimmed.startsWith("- ")) {
          currentStep = {};
          job.steps.push(currentStep);
          stepSubSection = "";
          const rest = trimmed.slice(2).trim();
          if (rest.startsWith("uses:")) {
            currentStep.uses = rest.slice(5).trim();
          } else if (rest.startsWith("name:")) {
            currentStep.name = rest.slice(5).trim();
          } else if (rest.startsWith("run:")) {
            const inlineRun = rest.slice(4).trim();
            if (inlineRun === "|") {
              currentStep.run = "";
              blockKey = "run";
              blockIndent = 10;
            } else {
              currentStep.run = inlineRun;
            }
          }
          continue;
        }
        assert.ok(currentStep, `Missing step context at line ${i + 1}`);
        if (indent === 8) {
          stepSubSection = "";
          if (trimmed.startsWith("name:")) {
            currentStep.name = trimmed.slice(5).trim();
          } else if (trimmed.startsWith("id:")) {
            currentStep.id = trimmed.slice(3).trim();
          } else if (trimmed.startsWith("uses:")) {
            currentStep.uses = trimmed.slice(5).trim();
          } else if (trimmed.startsWith("if:")) {
            currentStep.if = trimmed.slice(3).trim();
          } else if (trimmed === "with:") {
            currentStep.with = {};
            stepSubSection = "with";
          } else if (trimmed === "env:") {
            currentStep.env = {};
            stepSubSection = "env";
          } else if (trimmed.startsWith("run:")) {
            const inlineRun = trimmed.slice(4).trim();
            if (inlineRun === "|") {
              currentStep.run = "";
              blockKey = "run";
              blockIndent = 10;
            } else {
              currentStep.run = inlineRun;
            }
          }
          continue;
        }
        if (indent === 10 && stepSubSection === "with" && currentStep.with) {
          const colonIdx = trimmed.indexOf(":");
          const k = trimmed.slice(0, colonIdx).trim();
          const v = trimmed.slice(colonIdx + 1).trim();
          if (v === "|") {
            currentStep.with[k] = "";
            blockKey = "with";
            blockWithSubKey = k;
            blockIndent = 12;
          } else {
            currentStep.with[k] = v;
          }
          continue;
        }
        if (indent === 10 && stepSubSection === "env" && currentStep.env) {
          const colonIdx = trimmed.indexOf(":");
          const k = trimmed.slice(0, colonIdx).trim();
          const v = trimmed.slice(colonIdx + 1).trim();
          currentStep.env[k] = v;
          continue;
        }
      }
    }
  }

  return result;
}

function extractHeredocScript(runBlock: string): string {
  const match = runBlock.match(/node --input-type=module <<'EOF'\n([\s\S]*?)\nEOF(?:\n|$)/);
  assert.ok(match?.[1], "Expected inline node --input-type=module heredoc script");
  return match[1];
}

function extractSubjectPaths(subjectPathInput: string): string[] {
  return subjectPathInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

test("validates workflow YAML structure, triggers, concurrency, and 40-char SHA pinning", async () => {
  const raw = await readFile(WORKFLOW_PATH, "utf8");
  const wf = parseReleaseWorkflow(raw);

  assert.equal(wf.name, "Release plugin");
  assert.deepEqual(wf.triggers, ["push:", "tags: ['*.*.*']"]);
  assert.doesNotMatch(wf.triggers.join(" "), /pull_request|workflow_dispatch|schedule/);
  assert.deepEqual(wf.permissions, { contents: "read" });
  assert.deepEqual(wf.concurrency, {
    group: "release-${{ github.ref }}",
    "cancel-in-progress": "false",
  });

  const jobNames = Object.keys(wf.jobs);
  assert.deepEqual(jobNames, ["validate", "attest", "draft"]);

  for (const [jobName, job] of Object.entries(wf.jobs)) {
    for (const step of job.steps) {
      if (!step.uses) continue;
      assert.match(
        step.uses,
        /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}\s+#\s*v\d+(?:\.\d+)*$/,
        `Step in ${jobName} must pin action to full 40-char commit SHA: ${step.uses}`,
      );
    }
  }
});

test("enforces least privilege and strict permission isolation across validate, attest, and draft", async () => {
  const wf = parseReleaseWorkflow(await readFile(WORKFLOW_PATH, "utf8"));
  const { validate, attest, draft } = wf.jobs;
  assert.ok(validate && attest && draft);

  assert.equal(validate.permissions, undefined);
  assert.equal(validate.needs, undefined);

  assert.equal(attest.needs, "validate");
  assert.deepEqual(attest.permissions, {
    contents: "read",
    "id-token": "write",
    attestations: "write",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(attest.permissions ?? {}, "artifact-metadata"),
    false,
  );
  assert.equal(attest.permissions?.["contents"], "read");

  assert.deepEqual(draft.needs, ["validate", "attest"]);
  assert.deepEqual(draft.permissions, {
    contents: "write",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(draft.permissions ?? {}, "id-token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(draft.permissions ?? {}, "attestations"), false);
});

test("isolates OIDC signing from dependency installation, build scripts, and untrusted bundle execution", async () => {
  const wf = parseReleaseWorkflow(await readFile(WORKFLOW_PATH, "utf8"));
  const { validate, attest, draft } = wf.jobs;
  assert.ok(validate && attest && draft);

  for (const [name, job] of Object.entries({ validate, attest, draft })) {
    const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    assert.ok(checkout, `${name} must have a checkout step`);
    assert.deepEqual(checkout.with, {
      "persist-credentials": "false",
      "fetch-depth": "0",
    });

    const sourceStep = job.steps.find((s) => s.run?.includes("node scripts/validate-release-source.mjs"));
    assert.ok(sourceStep, `${name} must verify tag commit and main ancestry`);
    assert.equal(sourceStep.env?.["RELEASE_TAG"], "${{ github.ref_name }}");
    assert.ok(sourceStep.run?.includes("git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main"));
  }

  for (const step of attest.steps) {
    const runText = step.run ?? "";
    assert.doesNotMatch(runText, /\bnpm\s+(ci|install|run|test|exec)\b/);
    assert.doesNotMatch(runText, /\bnpx\b/);
    assert.doesNotMatch(runText, /node\s+.*main\.js/);
  }

  for (const [name, job] of Object.entries({ attest, draft })) {
    const download = job.steps.find((s) => s.uses?.startsWith("actions/download-artifact@"));
    assert.ok(download, `${name} must download release-assets`);
    assert.deepEqual(download.with, {
      name: "release-assets",
      path: "release-assets",
    });
  }
});

test("signs all 6 required release assets and resolves basename subject names without altering the 6-asset contract", async () => {
  const wf = parseReleaseWorkflow(await readFile(WORKFLOW_PATH, "utf8"));
  const attestJob = wf.jobs["attest"];
  assert.ok(attestJob);

  const attestStep = attestJob.steps.find((s) => s.uses?.startsWith("actions/attest@"));
  assert.ok(attestStep, "attest job must include actions/attest step");
  assert.equal(attestStep.id, "attest");
  assert.equal(
    attestStep.uses,
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2",
  );

  const subjectPathRaw = attestStep.with?.["subject-path"] ?? "";
  const subjectPaths = extractSubjectPaths(subjectPathRaw);
  assert.equal(subjectPaths.length, EXPECTED_RELEASE_ASSETS.length);
  assert.deepEqual(
    subjectPaths,
    EXPECTED_RELEASE_ASSETS.map((name: string) => `release-assets/${name}`),
  );
  const derivedSubjectNames = subjectPaths.map((p) => basename(p)).sort();
  assert.deepEqual(derivedSubjectNames, [...EXPECTED_RELEASE_ASSETS]);
});

test("executes the actual workflow pre-signing verification and post-signing verification script against valid and hostile/malformed fixtures", async () => {
  const wf = parseReleaseWorkflow(await readFile(WORKFLOW_PATH, "utf8"));
  const attestJob = wf.jobs["attest"];
  assert.ok(attestJob);

  const preVerifyStep = attestJob.steps.find((s) => s.name === "Verify release assets before signing");
  const postVerifyStep = attestJob.steps.find(
    (s) => s.name === "Verify generated attestation bundle and GitHub API record",
  );
  assert.ok(preVerifyStep?.run && postVerifyStep?.run);

  const preScript = extractHeredocScript(preVerifyStep.run);
  const postScript = extractHeredocScript(postVerifyStep.run);

  const workDir = await mkdtemp(join(tmpdir(), "mermaid-attest-test-"));
  try {
    const repoRoot = process.cwd();
    const manifestJson = JSON.parse(await readFile(join(repoRoot, "manifest.json"), "utf8")) as {
      version: string;
    };
    const expectedTag = manifestJson.version;
    const wrongTag = expectedTag === "999.999.999" ? "999.999.998" : "999.999.999";
    for (const file of ["manifest.json", "package.json", "package-lock.json", "versions.json"]) {
      await writeFile(join(workDir, file), await readFile(join(repoRoot, file), "utf8"));
    }
    const scriptsDir = join(workDir, "scripts");
    const releaseAssetsDir = join(workDir, "release-assets");
    const binDir = join(workDir, "bin");
    const bundleOutDir = join(workDir, "runner-temp");
    spawnSync("mkdir", ["-p", scriptsDir, releaseAssetsDir, binDir, bundleOutDir]);
    await writeFile(
      join(scriptsDir, "validate-release.mjs"),
      await readFile(join(repoRoot, "scripts/validate-release.mjs"), "utf8"),
    );

    const sums: string[] = [];
    const digests = new Map<string, string>();
    for (const name of EXPECTED_RELEASE_ASSETS.filter((n: string) => n !== "SHA256SUMS.txt")) {
      const content =
        name === "manifest.json"
          ? await readFile(join(repoRoot, "manifest.json"))
          : Buffer.from(`fixture-content-for-${name}`);
      await writeFile(join(releaseAssetsDir, name), content);
      const hex = createHash("sha256").update(content).digest("hex");
      digests.set(name, hex);
      sums.push(`${hex}  ${name}`);
    }
    const sumsContent = `${sums.join("\n")}\n`;
    await writeFile(join(releaseAssetsDir, "SHA256SUMS.txt"), sumsContent);
    digests.set("SHA256SUMS.txt", createHash("sha256").update(sumsContent).digest("hex"));

    const bundlePath = join(bundleOutDir, "attestation.jsonl");
    await writeFile(bundlePath, `${JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" })}\n`);

    const preRes = spawnSync("node", ["--input-type=module", "-e", preScript], {
      cwd: workDir,
      env: { ...process.env, RELEASE_TAG: expectedTag },
      encoding: "utf8",
    });
    assert.equal(preRes.status, 0, preRes.stderr);

    const preBadTag = spawnSync("node", ["--input-type=module", "-e", preScript], {
      cwd: workDir,
      env: { ...process.env, RELEASE_TAG: wrongTag },
      encoding: "utf8",
    });
    assert.notEqual(preBadTag.status, 0);

    const mockGhPath = join(binDir, "gh");
    const mockResponsePath = join(workDir, "mock-gh-response.json");
    await writeFile(
      mockGhPath,
      `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync(${JSON.stringify(mockResponsePath)}, 'utf8'));
const args = process.argv.slice(2);
const isBundle = args.includes('--bundle');
if (state.failMode === 'all' || (state.failMode === 'bundle' && isBundle) || (state.failMode === 'online' && !isBundle)) {
  console.error('mock gh failure');
  process.exit(1);
}
if (state.rawStdout !== undefined) {
  process.stdout.write(state.rawStdout);
  process.exit(0);
}
const records = isBundle ? state.bundleRecords : state.onlineRecords;
process.stdout.write(JSON.stringify(records));
`,
      { mode: 0o755 },
    );

    const expectedSignerUri = `https://github.com/${EXPECTED_REPO}/${WORKFLOW_PATH}@refs/tags/${expectedTag}`;
    const expectedInvocationUri = `https://github.com/${EXPECTED_REPO}/actions/runs/${EXPECTED_RUN_ID}/attempts/${EXPECTED_RUN_ATTEMPT}`;

    const makeValidRecord = (): MockAttestationRecord => ({
      verificationResult: {
        mediaType: "application/vnd.dev.sigstore.verificationresult+json;version=0.1",
        verifiedTimestamps: [{ type: "TransparencyLog", timestamp: "2026-10-27T00:00:00Z" }],
        signature: {
          certificate: {
            certificateIssuer: "CN=sigstore-intermediate,O=sigstore.dev",
            subjectAlternativeName: expectedSignerUri,
            issuer: "https://token.actions.githubusercontent.com",
            runnerEnvironment: "github-hosted",
            sourceRepositoryURI: `https://github.com/${EXPECTED_REPO}`,
            sourceRepositoryOwnerURI: "https://github.com/taichocop",
            sourceRepositoryRef: `refs/tags/${expectedTag}`,
            sourceRepositoryDigest: EXPECTED_COMMIT,
            buildSignerURI: expectedSignerUri,
            buildSignerDigest: EXPECTED_COMMIT,
            buildConfigURI: expectedSignerUri,
            buildConfigDigest: EXPECTED_COMMIT,
            runInvocationURI: expectedInvocationUri,
          },
        },
        statement: {
          _type: "https://in-toto.io/Statement/v1",
          predicateType: "https://slsa.dev/provenance/v1",
          subject: EXPECTED_RELEASE_ASSETS.map((name: string) => ({
            name,
            digest: { sha256: digests.get(name) ?? "" },
          })),
          predicate: {
            buildDefinition: {
              externalParameters: {
                workflow: {
                  repository: `https://github.com/${EXPECTED_REPO}`,
                  path: WORKFLOW_PATH,
                  ref: `refs/tags/${expectedTag}`,
                },
              },
              resolvedDependencies: [
                {
                  uri: `git+https://github.com/${EXPECTED_REPO}@refs/tags/${expectedTag}`,
                  digest: { gitCommit: EXPECTED_COMMIT },
                },
              ],
            },
            runDetails: {
              metadata: {
                invocationId: expectedInvocationUri,
              },
            },
          },
        },
      },
    });

    const runPostVerify = async (
      bundleRecords: unknown,
      onlineRecords: unknown = bundleRecords,
      overrides: {
        failMode?: string;
        rawStdout?: string;
        env?: Record<string, string>;
      } = {},
    ) => {
      await writeFile(
        mockResponsePath,
        JSON.stringify({
          bundleRecords,
          onlineRecords,
          failMode: overrides.failMode,
          rawStdout: overrides.rawStdout,
        }),
      );
      return spawnSync("node", ["--input-type=module", "-e", postScript], {
        cwd: workDir,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          GITHUB_REPOSITORY: EXPECTED_REPO,
          GITHUB_SHA: EXPECTED_COMMIT,
          RELEASE_TAG: expectedTag,
          GITHUB_RUN_ID: EXPECTED_RUN_ID,
          GITHUB_RUN_ATTEMPT: EXPECTED_RUN_ATTEMPT,
          BUNDLE_PATH: bundlePath,
          ...overrides.env,
        },
        encoding: "utf8",
      });
    };

    const passRes = await runPostVerify([makeValidRecord()]);
    assert.equal(passRes.status, 0, passRes.stderr);
    assert.ok(passRes.stdout.includes("Verified local bundle and GitHub API attestations for all 6 release assets."));

    const staleRecord = makeValidRecord();
    staleRecord.verificationResult.signature.certificate.runInvocationURI =
      `https://github.com/${EXPECTED_REPO}/actions/runs/111111111/attempts/1`;
    staleRecord.verificationResult.statement.predicate.runDetails.metadata.invocationId =
      `https://github.com/${EXPECTED_REPO}/actions/runs/111111111/attempts/1`;
    const multiPassRes = await runPostVerify([makeValidRecord()], [staleRecord, makeValidRecord()]);
    assert.equal(multiPassRes.status, 0, multiPassRes.stderr);

    const negativeCases: Array<{
      name: string;
      mutate: (rec: MockAttestationRecord) => void;
    }> = [
      {
        name: "Wrong repository",
        mutate: (rec) => {
          rec.verificationResult.signature.certificate.sourceRepositoryURI =
            "https://github.com/taichocop/other-repo";
        },
      },
      {
        name: "Wrong workflow",
        mutate: (rec) => {
          rec.verificationResult.signature.certificate.buildSignerURI =
            `https://github.com/${EXPECTED_REPO}/.github/workflows/ci.yml@refs/tags/${expectedTag}`;
        },
      },
      {
        name: "Wrong tag",
        mutate: (rec) => {
          rec.verificationResult.signature.certificate.sourceRepositoryRef = `refs/tags/${wrongTag}`;
        },
      },
      {
        name: "Wrong commit",
        mutate: (rec) => {
          rec.verificationResult.signature.certificate.sourceRepositoryDigest = "b".repeat(40);
        },
      },
      {
        name: "Wrong digest",
        mutate: (rec) => {
          const mainSubject = rec.verificationResult.statement.subject.find(
            (s: AttestationSubject) => s.name === "main.js",
          );
          if (mainSubject) mainSubject.digest.sha256 = "0".repeat(64);
        },
      },
      {
        name: "Wrong predicate type",
        mutate: (rec) => {
          rec.verificationResult.statement.predicateType = "https://spdx.dev/Document/v2.3";
        },
      },
      {
        name: "Wrong workflow run ID",
        mutate: (rec) => {
          rec.verificationResult.signature.certificate.runInvocationURI =
            `https://github.com/${EXPECTED_REPO}/actions/runs/999999/attempts/1`;
        },
      },
      {
        name: "Missing verified timestamps / signature proof",
        mutate: (rec) => {
          rec.verificationResult.verifiedTimestamps = [];
        },
      },
      {
        name: "Self-hosted runner environment",
        mutate: (rec) => {
          rec.verificationResult.signature.certificate.runnerEnvironment = "self-hosted";
        },
      },
      {
        name: "Subject filename/path mismatch (relative path in subject name)",
        mutate: (rec) => {
          const mainSubject = rec.verificationResult.statement.subject.find(
            (s: AttestationSubject) => s.name === "main.js",
          );
          if (mainSubject) mainSubject.name = "release-assets/main.js";
        },
      },
      {
        name: "Incomplete subject count",
        mutate: (rec) => {
          rec.verificationResult.statement.subject = rec.verificationResult.statement.subject.filter(
            (s: AttestationSubject) => s.name === "main.js" || s.name === "styles.css",
          );
        },
      },
    ];

    for (const tc of negativeCases) {
      const broken = makeValidRecord();
      tc.mutate(broken);
      const res = await runPostVerify([broken]);
      assert.notEqual(res.status, 0, `Case '${tc.name}' must fail closed`);
    }

    const emptyRes = await runPostVerify([]);
    assert.notEqual(emptyRes.status, 0, "Empty array result must fail closed");

    const malformedJsonRes = await runPostVerify([], [], { rawStdout: "{not-valid-json" });
    assert.notEqual(malformedJsonRes.status, 0, "Malformed JSON output must fail closed");

    const cliFailBundle = await runPostVerify([makeValidRecord()], [makeValidRecord()], { failMode: "bundle" });
    assert.notEqual(cliFailBundle.status, 0, "Bundle CLI failure must fail closed");

    const cliFailOnline = await runPostVerify([makeValidRecord()], [makeValidRecord()], { failMode: "online" });
    assert.notEqual(cliFailOnline.status, 0, "Online CLI failure must fail closed");

    const insideBundlePath = join(releaseAssetsDir, "attestation.jsonl");
    await writeFile(insideBundlePath, "{}\n");
    const insideRes = await runPostVerify([makeValidRecord()], [makeValidRecord()], {
      env: { BUNDLE_PATH: insideBundlePath },
    });
    assert.notEqual(insideRes.status, 0, "Bundle inside release-assets must be rejected");
    await rm(insideBundlePath, { force: true });

    const postAssetCheck = spawnSync("node", ["--input-type=module", "-e", preScript], {
      cwd: workDir,
      env: { ...process.env, RELEASE_TAG: expectedTag },
      encoding: "utf8",
    });
    assert.equal(postAssetCheck.status, 0, postAssetCheck.stderr);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
