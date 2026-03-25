import { createHmac } from 'crypto';

/**
 * Verify GitHub webhook signature (HMAC-SHA256).
 */
function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return !secret; // No secret configured = skip verification
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  return signature === expected;
}

/**
 * Format a GitHub webhook event into a concise prompt for the agent.
 */
function formatGitHubEvent(event, body) {
  const repo = body.repository?.full_name || 'unknown';

  switch (event) {
    case 'pull_request': {
      const pr = body.pull_request;
      const action = body.action; // opened, closed, reopened, synchronize, review_requested, etc.
      return `GitHub webhook: PR ${action} — ${repo}#${pr.number} "${pr.title}" by ${pr.user.login}. State: ${pr.state}, draft: ${pr.draft}, mergeable: ${pr.mergeable_state || 'unknown'}. URL: ${pr.html_url}`;
    }
    case 'pull_request_review': {
      const pr = body.pull_request;
      const review = body.review;
      return `GitHub webhook: PR review ${review.state} — ${repo}#${pr.number} "${pr.title}" reviewed by ${review.user.login}. Review state: ${review.state}. URL: ${pr.html_url}`;
    }
    case 'check_suite':
    case 'check_run': {
      const check = body.check_run || body.check_suite;
      const prs = (check.pull_requests || []).map(p => `#${p.number}`).join(', ');
      return `GitHub webhook: CI ${check.status}/${check.conclusion || 'pending'} — ${repo} ${check.name || ''} for PRs ${prs || 'none'}. URL: ${check.html_url}`;
    }
    case 'issues': {
      const issue = body.issue;
      return `GitHub webhook: Issue ${body.action} — ${repo}#${issue.number} "${issue.title}" by ${issue.user.login}. Labels: ${issue.labels.map(l => l.name).join(', ') || 'none'}. Assignees: ${issue.assignees.map(a => a.login).join(', ') || 'none'}. URL: ${issue.html_url}`;
    }
    case 'issue_comment': {
      const issue = body.issue;
      const comment = body.comment;
      const isPR = !!issue.pull_request;
      return `GitHub webhook: Comment on ${isPR ? 'PR' : 'issue'} ${repo}#${issue.number} "${issue.title}" by ${comment.user.login}: "${comment.body.slice(0, 200)}". URL: ${comment.html_url}`;
    }
    case 'push': {
      const commits = body.commits || [];
      const branch = body.ref?.replace('refs/heads/', '') || 'unknown';
      return `GitHub webhook: Push to ${repo}/${branch} — ${commits.length} commit(s) by ${body.pusher?.name || 'unknown'}. Head: ${body.head_commit?.message?.slice(0, 100) || 'no message'}`;
    }
    default:
      return `GitHub webhook: ${event} event on ${repo}. Action: ${body.action || 'none'}`;
  }
}

/**
 * Create a webhook handler that processes incoming HTTP webhooks.
 * Returns a function: handleWebhook(req, res) -> Promise<void>
 *
 * In split mode, pass publishToRedis to queue events for workers.
 * In single mode, pass processDirectly to handle inline.
 */
export function createWebhookHandler(character, { publishToRedis, processDirectly, dashboard }) {
  const webhookConfig = character.webhooks || {};

  return async function handleWebhook(req, res, source) {
    const config = webhookConfig[source];
    if (!config) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Unknown webhook source: ${source}` }));
      return;
    }

    // Read body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString();

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Verify signature
    const secret = config.secret?.startsWith('env:')
      ? process.env[config.secret.slice(4)]
      : config.secret;
    const signature = req.headers['x-hub-signature-256'];

    if (secret && !verifySignature(rawBody, signature, secret)) {
      console.warn(`[Webhook] Invalid signature for ${source}`);
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    // Format event into prompt
    const event = req.headers['x-github-event'] || 'unknown';
    const prompt = formatGitHubEvent(event, body);
    const deliveryId = req.headers['x-github-delivery'] || `wh-${Date.now()}`;

    console.log(`[Webhook] ${source}/${event}: ${prompt.slice(0, 100)}`);
    if (dashboard) dashboard.addLog('info', `Webhook ${source}/${event}: ${body.repository?.full_name || ''}`);

    // Respond immediately (GitHub expects < 10s response)
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));

    // Process the event
    const payload = {
      messageContent: prompt,
      authorId: `webhook-${source}`,
      authorName: `Webhook (${source})`,
      channelId: 'webhook',
      threadId: `webhook-${source}`,
      attachments: [],
      isDM: false,
      isWebhook: true,
      webhookSource: source,
      webhookEvent: event,
      webhookDeliveryId: deliveryId,
    };

    if (publishToRedis) {
      await publishToRedis(payload);
    } else if (processDirectly) {
      await processDirectly(payload);
    }
  };
}
