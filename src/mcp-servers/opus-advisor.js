#!/usr/bin/env node
/**
 * Opus Advisor MCP Server
 *
 * Exposes a "consult_opus" tool that spawns Claude Opus via CLI
 * for strategic guidance. Used by Sonnet/Haiku executor agents
 * to get Opus-level planning without switching their main model.
 *
 * Runs as a stdio MCP server — configure in character.mcpServers.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'child_process';

const ADVISOR_MODEL = process.env.ADVISOR_MODEL || 'claude-opus-4-6';
const ADVISOR_MAX_TURNS = parseInt(process.env.ADVISOR_MAX_TURNS || '2', 10);
const ADVISOR_TIMEOUT_MS = parseInt(process.env.ADVISOR_TIMEOUT_MS || '120000', 10);

const server = new Server(
  { name: 'opus-advisor', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler({ method: 'tools/list' }, async () => ({
  tools: [
    {
      name: 'consult_opus',
      description:
        'Consult Claude Opus for strategic guidance on complex decisions. ' +
        'Use this when you need help with: planning an implementation approach, ' +
        'understanding a complex codebase, deciding between architectural options, ' +
        'or reviewing your own plan before executing. ' +
        'Opus sees your question and returns a concise plan. ' +
        'Cost: ~$0.02-0.05 per consultation. Use sparingly (max 2-3 per task).',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'Your question or context for Opus. Be specific: include file paths, ' +
              'error messages, or code snippets. The more context you give, the better the advice.',
          },
        },
        required: ['question'],
      },
    },
  ],
}));

server.setRequestHandler({ method: 'tools/call' }, async (request) => {
  if (request.params.name !== 'consult_opus') {
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
  }

  const { question } = request.params.arguments;
  if (!question) {
    return { content: [{ type: 'text', text: 'Error: question is required' }] };
  }

  const systemPrompt =
    'You are an expert advisor. Give concise, actionable guidance. ' +
    'Focus on: which files to change, what approach to take, potential pitfalls. ' +
    'Be specific with file paths and function names. Keep your response under 500 words.';

  try {
    const result = await runClaude(question, systemPrompt);
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Advisor error: ${err.message}` }] };
  }
});

function runClaude(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--model', ADVISOR_MODEL,
      '--system-prompt', systemPrompt,
      '--max-turns', String(ADVISOR_MAX_TURNS),
      '--dangerously-skip-permissions',
    ];

    const proc = spawn('claude', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Advisor timeout (${ADVISOR_TIMEOUT_MS}ms)`));
    }, ADVISOR_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', () => {}); // ignore

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const output = JSON.parse(stdout);
        resolve(output.result || 'No advisor response');
      } catch {
        resolve(stdout.trim() || 'No advisor response');
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
