#!/usr/bin/env node
/**
 * Model Advisor MCP Server
 *
 * Provider-agnostic advisor tool. Any MCP-capable executor (Claude, Codex,
 * Gemini, etc.) can consult any CLI-accessible model for strategic guidance.
 *
 * Configuration via environment variables:
 *   ADVISOR_CLI      - CLI command (default: "claude")
 *   ADVISOR_MODEL    - model to use (default: "claude-opus-4-6")
 *   ADVISOR_NAME     - tool name exposed to executor (default: "consult_advisor")
 *   ADVISOR_LABEL    - human label in descriptions (default: "Opus")
 *   ADVISOR_MAX_TURNS - max turns for advisor (default: 2)
 *   ADVISOR_TIMEOUT_MS - timeout in ms (default: 120000)
 *
 * Examples:
 *   # Opus advisor (default)
 *   node advisor.js
 *
 *   # Codex advisor
 *   ADVISOR_CLI=codex ADVISOR_MODEL=gpt-5.4 ADVISOR_NAME=consult_codex ADVISOR_LABEL=Codex node advisor.js
 *
 *   # Gemini advisor
 *   ADVISOR_CLI=gemini ADVISOR_MODEL=gemini-2.5-pro ADVISOR_NAME=consult_gemini ADVISOR_LABEL=Gemini node advisor.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'child_process';

const CLI = process.env.ADVISOR_CLI || 'claude';
const MODEL = process.env.ADVISOR_MODEL || 'claude-opus-4-6';
const TOOL_NAME = process.env.ADVISOR_NAME || 'consult_advisor';
const LABEL = process.env.ADVISOR_LABEL || 'Opus';
const MAX_TURNS = parseInt(process.env.ADVISOR_MAX_TURNS || '2', 10);
const TIMEOUT_MS = parseInt(process.env.ADVISOR_TIMEOUT_MS || '120000', 10);

// CLI-specific argument builders
const CLI_ARGS = {
  claude: (prompt, systemPrompt) => [
    '-p', prompt,
    '--output-format', 'json',
    '--model', MODEL,
    '--system-prompt', systemPrompt,
    '--max-turns', String(MAX_TURNS),
    '--dangerously-skip-permissions',
  ],
  codex: (prompt, systemPrompt) => [
    '-q',
    '--model', MODEL,
    '--approval-mode', 'full-auto',
    `${systemPrompt}\n\n${prompt}`,
  ],
  // Generic fallback: assume -p style
  default: (prompt, systemPrompt) => [
    '-p', `${systemPrompt}\n\n${prompt}`,
    '--model', MODEL,
  ],
};

function buildArgs(prompt, systemPrompt) {
  const builder = CLI_ARGS[CLI] || CLI_ARGS.default;
  return builder(prompt, systemPrompt);
}

function parseOutput(stdout) {
  // Try JSON first (claude --output-format json)
  try {
    const output = JSON.parse(stdout);
    return output.result || output.text || output.content || JSON.stringify(output);
  } catch {
    // Plain text fallback (codex, gemini, etc.)
    return stdout.trim() || 'No advisor response';
  }
}

const server = new Server(
  { name: 'model-advisor', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler({ method: 'tools/list' }, async () => ({
  tools: [
    {
      name: TOOL_NAME,
      description:
        `Consult ${LABEL} (${MODEL}) for strategic guidance. ` +
        'Use when you need help with: planning an implementation approach, ' +
        'understanding a complex codebase, deciding between options, ' +
        'or reviewing your plan before executing. ' +
        'Include relevant context (file paths, code, errors) in your question. ' +
        'Cost: ~$0.02-0.05 per consultation. Use sparingly (max 2-3 per task).',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'Your question with context. Include: what you\'re trying to do, ' +
              'relevant file paths, code snippets, error messages. Be specific.',
          },
          context: {
            type: 'string',
            description:
              'Optional additional context: recent tool outputs, file contents, ' +
              'or conversation history relevant to your question.',
          },
        },
        required: ['question'],
      },
    },
  ],
}));

server.setRequestHandler({ method: 'tools/call' }, async (request) => {
  if (request.params.name !== TOOL_NAME) {
    return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
  }

  const { question, context } = request.params.arguments;
  if (!question) {
    return { content: [{ type: 'text', text: 'Error: question is required' }] };
  }

  const systemPrompt =
    'You are an expert advisor. Give concise, actionable guidance. ' +
    'Focus on: which files to change, what approach to take, potential pitfalls. ' +
    'Be specific with file paths and function names. Keep your response under 500 words.';

  const fullPrompt = context ? `${question}\n\n## Context\n${context}` : question;

  try {
    const result = await runAdvisor(fullPrompt, systemPrompt);
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Advisor error (${LABEL}): ${err.message}` }] };
  }
});

function runAdvisor(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(prompt, systemPrompt);
    const proc = spawn(CLI, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Advisor timeout (${TIMEOUT_MS}ms)`));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', () => {});

    proc.on('close', () => {
      clearTimeout(timer);
      resolve(parseOutput(stdout));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
