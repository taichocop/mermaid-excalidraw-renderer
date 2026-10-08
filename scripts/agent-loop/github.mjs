export class GitHub {
  constructor(repository, token) {
    this.repository = repository;
    this.token = token;
    this.base = process.env.GITHUB_API_URL || 'https://api.github.com';
  }
  async request(path, method = 'GET', body) {
    const response = await fetch(`${this.base}${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${path}: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  repo(path, method, body) { return this.request(`/repos/${this.repository}${path}`, method, body); }
  async pages(path, key) {
    const items = [];
    // Finite pagination of existing records, never polling for a new review.
    for (let page = 1; page <= 100; page++) {
      const value = await this.repo(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = key ? value[key] : value;
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    throw new Error('Pagination exceeded bound; refusing incomplete review/CI data');
  }
  async threads(number) {
    const [owner, name] = this.repository.split('/');
    const result = [];
    let cursor = null;
    for (let page = 0; page < 100; page++) {
      const data = await this.request('/graphql', 'POST', { query: `query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
        repository(owner:$owner, name:$name) { pullRequest(number:$number) {
          reviewThreads(first:100, after:$cursor) { pageInfo { hasNextPage endCursor }
            nodes { id isResolved isOutdated path line comments(first:100) {
              pageInfo { hasNextPage } nodes { databaseId body author { login }
                pullRequestReview { databaseId } originalCommit { oid } } } }
          }
        } }
      }`, variables: { owner, name, number, cursor } });
      if (data.errors) throw new Error('Could not read complete review threads');
      const threads = data.data.repository.pullRequest.reviewThreads;
      if (threads.nodes.some(thread => thread.comments.pageInfo.hasNextPage)) {
        throw new Error('Thread has over 100 comments; refusing partial review data');
      }
      result.push(...threads.nodes);
      if (!threads.pageInfo.hasNextPage) return result;
      cursor = threads.pageInfo.endCursor;
    }
    throw new Error('Too many review threads');
  }
  async resolveThread(id) {
    const result = await this.request('/graphql', 'POST', {
      query: 'mutation($id:ID!) { resolveReviewThread(input:{threadId:$id}) { thread { id isResolved } } }',
      variables: { id },
    });
    if (result.errors || !result.data?.resolveReviewThread.thread.isResolved) {
      throw new Error('Could not resolve validated finding');
    }
  }
  async loadState(number) {
    const branch = `codex/agent-loop-state/pr-${number}`;
    try {
      const file = await this.repo(`/contents/.agent-loop/state.json?ref=${encodeURIComponent(branch)}`);
      return { branch, sha: file.sha, value: JSON.parse(Buffer.from(file.content, 'base64').toString()) };
    } catch (error) {
      if (error.status !== 404) throw error;
      return { branch, sha: null, value: null };
    }
  }
  async saveState(record, value, initialSha) {
    if (!record.sha) {
      try { await this.repo('/git/refs', 'POST', { ref: `refs/heads/${record.branch}`, sha: initialSha }); }
      catch (error) { if (error.status !== 422) throw error; }
    }
    const result = await this.repo('/contents/.agent-loop/state.json', 'PUT', {
      message: `Agent loop: ${value.state}`, branch: record.branch,
      content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64'),
      ...(record.sha ? { sha: record.sha } : {}),
    });
    record.sha = result.content.sha;
    record.value = value;
  }
  async removeReady(number) {
    try { await this.repo(`/issues/${number}/labels/agent-ready`, 'DELETE'); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  async addReady(number) {
    try { await this.repo('/labels', 'POST', { name: 'agent-ready', color: '2da44e', description: 'Validated; ready for human review' }); }
    catch (error) { if (error.status !== 422) throw error; }
    await this.repo(`/issues/${number}/labels`, 'POST', { labels: ['agent-ready'] });
  }
  async addComment(number, body) {
    return this.repo(`/issues/${number}/comments`, 'POST', { body });
  }
  async ciData(pr) {
    const workflow = await this.repo('/actions/workflows/ci.yml');
    const [runs, checks, statuses, branch] = await Promise.all([
      this.pages(`/actions/runs?head_sha=${pr.head.sha}`, 'workflow_runs'),
      this.pages(`/commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs'),
      this.pages(`/commits/${pr.head.sha}/status`, 'statuses'),
      this.repo(`/branches/${encodeURIComponent(pr.base.ref)}`),
    ]);
    let required = [];
    if (branch.protected) {
      const [owner, name] = this.repository.split('/');
      const protection = await this.request('/graphql', 'POST', {
        query: `query($owner:String!, $name:String!, $ref:String!) {
          repository(owner:$owner, name:$name) { ref(qualifiedName:$ref) {
            branchProtectionRule { requiredStatusChecks { context app { databaseId } } }
          } }
        }`, variables: { owner, name, ref: `refs/heads/${pr.base.ref}` },
      });
      if (protection.errors || !protection.data?.repository?.ref) throw new Error('Cannot verify required CI checks');
      required = (protection.data.repository.ref.branchProtectionRule?.requiredStatusChecks ?? [])
        .map(check => ({ context: check.context, app_id: check.app?.databaseId ?? null }));
      const rules = await this.repo(`/rules/branches/${encodeURIComponent(pr.base.ref)}`);
      required.push(...rules.filter(rule => rule.type === 'required_status_checks')
        .flatMap(rule => rule.parameters.required_status_checks)
        .map(check => ({ context: check.context, app_id: check.integration_id ?? null })));
    }
    const ignoredRunIds = runs.filter(run => ['.github/workflows/agent-loop.yml',
      '.github/workflows/agent-loop-iteration.yml', '.github/workflows/codex-review-observer.yml']
      .includes(run.path?.split('@')[0])).map(run => run.id);
    return { workflowId: workflow.id, runs, checks, statuses, required, ignoredRunIds };
  }

}
