export function resolveAgentProvider(character) {
  const provider = character.llm?.provider;
  if (!provider) {
    throw new Error('No LLM provider configured. Set character.llm.provider in values (e.g., "claude-cli").');
  }
  return provider;
}
