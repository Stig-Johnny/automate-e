export class AgentProviderError extends Error {
  constructor(provider, message, options = {}) {
    super(message);
    this.name = 'AgentProviderError';
    this.provider = provider;
    this.userMessage = options.userMessage;
    this.fallbackEligible = options.fallbackEligible ?? true;
    this.cause = options.cause;
  }
}

export function toAgentProviderError(provider, error, options = {}) {
  if (error instanceof AgentProviderError) {
    return error;
  }

  return new AgentProviderError(provider, error?.message || String(error), {
    userMessage: error?.userMessage || options.userMessage,
    fallbackEligible: options.fallbackEligible,
    cause: error,
  });
}
