import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentProvider } from './agent/provider-mode.js';
import { buildCodexCliArgs } from './agent/providers/codex-cli.js';
import { buildCodexEnv, parseDeviceAuthInfo } from './agent/providers/codex-auth.js';

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
    '--full-auto',
    '-o', '/tmp/result.txt',
    '--model', 'gpt-5.4',
    '-C', '/tmp/workdir',
    '--search',
    'Reply with ok',
  ]);
});

test('parseDeviceAuthInfo extracts url and code from codex device auth output', () => {
  const info = parseDeviceAuthInfo('Open https://auth.openai.com/device and enter code ABCD-EFGH to continue.');
  assert.equal(info.url, 'https://auth.openai.com/device');
  assert.equal(info.code, 'ABCD-EFGH');
});

test('buildCodexEnv removes OPENAI_API_KEY for device-auth mode', () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  const env = buildCodexEnv({ llm: { authMode: 'device-auth' } });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.OPENAI_API_KEY, 'sk-test');
  delete process.env.OPENAI_API_KEY;
});
