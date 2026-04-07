/**
 * GitHub App token generator — mints short-lived installation tokens from a PEM.
 *
 * Environment variables:
 *   GITHUB_APP_ID          — GitHub App ID (e.g., 3301717)
 *   GITHUB_APP_PEM         — RSA private key (PEM string)
 *   GITHUB_INSTALLATION_ID — Installation ID for the target org
 *
 * Falls back to GITHUB_PERSONAL_ACCESS_TOKEN if App credentials aren't set.
 *
 * Usage:
 *   import { getGitHubToken } from './github-token.js';
 *   const token = await getGitHubToken();
 */

import { createSign } from 'crypto';

let cachedToken = null;
let cachedExpiry = 0;

function createJwt(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(pem, 'base64url');
  return `${header}.${payload}.${signature}`;
}

export async function getGitHubToken() {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PEM;
  const installationId = process.env.GITHUB_INSTALLATION_ID;

  // Fall back to static PAT if no App credentials
  if (!appId || !pem || !installationId) {
    return process.env.GITHUB_PERSONAL_ACCESS_TOKEN || null;
  }

  // Return cached token if still valid (refresh 5 min before expiry)
  if (cachedToken && Date.now() < cachedExpiry - 300_000) {
    return cachedToken;
  }

  const jwt = createJwt(appId, pem);

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );

  if (!res.ok) {
    console.error(`[GitHub Token] Failed to mint token: ${res.status} ${await res.text()}`);
    // Fall back to static PAT
    return process.env.GITHUB_PERSONAL_ACCESS_TOKEN || null;
  }

  const data = await res.json();
  cachedToken = data.token;
  cachedExpiry = new Date(data.expires_at).getTime();
  console.log(`[GitHub Token] Minted new token, expires ${data.expires_at}`);
  return cachedToken;
}

/**
 * Start a background refresh loop that keeps GITHUB_PERSONAL_ACCESS_TOKEN
 * updated with fresh App tokens. This way the MCP GitHub server and
 * Claude CLI both see a valid token in the environment.
 */
export function startTokenRefresh() {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PEM;
  const installationId = process.env.GITHUB_INSTALLATION_ID;

  if (!appId || !pem || !installationId) {
    console.log('[GitHub Token] No App credentials — using static GITHUB_PERSONAL_ACCESS_TOKEN');
    return;
  }

  const refresh = async () => {
    try {
      const token = await getGitHubToken();
      if (token) {
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
      }
    } catch (err) {
      console.error(`[GitHub Token] Refresh failed: ${err.message}`);
    }
  };

  // Refresh immediately, then every 50 minutes (tokens last 1 hour)
  refresh();
  setInterval(refresh, 50 * 60 * 1000);
  console.log(`[GitHub Token] Auto-refresh enabled for App ${appId}, installation ${installationId}`);
}
