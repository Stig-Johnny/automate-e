import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reportTokenUsage } from '../../conductor.js';
import { buildCliPrompt, buildSystemPrompt, buildSystemWithFacts } from '../shared.js';

export function createClaudeCliAgent(character, memory) {
  console.log('[Automate-E] Using Claude Code CLI for LLM');
  const systemPrompt = buildSystemPrompt(character);

  return {
    async process(message, context, dashboard, onProgress) {
      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);
      const system = buildSystemWithFacts(systemPrompt, facts);
      const fullPrompt = buildCliPrompt(system, history, message, context);

      const args = [
        '-p', fullPrompt,
        '--output-format', 'json',
        '--model', character.llm.model,
        '--system-prompt', system,
        '--max-turns', String(character.llm?.maxTurns ?? 10),
        '--dangerously-skip-permissions',
      ];

      let mcpConfigPath = null;
      if (character.llm?.passMcpToCli && character.mcpServers && Object.keys(character.mcpServers).length > 0) {
        mcpConfigPath = join(tmpdir(), `automate-e-mcp-${Date.now()}.json`);
        writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: character.mcpServers }));
        args.push('--mcp-config', mcpConfigPath);
      }

      const cwd = character.workDir || undefined;
      if (cwd) console.log(`[Automate-E] Claude CLI cwd: ${cwd}`);
      console.log(`[Automate-E] Claude CLI call: model=${character.llm.model}`);

      const reply = await new Promise((resolve, reject) => {
        const proc = spawn('claude', args, { env: process.env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        const timeoutMs = character.llm?.timeoutMs ?? 300_000;
        let stdout = '';
        const startTime = Date.now();

        const killTimer = setTimeout(() => {
          proc.kill('SIGTERM');
          reject(new Error('CLI timeout'));
        }, timeoutMs);

        const heartbeatTimer = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const msg = `⏳ Still working... (${elapsed}s)`;
          console.log(`[Automate-E] ${msg}`);
          if (onProgress) onProgress(msg);
        }, 60_000);

        proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
        proc.stderr.on('data', () => {});

        proc.on('close', code => {
          clearTimeout(killTimer);
          clearInterval(heartbeatTimer);
          cleanupTempFile(mcpConfigPath);

          let output;
          try { output = stdout ? JSON.parse(stdout) : null; } catch { output = null; }

          if (output) {
            const costUsd = output.total_cost_usd || 0;
            console.log(`[Automate-E] Claude CLI complete: turns=${output.num_turns}, cost=$${costUsd.toFixed(4)}, subtype=${output.subtype}`);
            reportTokenUsage({ model: character.llm.model, inputTokens: 0, outputTokens: 0, costUsd });
            if (dashboard) dashboard.addLog('info', `Claude CLI: ${output.num_turns} turn(s), $${costUsd.toFixed(4)}`);
            resolve(output.result || `CLI ${output.subtype || 'done'}`);
            return;
          }

          if (code !== 0) {
            console.log(`[Automate-E] Claude CLI exited ${code}, no JSON output`);
            resolve(`CLI error (exit ${code})`);
            return;
          }

          resolve('Done.');
        });

        proc.on('error', err => {
          clearTimeout(killTimer);
          clearInterval(heartbeatTimer);
          cleanupTempFile(mcpConfigPath);
          reject(err);
        });
      });

      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);
      return reply;
    },
  };
}

function cleanupTempFile(path) {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {}
}
