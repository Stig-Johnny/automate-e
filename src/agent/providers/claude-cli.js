import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reportTokenUsage } from '../../conductor.js';
import { publishLog } from '../../agent-log.js';
import { buildCliPrompt, buildSystemPrompt, buildSystemWithFacts } from '../shared.js';
import { AgentProviderError, toAgentProviderError } from '../provider-error.js';

/**
 * Extract repo and issue number from CLI output.
 * Looks for patterns like "ASSIGNMENT: owner/repo#123" in the response text.
 */
function extractAssignment(text) {
  if (!text) return null;
  const match = text.match(/ASSIGNMENT:\s*(\S+)#(\d+)/);
  if (match) return { repo: match[1], issueNumber: parseInt(match[2], 10) };
  return null;
}

export function createClaudeCliAgent(character, memory) {
  console.log('[Automate-E] Using Claude Code CLI for LLM');
  const systemPrompt = buildSystemPrompt(character);

  return {
    async process(message, context, dashboard, onProgress) {
      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);
      const system = buildSystemWithFacts(systemPrompt, facts);
      const fullPrompt = buildCliPrompt(system, history, message, context);

      // Check for session resumption
      const sessionId = context?.sessionId;
      const args = sessionId
        ? [
            '--resume', sessionId,
            '-p', message, // continuation prompt (just the new instruction)
            '--output-format', 'json',
            '--max-turns', String(character.llm?.maxTurns ?? 10),
            '--dangerously-skip-permissions',
          ]
        : [
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
      publishLog('info', `Claude CLI started: model=${character.llm.model}, maxTurns=${character.llm?.maxTurns ?? 10}`, {
        repo: process.env.CONDUCTOR_REPO,
        issueNumber: process.env.CONDUCTOR_ISSUE_NUMBER ? parseInt(process.env.CONDUCTOR_ISSUE_NUMBER) : undefined,
      });

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
        proc.stderr.on('data', chunk => {
          const line = chunk.toString().trim();
          if (line) {
            publishLog('cli-stderr', line, {
              repo: process.env.CONDUCTOR_REPO,
              issueNumber: process.env.CONDUCTOR_ISSUE_NUMBER ? parseInt(process.env.CONDUCTOR_ISSUE_NUMBER) : undefined,
            });
          }
        });

        proc.on('close', code => {
          clearTimeout(killTimer);
          clearInterval(heartbeatTimer);
          cleanupTempFile(mcpConfigPath);

          let output;
          try { output = stdout ? JSON.parse(stdout) : null; } catch { output = null; }

          if (output) {
            const costUsd = output.total_cost_usd || 0;
            const resultText = output.result || '';
            const assignment = extractAssignment(resultText);
            const category = assignment ? 'work' : 'idle';
            const completeMsg = `Claude CLI complete: turns=${output.num_turns}, cost=$${costUsd.toFixed(4)}, subtype=${output.subtype}, category=${category}${assignment ? `, assignment=${assignment.repo}#${assignment.issueNumber}` : ''}`;
            console.log(`[Automate-E] ${completeMsg}`);
            publishLog('info', completeMsg, { repo: assignment?.repo, issueNumber: assignment?.issueNumber });
            reportTokenUsage({
              model: character.llm.model,
              inputTokens: 0,
              outputTokens: 0,
              costUsd,
              repo: assignment?.repo,
              issueNumber: assignment?.issueNumber,
              category,
            });
            if (dashboard) dashboard.addLog('info', `Claude CLI: ${output.num_turns} turn(s), $${costUsd.toFixed(4)}, ${category}`);
            // Return result with session_id for resumption
            const result = resultText || `CLI ${output.subtype || 'done'}`;
            resolve({
              text: result,
              sessionId: output.session_id || null,
              costUsd: costUsd,
              turns: output.num_turns || 0,
              model: character.llm.model,
              durationMs: output.duration_ms || 0,
              durationApiMs: output.duration_api_ms || 0,
              inputTokens: output.usage?.input_tokens || 0,
              outputTokens: output.usage?.output_tokens || 0,
              cacheReadTokens: output.usage?.cache_read_input_tokens || 0,
              cacheCreationTokens: output.usage?.cache_creation_input_tokens || 0,
              usage: output.usage || null,
              modelUsage: output.modelUsage || null,
              toString() { return result; },
            });
            return;
          }

          if (code !== 0) {
            reject(new AgentProviderError(
              'claude-cli',
              `Claude CLI exited ${code}, no JSON output`,
              {
                userMessage: 'Claude Code CLI is unavailable right now. Trying the next configured provider.',
              },
            ));
            return;
          }

          resolve('Done.');
        });

        proc.on('error', err => {
          clearTimeout(killTimer);
          clearInterval(heartbeatTimer);
          cleanupTempFile(mcpConfigPath);
          reject(toAgentProviderError('claude-cli', err, {
            userMessage: 'Claude Code CLI could not start. Trying the next configured provider.',
          }));
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
