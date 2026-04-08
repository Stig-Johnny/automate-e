import { spawn } from 'child_process';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reportTokenUsage } from '../../conductor.js';
import { buildCliPrompt, buildSystemPrompt, buildSystemWithFacts } from '../shared.js';
import { buildCodexEnv, ensureCodexAuth } from './codex-auth.js';
import { AgentProviderError, toAgentProviderError } from '../provider-error.js';

export function createCodexCliAgent(character, memory) {
  console.log('[Automate-E] Using Codex CLI for LLM');
  const systemPrompt = buildSystemPrompt(character);

  return {
    async process(message, context, dashboard, onProgress) {
      try {
        await ensureCodexAuth(character, onProgress);
      } catch (error) {
        throw toAgentProviderError('codex-cli', error, {
          userMessage: error.userMessage || 'Codex login is required or unavailable right now.',
        });
      }

      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);
      const system = buildSystemWithFacts(systemPrompt, facts);
      const fullPrompt = buildCliPrompt(system, history, message, context);
      const cwd = character.workDir || undefined;
      const outputPath = join(tmpdir(), `automate-e-codex-${Date.now()}.txt`);

      const args = buildCodexCliArgs({
        prompt: fullPrompt,
        model: character.llm.model,
        cwd,
        outputPath,
        search: character.llm?.search === true,
        mcpServers: character.llm?.passMcpToCli ? character.mcpServers : null,
        dangerouslyBypassApprovalsAndSandbox: character.llm?.dangerouslyBypassApprovalsAndSandbox === true,
      });

      if (cwd) console.log(`[Automate-E] Codex CLI cwd: ${cwd}`);
      console.log(`[Automate-E] Codex CLI call: model=${character.llm.model}`);

      const reply = await new Promise((resolve, reject) => {
        const proc = spawn('codex', args, { env: buildCodexEnv(character), cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        const timeoutMs = character.llm?.timeoutMs ?? 300_000;
        let stdout = '';
        let stderr = '';
        const startTime = Date.now();

        const killTimer = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error('Codex CLI timeout'));
        }, timeoutMs);

        const heartbeatTimer = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const msg = `⏳ Still working... (${elapsed}s)`;
          console.log(`[Automate-E] ${msg}`);
          if (onProgress) onProgress(msg);
        }, 60_000);

        proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
        proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

        proc.on('close', code => {
          clearTimeout(killTimer);
          clearInterval(heartbeatTimer);

          const resultText = readCodexReply(outputPath);
          cleanupTempFile(outputPath);

          if (resultText) {
            console.log(`[Automate-E] Codex CLI complete: exit=${code ?? 0}`);
            reportTokenUsage({ model: character.llm.model, inputTokens: 0, outputTokens: 0, costUsd: 0 });
            if (dashboard) dashboard.addLog('info', 'Codex CLI: completed');
            resolve(resultText);
            return;
          }

          if (code !== 0) {
            const stderrSummary = stderr.trim().split('\n').slice(-3).join(' | ');
            reject(new AgentProviderError(
              'codex-cli',
              `Codex CLI exited ${code}${stderrSummary ? `: ${stderrSummary}` : ''}`,
              {
                userMessage: 'Codex is unavailable right now. Trying the next configured provider.',
              },
            ));
            return;
          }

          const stdoutSummary = stdout.trim().split('\n').slice(-3).join(' | ');
          if (stdoutSummary) {
            console.log(`[Automate-E] Codex CLI produced no final message: ${stdoutSummary}`);
          }
          resolve('Done.');
        });

        proc.on('error', err => {
          clearTimeout(killTimer);
          clearInterval(heartbeatTimer);
          cleanupTempFile(outputPath);
          reject(toAgentProviderError('codex-cli', err, {
            userMessage: 'Codex could not start. Trying the next configured provider.',
          }));
        });
      });

      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);
      return reply;
    },
  };
}

export function buildCodexCliArgs({
  prompt,
  model,
  cwd,
  outputPath,
  search = false,
  mcpServers = {},
  dangerouslyBypassApprovalsAndSandbox = false,
}) {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--color', 'never',
    '-o', outputPath,
  ];

  if (!dangerouslyBypassApprovalsAndSandbox) {
    args.push('--full-auto');
  }

  if (model) {
    args.push('--model', model);
  }
  if (cwd) {
    args.push('-C', cwd);
  }
  if (search) {
    args.push('--search');
  }

  if (dangerouslyBypassApprovalsAndSandbox) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }

  for (const configArg of buildCodexMcpConfigArgs(mcpServers)) {
    args.push('-c', configArg);
  }

  args.push(prompt);
  return args;
}

function buildCodexMcpConfigArgs(mcpServers) {
  const args = [];

  for (const [serverName, config] of Object.entries(mcpServers)) {
    if (!config?.command) continue;

    args.push(`mcp_servers.${serverName}.command=${toTomlString(config.command)}`);
    if (Array.isArray(config.args) && config.args.length > 0) {
      args.push(`mcp_servers.${serverName}.args=${toTomlArray(config.args)}`);
    }
    if (config.env && typeof config.env === 'object') {
      for (const [key, value] of Object.entries(config.env)) {
        args.push(`mcp_servers.${serverName}.env.${key}=${toTomlString(String(value))}`);
      }
    }
  }

  return args;
}

function toTomlArray(values) {
  return `[${values.map(value => toTomlString(String(value))).join(',')}]`;
}

function toTomlString(value) {
  return JSON.stringify(String(value));
}

function readCodexReply(outputPath) {
  if (!existsSync(outputPath)) return '';

  try {
    return readFileSync(outputPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function cleanupTempFile(path) {
  try {
    unlinkSync(path);
  } catch {}
}
