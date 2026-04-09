import { trackUsage, getUsageStats } from '../../usage.js';
import { reportTokenUsage } from '../../conductor.js';
import {
  buildSystemPrompt,
  buildSystemWithFacts,
  buildTools,
  executeTool,
  formatUserMessage,
} from '../shared.js';
import { AgentProviderError, toAgentProviderError } from '../provider-error.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export function createOpenAiApiAgent(character, memory, mcpClients) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const httpTools = buildTools(character);
  const mcpTools = mcpClients?.tools || [];
  const tools = [...httpTools, ...mcpTools];
  const systemPrompt = buildSystemPrompt(character);

  return {
    async process(message, context, dashboard) {
      if (!apiKey) {
        throw new AgentProviderError(
          'openai-api',
          'OPENAI_API_KEY is not configured.',
          {
            userMessage: 'OpenAI API fallback is not configured. Trying the next configured provider.',
          },
        );
      }

      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);
      const system = buildSystemWithFacts(systemPrompt, facts);
      const messages = [
        { role: 'system', content: system },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: formatUserMessage(message, context) },
      ];

      let response;
      for (let turn = 0; turn < 5; turn++) {
        console.log(`[Automate-E] OpenAI API call turn=${turn}, messages=${messages.length}`);
        response = await createChatCompletion(character, messages, tools);
        const usageInfo = trackUsage(character.llm.model, response.usage);
        reportTokenUsage({
          model: character.llm.model,
          inputTokens: usageInfo?.inputTokens ?? 0,
          outputTokens: usageInfo?.outputTokens ?? 0,
          costUsd: usageInfo?.costUsd ?? 0,
        });
        if (dashboard && usageInfo) {
          dashboard.addLog('info', `OpenAI API: ${usageInfo.inputTokens} in / ${usageInfo.outputTokens} out, $${usageInfo.costUsd.toFixed(4)}`);
          if (dashboard.updateUsage) dashboard.updateUsage(getUsageStats());
        }

        const choice = response.choices?.[0]?.message;
        const toolCalls = choice?.tool_calls || [];
        if (!toolCalls.length) break;

        messages.push({
          role: 'assistant',
          content: choice.content || '',
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function?.name;
          const toolInput = parseToolArguments(toolCall.function?.arguments);
          console.log(`[Automate-E] OpenAI tool call: ${toolName}`);
          const start = Date.now();
          const result = mcpClients?.isMcpTool(toolName)
            ? await mcpClients.callTool(toolName, toolInput)
            : await executeTool(toolName, toolInput, character);
          const latency = Date.now() - start;
          if (dashboard) dashboard.addToolCall(toolName, result.error ? 'error' : 'ok', latency);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }

      const reply = response?.choices?.[0]?.message?.content?.trim() || 'Done.';
      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);
      return reply;
    },
  };
}

async function createChatCompletion(character, messages, tools) {
  let response;
  try {
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: character.llm.model,
        temperature: character.llm.temperature,
        messages,
        tools: tools.length ? tools.map(toOpenAiTool) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
      }),
    });
  } catch (error) {
    throw toAgentProviderError('openai-api', error, {
      userMessage: 'OpenAI API could not be reached. Trying the next configured provider.',
    });
  }

  if (!response.ok) {
    const details = await response.text();
    throw new AgentProviderError(
      'openai-api',
      `OpenAI API request failed: ${response.status} ${details}`,
      {
        userMessage: 'OpenAI API is unavailable right now. Trying the next configured provider.',
      },
    );
  }

  return await response.json();
}

function toOpenAiTool(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function parseToolArguments(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
