import { spawn } from 'child_process';

const DEVICE_AUTH_TIMEOUT_MS = 10 * 60 * 1000;
const DEVICE_AUTH_POLL_MS = 5000;

let activeDeviceAuth = null;

export async function ensureCodexAuth(character, onProgress) {
  const authMode = character.llm?.authMode || 'auto';
  const needsDeviceAuth = authMode === 'device-auth' || process.env.CODEX_DEVICE_AUTH === 'true';

  if (!needsDeviceAuth) return;
  if (await isCodexLoggedIn()) return;

  if (!activeDeviceAuth) {
    activeDeviceAuth = runDeviceAuthFlow(onProgress);
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

  const start = Date.now();
  while (Date.now() - start < DEVICE_AUTH_TIMEOUT_MS) {
    if (await isCodexLoggedIn()) {
      try {
        proc.kill('SIGTERM');
      } catch {}
      if (onProgress) {
        await onProgress('Codex login complete. Continuing...');
      }
      return;
    }

    if (proc.exitCode !== null && proc.exitCode !== 0) {
      throw new Error(`Codex device auth exited ${proc.exitCode}: ${combined.trim() || 'no output'}`);
    }

    await sleep(DEVICE_AUTH_POLL_MS);
  }

  try {
    proc.kill('SIGTERM');
  } catch {}
  throw new Error('Codex device auth timed out before login completed.');
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
