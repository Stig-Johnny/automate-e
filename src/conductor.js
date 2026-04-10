// Conductor-E integration — reports TOKEN_USAGE events after each LLM turn.
//
// Non-blocking: failures are logged but never propagate to the agent loop.
//
// Required env vars (both must be set for reporting to activate):
//   CONDUCTOR_BASE_URL  e.g. http://conductor-e-api.conductor-e.svc.cluster.local:8080
//   AGENT_ID            e.g. dev-e-1
//
// Optional env vars (for rig agents that know their target repo/issue):
//   CONDUCTOR_REPO          e.g. Stig-Johnny/automate-e
//   CONDUCTOR_ISSUE_NUMBER  e.g. 74

/**
 * Report token usage to conductor-e. Fire-and-forget — never throws.
 *
 * @param {object} opts
 * @param {string} opts.model        - Claude model ID
 * @param {number} opts.inputTokens
 * @param {number} opts.outputTokens
 * @param {number} opts.costUsd
 * @param {string} [opts.repo]       - Override CONDUCTOR_REPO env var
 * @param {number} [opts.issueNumber] - Override CONDUCTOR_ISSUE_NUMBER env var
 * @param {string} [opts.category]    - "work" | "idle" | "chat" — cost category
 */
export function reportTokenUsage({ model, inputTokens, outputTokens, costUsd, repo, issueNumber, category } = {}) {
  const conductorBaseUrl = process.env.CONDUCTOR_BASE_URL;
  const agentId = process.env.AGENT_ID;

  if (!conductorBaseUrl || !agentId) return;

  const resolvedRepo = repo || process.env.CONDUCTOR_REPO || '';
  const resolvedIssue = issueNumber ?? parseInt(process.env.CONDUCTOR_ISSUE_NUMBER || '0', 10);

  const body = JSON.stringify({
    type: 'TOKEN_USAGE',
    agentId,
    repo: resolvedRepo,
    issueNumber: resolvedIssue,
    model: model || '',
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    costUsd: costUsd || 0,
    category: category || '',
  });

  fetch(`${conductorBaseUrl}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(err => {
    console.warn('[Automate-E] Failed to report token usage to conductor-e:', err.message);
  });
}

export async function fetchAgentOverview() {
  const conductorBaseUrl = process.env.CONDUCTOR_BASE_URL;
  if (!conductorBaseUrl) {
    throw new Error('CONDUCTOR_BASE_URL is not configured.');
  }

  const response = await fetch(`${conductorBaseUrl}/api/agents`);
  if (!response.ok) {
    throw new Error(`Conductor-E returned ${response.status} for /api/agents.`);
  }

  return response.json();
}
