// Token usage tracking — calculates cost from Claude API response.usage
// Stores in Postgres if available, in-memory otherwise.

const PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },  // per 1M tokens
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
  // Fallback for unknown models
  'default': { input: 1, output: 5 },
};

// In-memory accumulator
const stats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  calls: 0,
  byModel: {},
  startedAt: new Date().toISOString(),
};

export function trackUsage(model, usage) {
  if (!usage) return;

  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  const pricing = PRICING[model] || PRICING['default'];
  const costUsd = (inputTokens * pricing.input / 1_000_000) + (outputTokens * pricing.output / 1_000_000);

  stats.totalInputTokens += inputTokens;
  stats.totalOutputTokens += outputTokens;
  stats.totalCostUsd += costUsd;
  stats.calls++;

  if (!stats.byModel[model]) {
    stats.byModel[model] = { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
  }
  stats.byModel[model].inputTokens += inputTokens;
  stats.byModel[model].outputTokens += outputTokens;
  stats.byModel[model].costUsd += costUsd;
  stats.byModel[model].calls++;

  return { inputTokens, outputTokens, cacheCreation, cacheRead, costUsd };
}

export function getUsageStats() {
  return {
    ...stats,
    avgCostPerCall: stats.calls > 0 ? stats.totalCostUsd / stats.calls : 0,
  };
}

export function getUsageSummary() {
  const s = getUsageStats();
  return `${s.calls} calls, ${s.totalInputTokens.toLocaleString()} in / ${s.totalOutputTokens.toLocaleString()} out tokens, $${s.totalCostUsd.toFixed(4)}`;
}
