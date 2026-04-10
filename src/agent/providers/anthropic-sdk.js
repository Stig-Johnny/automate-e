import Anthropic from '@anthropic-ai/sdk';
import { trackUsage, getUsageStats } from '../../usage.js';
import { reportTokenUsage } from '../../conductor.js';
import {
  buildSystemPrompt,
  buildSystemWithFacts,
  buildTools,
  executeTool,
  formatUserMessage,
} from '../shared.js';

export function createAnthropicSdkAgent(character, memory, mcpClients) {
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
      const history = await memory.getConversation(context.threadId, 20);
      const facts = await memory.getFacts(context.userId);

      const messages = [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: formatUserMessage(message, context) },
      ];

      const system = buildSystemWithFacts(systemPrompt, facts);

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

        if (response.stop_reason !== 'tool_use') break;

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

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }

      const textBlocks = response.content.filter(b => b.type === 'text');
      const reply = textBlocks.map(b => b.text).join('\n') || 'Done.';

      await memory.saveMessage(context.threadId, 'user', message, context.userId);
      await memory.saveMessage(context.threadId, 'assistant', reply);

      return reply;
    },
  };
}
