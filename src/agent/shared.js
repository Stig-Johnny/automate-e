export function buildSystemPrompt(character) {
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

export function buildSystemWithFacts(systemPrompt, facts) {
  if (!facts.length) return systemPrompt;
  return `${systemPrompt}\n\n## Known facts about this user\n${facts.map(f => `- ${f}`).join('\n')}`;
}

export function buildHistoryLines(history) {
  return history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`);
}

export function buildCliPrompt(systemPrompt, history, message, context) {
  const historyLines = buildHistoryLines(history);
  const userMessage = formatUserMessage(message, context);

  const sections = [
    systemPrompt,
    historyLines.length > 0 ? `## Conversation history\n${historyLines.join('\n')}` : '',
    `User: ${userMessage}`,
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function buildTools(character) {
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

export async function executeTool(toolName, input, character) {
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

export function formatUserMessage(message, context) {
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
