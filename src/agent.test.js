import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAgentProvider } from './agent/provider-mode.js';
import { buildCodexCliArgs } from './agent/providers/codex-cli.js';
import { buildProviderChain, resolveCharacterForProvider } from './agent/provider-chain.js';
import { describeProviderState, getActiveProvider, setActiveProvider } from './agent/provider-state.js';
import {
  buildCodexEnv,
  ensureCodexAuth,
  getDeviceAuthCooldownRemainingMs,
  parseDeviceAuthInfo,
  resetDeviceAuthCooldown,
  startDeviceAuthCooldownForTest,
} from './agent/providers/codex-auth.js';

test('resolveAgentProvider defaults to anthropic', () => {
  delete process.env.CODEX_CLI_MODE;
  delete process.env.CLAUDE_CLI_MODE;
  delete process.env.ANTHROPIC_API_KEY;

  const provider = resolveAgentProvider({ llm: { provider: 'anthropic' } });
  assert.equal(provider, 'anthropic');
});

test('resolveAgentProvider uses claude-cli for OAuth subscription tokens', () => {
  delete process.env.CODEX_CLI_MODE;
  delete process.env.CLAUDE_CLI_MODE;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-oat-example';

  const provider = resolveAgentProvider({ llm: { provider: 'anthropic' } });
  assert.equal(provider, 'claude-cli');

  delete process.env.ANTHROPIC_API_KEY;
});

test('resolveAgentProvider respects explicit codex-cli provider', () => {
  delete process.env.CODEX_CLI_MODE;
  delete process.env.CLAUDE_CLI_MODE;
  delete process.env.ANTHROPIC_API_KEY;

  const provider = resolveAgentProvider({ llm: { provider: 'codex-cli' } });
  assert.equal(provider, 'codex-cli');
});

test('resolveAgentProvider respects explicit openai-api provider', () => {
  delete process.env.CODEX_CLI_MODE;
  delete process.env.CLAUDE_CLI_MODE;
  delete process.env.ANTHROPIC_API_KEY;

  const provider = resolveAgentProvider({ llm: { provider: 'openai-api' } });
  assert.equal(provider, 'openai-api');
});

test('buildProviderChain keeps primary provider first and appends fallbacks', () => {
  const chain = buildProviderChain({
    llm: {
      provider: 'codex-cli',
      fallbackProviders: ['claude-cli', 'openai-api', 'anthropic'],
    },
  });

  assert.deepEqual(chain, ['codex-cli', 'claude-cli', 'openai-api', 'anthropic']);
});

test('buildProviderChain deduplicates duplicate providers', () => {
  const chain = buildProviderChain({
    llm: {
      provider: 'codex-cli',
      fallbackProviders: ['codex-cli', 'claude-cli', 'claude-cli'],
    },
  });

  assert.deepEqual(chain, ['codex-cli', 'claude-cli']);
});

test('resolveCharacterForProvider applies provider-specific llm overrides', () => {
  const character = resolveCharacterForProvider({
    llm: {
      provider: 'codex-cli',
      model: 'gpt-5.4',
      timeoutMs: 1000,
      providers: {
        'claude-cli': {
          model: 'sonnet',
          timeoutMs: 2000,
        },
      },
    },
  }, 'claude-cli');

  assert.equal(character.llm.provider, 'claude-cli');
  assert.equal(character.llm.model, 'sonnet');
  assert.equal(character.llm.timeoutMs, 2000);
});

test('provider state defaults to the configured primary provider', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automate-e-provider-'));
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.HOME = tempDir;
  delete process.env.CODEX_HOME;

  try {
    const character = {
      llm: {
        provider: 'codex-cli',
        fallbackProviders: ['claude-cli', 'openai-api'],
      },
    };

    assert.equal(getActiveProvider(character), 'codex-cli');
    assert.match(describeProviderState(character), /Active provider: codex-cli/);
  } finally {
    process.env.HOME = previousHome;
    process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('provider state can be switched to another configured provider', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automate-e-provider-'));
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.HOME = tempDir;
  delete process.env.CODEX_HOME;

  try {
    const character = {
      llm: {
        provider: 'codex-cli',
        fallbackProviders: ['claude-cli', 'openai-api'],
      },
    };

    assert.equal(setActiveProvider(character, 'claude-cli'), 'claude-cli');
    assert.equal(getActiveProvider(character), 'claude-cli');
  } finally {
    process.env.HOME = previousHome;
    process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('provider state accepts human-friendly provider aliases', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automate-e-provider-'));
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.HOME = tempDir;
  delete process.env.CODEX_HOME;

  try {
    const character = {
      llm: {
        provider: 'codex-cli',
        fallbackProviders: ['claude-cli', 'openai-api'],
      },
    };

    assert.equal(setActiveProvider(character, 'claude'), 'claude-cli');
    assert.equal(getActiveProvider(character), 'claude-cli');
    assert.equal(setActiveProvider(character, 'openai'), 'openai-api');
    assert.equal(getActiveProvider(character), 'openai-api');
    assert.equal(setActiveProvider(character, 'codex'), 'codex-cli');
    assert.equal(getActiveProvider(character), 'codex-cli');
  } finally {
    process.env.HOME = previousHome;
    process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildCodexCliArgs includes cwd, output path, and prompt', () => {
  const args = buildCodexCliArgs({
    prompt: 'Reply with ok',
    model: 'gpt-5.4',
    cwd: '/tmp/workdir',
    outputPath: '/tmp/result.txt',
    search: true,
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--color', 'never',
    '-o', '/tmp/result.txt',
    '--full-auto',
    '--model', 'gpt-5.4',
    '-C', '/tmp/workdir',
    '--search',
    'Reply with ok',
  ]);
});

test('buildCodexCliArgs drops --full-auto when dangerous bypass is enabled', () => {
  const args = buildCodexCliArgs({
    prompt: 'Reply with ok',
    model: 'gpt-5.4',
    outputPath: '/tmp/result.txt',
    dangerouslyBypassApprovalsAndSandbox: true,
  });

  assert.equal(args.includes('--full-auto'), false);
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), true);
});

test('parseDeviceAuthInfo extracts url and code from codex device auth output', () => {
  const info = parseDeviceAuthInfo('Open https://auth.openai.com/device and enter code ABCD-EFGH to continue.');
  assert.equal(info.url, 'https://auth.openai.com/device');
  assert.equal(info.code, 'ABCD-EFGH');
});

test('parseDeviceAuthInfo strips ansi formatting from codex device auth output', () => {
  const output = [
    'Welcome to Codex [v\x1b[90m0.118.0\x1b[0m]',
    '1. Open this link in your browser and sign in to your account',
    '   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m',
    '2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m',
    '   \x1b[94m69PF-27ZKW\x1b[0m',
  ].join('\n');

  const info = parseDeviceAuthInfo(output);
  assert.equal(info.url, 'https://auth.openai.com/codex/device');
  assert.equal(info.code, '69PF-27ZKW');
});

test('parseDeviceAuthInfo ignores warning-only output without device auth details', () => {
  const info = parseDeviceAuthInfo('WARNING: failed to clean up stale arg0 temp dirs: Directory not empty (os error 39)');
  assert.equal(info.url, null);
  assert.equal(info.code, null);
});

test('buildCodexEnv removes OPENAI_API_KEY for device-auth mode', () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  const env = buildCodexEnv({ llm: { authMode: 'device-auth' } });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.OPENAI_API_KEY, 'sk-test');
  delete process.env.OPENAI_API_KEY;
});

test('ensureCodexAuth enforces existing device-auth cooldown', async () => {
  resetDeviceAuthCooldown();
  const now = Date.now();
  startDeviceAuthCooldownForTest(60_000, now);

  try {
    assert.ok(getDeviceAuthCooldownRemainingMs(now) > 0);
    await assert.rejects(ensureCodexAuth({ llm: { authMode: 'device-auth' } }), error => {
      assert.match(error.message, /cooldown active/i);
      assert.match(error.userMessage, /cooling down/i);
      return true;
    });
  } finally {
    resetDeviceAuthCooldown();
  }
});
