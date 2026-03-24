import Anthropic from '@anthropic-ai/sdk';
import { trackUsage } from './usage.js';

export function createAgent(character, memory) {
  const anthropic = new Anthropic();

  const tools = buildTools(character);
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
        response = await anthropic.messages.create({
          model: character.llm.model,
          max_tokens: 1024,
          temperature: character.llm.temperature,
          system,
          tools,
          messages,
        });

        // Track token usage and cost
        const usageInfo = trackUsage(character.llm.model, response.usage);
        if (dashboard && usageInfo) {
          dashboard.addLog('info', `LLM: ${usageInfo.inputTokens} in / ${usageInfo.outputTokens} out, $${usageInfo.costUsd.toFixed(4)}`);
        }

        // If no tool use, we're done
        if (response.stop_reason !== 'tool_use') break;

        // Execute tool calls
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            console.log(`[Automate-E] Tool call: ${block.name}`);
            const start = Date.now();
            const result = await executeTool(block.name, block.input, character);
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
      const reply = textBlocks.map(b => b.text).join('\n') || 'Ferdig.';

      // Save to memory
      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);

      return reply;
    },
  };
}

function buildSystemPrompt(character) {
  return `${character.personality}

## Background knowledge
${character.lore.map(l => `- ${l}`).join('\n')}

## Style
- Language: ${character.style.language}
- Tone: ${character.style.tone}
- Format: ${character.style.format}

## Available tools
You have tools to interact with the accounting systems. Use them when the user asks about transactions, invoices, expenses, balance, or sends a receipt/document.

## Rules
- NEVER guess amounts, dates, or account numbers. Use tools to look up data.
- When processing a receipt or invoice, extract: merchant, amount, date, and VAT rate.
- If you can't determine something from the document, ask the user.
- Always confirm what you did after completing an action.
- Respond in the same language the user uses (default Norwegian).`;
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
