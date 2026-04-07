import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { trackUsage, getUsageStats } from './usage.js';
import { reportTokenUsage } from './conductor.js';

// Use CLI mode when CLAUDE_CLI_MODE=true or when the API key is an OAuth
// subscription token (sk-ant-oat...) — those tokens require the Claude Code CLI.
function useCliMode() {
  if (process.env.CLAUDE_CLI_MODE === 'true') return true;
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  return apiKey.startsWith('sk-ant-oat');
}

export function createAgent(character, memory, mcpClients) {
  if (useCliMode()) {
    return createCliAgent(character, memory, mcpClients);
  }
  return createSdkAgent(character, memory, mcpClients);
}

// ---------------------------------------------------------------------------
// SDK agent — existing behaviour for sk-ant-api keys
// ---------------------------------------------------------------------------

function createSdkAgent(character, memory, mcpClients) {
  // Support both API keys (sk-ant-api...) and OAuth subscription tokens (sk-ant-oat...)
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const isOAuthToken = apiKey.startsWith('sk-ant-oat');
  const anthropic = isOAuthToken
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic();

  if (isOAuthToken) {
    console.log('[Automate-E] Using OAuth subscription token for LLM');
  }

  const httpTools = buildTools(character);
  const mcpTools = mcpClients?.tools || [];
  const tools = [...httpTools, ...mcpTools];
  const systemPrompt = buildSystemPrompt(character);

  return {
    async process(message, context, dashboard) {
      // Load conversation history
      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);

      // Build messages
      const messages = [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: formatUserMessage(message, context) },
      ];

      // Build system with facts
      let system = systemPrompt;
      if (facts.length > 0) {
        system += `\n\n## Known facts about this user\n${facts.map(f => `- ${f}`).join('\n')}`;
      }

      // Agent loop (max 5 tool calls)
      let response;
      for (let turn = 0; turn < 5; turn++) {
        console.log(`[Automate-E] LLM call turn=${turn}, messages=${messages.length}`);
        try {
          response = await anthropic.messages.create({
            model: character.llm.model,
            max_tokens: character.llm.maxTokens || 4096,
            temperature: character.llm.temperature,
            system,
            tools,
            messages,
          });
        } catch (llmError) {
          console.error(`[Automate-E] LLM error on turn ${turn}:`, llmError.status, llmError.message);
          throw llmError;
        }
        console.log(`[Automate-E] LLM response: stop_reason=${response.stop_reason}, content_blocks=${response.content.length}`);

        // Track token usage and cost
        const usageInfo = trackUsage(character.llm.model, response.usage);
        reportTokenUsage({
          model: character.llm.model,
          inputTokens: usageInfo?.inputTokens ?? 0,
          outputTokens: usageInfo?.outputTokens ?? 0,
          costUsd: usageInfo?.costUsd ?? 0,
        });
        if (dashboard && usageInfo) {
          dashboard.addLog('info', `LLM: ${usageInfo.inputTokens} in / ${usageInfo.outputTokens} out, $${usageInfo.costUsd.toFixed(4)}`);
          if (dashboard.updateUsage) dashboard.updateUsage(getUsageStats());
        }

        // If no tool use, we're done
        if (response.stop_reason !== 'tool_use') break;

        // Execute tool calls
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`[Automate-E] Tool call: ${block.name}`);
            const start = Date.now();
            const result = mcpClients?.isMcpTool(block.name)
              ? await mcpClients.callTool(block.name, block.input)
              : await executeTool(block.name, block.input, character);
            const latency = Date.now() - start;
            if (dashboard) dashboard.addToolCall(block.name, result.error ? 'error' : 'ok', latency);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        // Add assistant response + tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }

      // Extract text response
      const textBlocks = response.content.filter(b => b.type === 'text');
      const reply = textBlocks.map(b => b.text).join('\n') || 'Done.';

      // Save to memory
      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);

      return reply;
    },
  };
}

// ---------------------------------------------------------------------------
// CLI agent — uses `claude -p` for OAuth subscription tokens
// ---------------------------------------------------------------------------

function createCliAgent(character, memory, mcpClients) {
  console.log('[Automate-E] Using Claude Code CLI for LLM');
  const systemPrompt = buildSystemPrompt(character);

  return {
    async process(message, context, dashboard) {
      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);

      let system = systemPrompt;
      if (facts.length > 0) {
        system += `\n\n## Known facts about this user\n${facts.map(f => `- ${f}`).join('\n')}`;
      }

      // Embed conversation history inline — the CLI doesn't accept a messages[]
      // array so we prepend prior turns as labelled text.
      const historyLines = history.map(h =>
        `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
      );
      const userMessage = formatUserMessage(message, context);
      const fullPrompt = historyLines.length > 0
        ? `${historyLines.join('\n')}\nUser: ${userMessage}`
        : userMessage;

      // Args array — avoids any shell-injection risk from prompt content
      const args = [
        '-p', fullPrompt,
        '--output-format', 'json',
        '--model', character.llm.model,
        '--system-prompt', system,
        '--max-turns', String(character.llm?.maxTurns ?? 10),
        '--dangerously-skip-permissions',
      ];

      // MCP servers are already connected at the Automate-E process level.
      // Don't pass --mcp-config to the CLI — it would start duplicate MCP
      // server processes (e.g., npx downloads) that may fail or conflict.
      // The CLI can use its built-in fetch tool for HTTP APIs instead.
      let mcpConfigPath = null;

      let reply = 'Done.';
      try {
        console.log(`[Automate-E] CLI call: model=${character.llm.model}`);
        const result = spawnSync('claude', args, {
          encoding: 'utf8',
          env: process.env,
          maxBuffer: 10 * 1024 * 1024,
          timeout: character.llm?.timeoutMs ?? 300_000,
        });

        if (result.error) {
          throw result.error;
        }

        // CLI may exit with status 1 but still have valid JSON output
        // (e.g., error_max_turns, permission_denied). Parse stdout first.
        let output;
        try {
          output = result.stdout ? JSON.parse(result.stdout) : null;
        } catch {
          output = null;
        }

        if (result.status !== 0 && !output) {
          const errMsg = (result.stderr || '').trim() || 'unknown error';
          throw new Error(`Claude CLI exited with status ${result.status}: ${errMsg}`);
        }

        if (result.status !== 0 && output) {
          // CLI returned an error result — still usable
          console.log(`[Automate-E] CLI error: ${output.subtype || 'unknown'}, turns=${output.num_turns}`);
          reply = output.result || `CLI error: ${output.subtype}`;
        } else {
          reply = output?.result || 'Done.';
        }
        const costUsd = output.cost_usd || 0;
        console.log(`[Automate-E] CLI response: turns=${output.num_turns}, cost=$${costUsd.toFixed(4)}`);

        // CLI JSON output doesn't expose per-token counts; report cost only
        reportTokenUsage({
          model: character.llm.model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd,
        });
        if (dashboard) {
          dashboard.addLog('info', `CLI: ${output.num_turns} turn(s), $${costUsd.toFixed(4)}`);
        }
      } finally {
        if (mcpConfigPath) {
          try { unlinkSync(mcpConfigPath); } catch {}
        }
      }

      // Save to memory
      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);

      return reply;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers (used by both SDK and CLI agents)
// ---------------------------------------------------------------------------

function buildSystemPrompt(character) {
  return `${character.personality}

## Background knowledge
${character.lore.map(l => `- ${l}`).join('\n')}

## Style
- Language: ${character.style.language}
- Tone: ${character.style.tone}
- Format: ${character.style.format}

${(character.tools.length > 0 || Object.keys(character.mcpServers || {}).length > 0) ? `## Available tools
You have tools to interact with external systems. Use them when the user asks about something your tools can help with.

## Rules
- Use tools to look up data rather than guessing.
- If you can't determine something, ask the user.
- Always confirm what you did after completing an action.` : ''}
- Always respond in ${character.style.language}.`;
}

function buildTools(character) {
  const tools = [];
  for (const toolConfig of character.tools) {
    for (const endpoint of toolConfig.endpoints) {
      const name = `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/\//g, '_').replace(/^_/, '')}`;
      tools.push({
        name,
        description: endpoint.description,
        input_schema: {
          type: 'object',
          properties: endpoint.method === 'GET'
            ? {
                query: { type: 'string', description: 'Query parameters as key=value&key=value' },
              }
            : {
                body: { type: 'string', description: 'JSON body for the request' },
                query: { type: 'string', description: 'Query parameters as key=value&key=value' },
              },
        },
      });
    }
  }
  return tools;
}

async function executeTool(toolName, input, character) {
  // Map tool name back to endpoint
  for (const toolConfig of character.tools) {
    for (const endpoint of toolConfig.endpoints) {
      const name = `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/\//g, '_').replace(/^_/, '')}`;
      if (name === toolName) {
        return await callApi(toolConfig.url, endpoint.method, endpoint.path, input);
      }
    }
  }
  return { error: `Unknown tool: ${toolName}` };
}

async function callApi(baseUrl, method, path, input) {
  let url = `${baseUrl}${path}`;
  if (input.query) {
    url += (url.includes('?') ? '&' : '?') + input.query;
  }

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (input.body && (method === 'POST' || method === 'PUT')) {
    options.body = input.body;
  }

  try {
    const response = await fetch(url, options);
    const data = await response.text();
    if (!response.ok) {
      return { status: response.status, error: data };
    }
    return { status: response.status, data };
  } catch (error) {
    return { status: 500, error: error.message };
  }
}

function formatUserMessage(message, context) {
  let content = message;
  if (context.attachments.length > 0) {
    const attachmentInfo = context.attachments
      .map(a => {
        const sizeKb = Math.round(a.size / 1024);
        const urlPart = a.url ? `, URL: ${a.url}` : '';
        return `[Attachment: ${a.name} (${a.contentType}, ${sizeKb}KB${urlPart})]`;
      })
      .join('\n');
    content = `${message}\n\n${attachmentInfo}`;
  }
  return content;
}
