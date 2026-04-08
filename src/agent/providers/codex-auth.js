import { spawn } from 'child_process';

const DEVICE_AUTH_TIMEOUT_MS = 10 * 60 * 1000;
const DEVICE_AUTH_POLL_MS = 5000;
const DEVICE_AUTH_RETRY_MS = 5 * 60 * 1000;

let activeDeviceAuth = null;
let activeDeviceAuthProcess = null;
let nextDeviceAuthAllowedAt = 0;

export class CodexAuthError extends Error {
  constructor(message, userMessage, retryAfterMs = 0) {
    super(message);
    this.name = 'CodexAuthError';
    this.userMessage = userMessage;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function ensureCodexAuth(character, onProgress) {
  const authMode = character.llm?.authMode || 'auto';
  const needsDeviceAuth = authMode === 'device-auth' || process.env.CODEX_DEVICE_AUTH === 'true';

  if (!needsDeviceAuth) return;
  enforceDeviceAuthCooldown();
  if (await isCodexLoggedIn()) {
    clearDeviceAuthState();
    return;
  }

  if (!activeDeviceAuth) {
    activeDeviceAuth = runDeviceAuthFlow(onProgress).catch(error => {
      startDeviceAuthCooldown(error.retryAfterMs);
      throw error;
    });
    activeDeviceAuth.finally(() => {
      activeDeviceAuth = null;
    });
  } else if (onProgress) {
    await onProgress('Codex login is already in progress. Waiting for completion...');
  }

  await activeDeviceAuth;
}

export function buildCodexEnv(character) {
  const env = { ...process.env };
  const authMode = character.llm?.authMode || 'auto';
  if (authMode === 'device-auth' || process.env.CODEX_DEVICE_AUTH === 'true') {
    delete env.OPENAI_API_KEY;
  }
  return env;
}

export function getDeviceAuthCooldownRemainingMs(now = Date.now()) {
  return Math.max(0, nextDeviceAuthAllowedAt - now);
}

export function resetDeviceAuthCooldown() {
  nextDeviceAuthAllowedAt = 0;
}

export function startDeviceAuthCooldownForTest(retryAfterMs, now = Date.now()) {
  startDeviceAuthCooldown(retryAfterMs, now);
}

export function abortDeviceAuthFlow() {
  let aborted = false;
  if (activeDeviceAuthProcess) {
    try {
      activeDeviceAuthProcess.kill('SIGTERM');
      aborted = true;
    } catch {}
  }
  clearDeviceAuthState();
  return aborted;
}

export function parseDeviceAuthInfo(output) {
  const clean = stripAnsi(output);
  const urlMatch = clean.match(/https?:\/\/\S+/);
  const codeMatch = [
    clean.match(/one-time code[^\n]*\n\s*([A-Z0-9-]{4,})/i),
    clean.match(/(?:one-time code|verification code|enter(?: this)? code)[^A-Z0-9\n]*([A-Z0-9-]{4,})/i),
    clean.match(/(?:verification code|enter(?: this)? code)[^\n]*\n?\s*([A-Z0-9-]{4,})/i),
    clean.match(/\b([A-Z0-9]{4,}(?:-[A-Z0-9]{2,})+)\b/),
  ].find(Boolean);

  if (!urlMatch && !codeMatch && !clean.trim()) return null;

  return {
    url: urlMatch?.[0] || null,
    code: codeMatch?.[1] || null,
    raw: clean.trim(),
  };
}

async function runDeviceAuthFlow(onProgress) {
  const proc = spawn('codex', ['login', '--device-auth'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeDeviceAuthProcess = proc;

  let combined = '';
  let announced = false;

  const maybeAnnounce = async () => {
    if (announced || !onProgress) return;
    const info = parseDeviceAuthInfo(combined);
    if (!info) return;

    announced = true;
    const lines = ['Codex login required.'];
    if (info.url) lines.push(`Open: ${info.url}`);
    if (info.code) lines.push(`Code: ${info.code}`);
    if (!info.url && !info.code && info.raw) lines.push(info.raw);
    lines.push('Complete login in the browser. I will retry automatically.');
    await onProgress(lines.join('\n'));
  };

  proc.stdout.on('data', chunk => {
    combined += chunk.toString();
    void maybeAnnounce();
  });
  proc.stderr.on('data', chunk => {
    combined += chunk.toString();
    void maybeAnnounce();
  });
  proc.on('close', () => {
    if (activeDeviceAuthProcess === proc) {
      activeDeviceAuthProcess = null;
    }
  });
  proc.on('error', () => {
    if (activeDeviceAuthProcess === proc) {
      activeDeviceAuthProcess = null;
    }
  });

  const start = Date.now();
  while (Date.now() - start < DEVICE_AUTH_TIMEOUT_MS) {
    if (await isCodexLoggedIn()) {
      try {
        proc.kill('SIGTERM');
      } catch {}
      clearDeviceAuthState();
      if (onProgress) {
        await onProgress('Codex login complete. Continuing...');
      }
      return;
    }

    if (proc.exitCode !== null && proc.exitCode !== 0) {
      const details = combined.trim() || 'no output';
      if (/429|too many requests/i.test(details)) {
        throw new CodexAuthError(
          `Codex device auth exited ${proc.exitCode}: ${details}`,
          'Codex login is temporarily rate-limited. Wait a few minutes, then try again so I can send a fresh login link and code.',
          DEVICE_AUTH_RETRY_MS,
        );
      }
      throw new CodexAuthError(
        `Codex device auth exited ${proc.exitCode}: ${details}`,
        'Codex login failed before completion. Try again and I will send a fresh login link and code.',
        DEVICE_AUTH_RETRY_MS,
      );
    }

    await sleep(DEVICE_AUTH_POLL_MS);
  }

  try {
    proc.kill('SIGTERM');
  } catch {}
  clearDeviceAuthState();
  throw new CodexAuthError(
    'Codex device auth timed out before login completed.',
    'Codex login timed out before completion. Ask again and I will send a fresh login link and code.',
    DEVICE_AUTH_RETRY_MS,
  );
}

async function isCodexLoggedIn() {
  const result = await runCodex(['login', 'status']);
  return result.code === 0 && /logged in/i.test(result.stdout);
}

async function runCodex(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function enforceDeviceAuthCooldown(now = Date.now()) {
  const remainingMs = getDeviceAuthCooldownRemainingMs(now);
  if (!remainingMs) return;

  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  throw new CodexAuthError(
    `Codex device auth cooldown active for ${remainingMinutes} more minute(s).`,
    `Codex login is cooling down after a recent failed attempt. Wait about ${remainingMinutes} minute(s), then ask again for a fresh login link and code.`,
    remainingMs,
  );
}

function startDeviceAuthCooldown(retryAfterMs = DEVICE_AUTH_RETRY_MS, now = Date.now()) {
  nextDeviceAuthAllowedAt = Math.max(nextDeviceAuthAllowedAt, now + retryAfterMs);
}

function clearDeviceAuthState() {
  activeDeviceAuth = null;
  activeDeviceAuthProcess = null;
}
