import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Connect to all MCP servers defined in character.mcpServers.
 * Returns an object with:
 *   tools: Claude-format tool definitions (with mcp_ prefix)
 *   callTool(name, args): route a tool call to the right MCP server
 *   close(): disconnect all servers
 */
export async function connectMcpServers(mcpServers = {}) {
  const clients = new Map(); // serverName → { client, toolNames }
  const toolMap = new Map(); // toolName → serverName
  const tools = [];

  for (const [serverName, config] of Object.entries(mcpServers)) {
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...(config.env || {}) },
      });

      const client = new Client({
        name: 'automate-e',
        version: '1.0.0',
      });

      await client.connect(transport);

      const { tools: serverTools } = await client.listTools();
      const toolNames = [];

      for (const tool of serverTools) {
        // Prefix with mcp_ and server name to avoid collisions
        const name = `mcp_${serverName}_${tool.name}`;
        toolNames.push(name);
        toolMap.set(name, serverName);
        tools.push({
          name,
          description: tool.description || '',
          input_schema: tool.inputSchema,
        });
      }

      clients.set(serverName, { client, toolNames, originalNames: serverTools.map(t => t.name) });
      console.log(`[Automate-E] MCP server "${serverName}" connected: ${serverTools.length} tools`);
    } catch (error) {
      console.error(`[Automate-E] MCP server "${serverName}" failed to connect: ${error.message}`);
    }
  }

  // Build status summary for dashboard
  const serverStatus = {};
  for (const [name, entry] of clients) {
    serverStatus[name] = { status: 'connected', toolCount: entry.toolNames.length };
  }

  return {
    tools,
    serverStatus,

    async callTool(prefixedName, args) {
      const serverName = toolMap.get(prefixedName);
      if (!serverName) {
        return { error: `Unknown MCP tool: ${prefixedName}` };
      }

      const entry = clients.get(serverName);
      if (!entry) {
        return { error: `MCP server "${serverName}" not connected` };
      }

      // Strip prefix to get original tool name
      const originalName = prefixedName.replace(`mcp_${serverName}_`, '');

      try {
        const result = await entry.client.callTool({
          name: originalName,
          arguments: args,
        });

        if (result.isError) {
          const errorText = result.content
            ?.filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n') || 'Tool call failed';
          return { error: errorText };
        }

        const text = result.content
          ?.filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || '';
        return { data: text };
      } catch (error) {
        return { error: error.message };
      }
    },

    isMcpTool(name) {
      return toolMap.has(name);
    },

    async close() {
      for (const [name, entry] of clients) {
        try {
          await entry.client.close();
          console.log(`[Automate-E] MCP server "${name}" disconnected`);
        } catch (error) {
          console.error(`[Automate-E] MCP server "${name}" close error: ${error.message}`);
        }
      }
    },
  };
}
