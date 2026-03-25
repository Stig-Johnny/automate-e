/**
 * Test mode — web-based chat interface for testing agents without Discord.
 *
 * Run: CHARACTER_FILE=./character.json ANTHROPIC_API_KEY=... node src/test.js
 * Open: http://localhost:3000
 *
 * The dashboard is replaced with a simple chat UI.
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { loadCharacter } from './character.js';
import { createAgent } from './agent.js';
import { createMemory } from './memory.js';
import { connectMcpServers } from './mcp.js';
import { getUsageStats, getUsageSummary } from './usage.js';

const character = loadCharacter();

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[Automate-E] WARNING: ANTHROPIC_API_KEY not set — API calls will fail');
}

const memory = await createMemory();
const mcpClients = await connectMcpServers(character.mcpServers);
const agent = createAgent(character, memory, mcpClients);

const toolCalls = [];
const logs = [];
const startedAt = new Date();

const dashboard = {
  addLog(level, message) {
    const entry = { level, message, timestamp: new Date().toISOString() };
    logs.push(entry);
    if (logs.length > 200) logs.shift();
    broadcast({ type: 'log', data: entry });
  },
  addToolCall(name, status, latencyMs) {
    const entry = { name, status, latencyMs, timestamp: new Date().toISOString() };
    toolCalls.push(entry);
    if (toolCalls.length > 100) toolCalls.shift();
    broadcast({ type: 'toolCall', data: entry });
  },
  updateSession() {},
};

const wsClients = new Set();
function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${character.name} — Automate-E Test</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; display: flex; flex-direction: column; height: 100vh; }
  .header { background: #161b22; padding: 12px 20px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 10px; }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header .name { color: #58a6ff; }
  .header .badge { font-size: 11px; color: #7ee787; background: #1a2e1a; padding: 2px 8px; border-radius: 10px; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .chat { flex: 1; display: flex; flex-direction: column; }
  .messages { flex: 1; overflow-y: auto; padding: 16px; }
  .msg { margin-bottom: 12px; max-width: 80%; }
  .msg.user { margin-left: auto; }
  .msg .bubble { padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  .msg.user .bubble { background: #1f6feb; color: #fff; border-bottom-right-radius: 4px; }
  .msg.assistant .bubble { background: #21262d; border: 1px solid #30363d; border-bottom-left-radius: 4px; }
  .msg .meta { font-size: 11px; color: #484f58; margin-top: 4px; }
  .msg.user .meta { text-align: right; }
  .input-area { padding: 12px 16px; border-top: 1px solid #30363d; background: #161b22; display: flex; gap: 8px; }
  .input-area input { flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; color: #e1e4e8; font-size: 14px; outline: none; }
  .input-area input:focus { border-color: #58a6ff; }
  .input-area button { background: #1f6feb; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; cursor: pointer; }
  .input-area button:hover { background: #388bfd; }
  .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
  .sidebar { width: 320px; border-left: 1px solid #30363d; overflow-y: auto; padding: 12px; font-size: 12px; }
  .sidebar h3 { color: #8b949e; margin-bottom: 8px; font-size: 12px; text-transform: uppercase; }
  .sidebar .section { margin-bottom: 16px; }
  .tool-entry { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #21262d; }
  .tool-name { color: #d2a8ff; font-family: monospace; }
  .tool-ok { color: #7ee787; }
  .tool-fail { color: #f85149; }
  .log-entry { padding: 2px 0; font-family: 'SF Mono', Consolas, monospace; font-size: 11px; color: #8b949e; }
  .log-entry .time { color: #484f58; }
  .stat { display: flex; justify-content: space-between; padding: 4px 0; }
  .stat-label { color: #8b949e; }
  .stat-value { font-weight: 600; }
  .typing { color: #484f58; font-style: italic; padding: 8px 0; }
</style>
</head>
<body>
<div class="header">
  <h1>Automate-E</h1>
  <span class="name">${character.name}</span>
  <span class="badge">test mode</span>
</div>
<div class="main">
  <div class="chat">
    <div class="messages" id="messages"></div>
    <div class="input-area">
      <input type="text" id="input" placeholder="Send a message..." autofocus>
      <button id="send">Send</button>
    </div>
  </div>
  <div class="sidebar">
    <div class="section">
      <h3>Agent Info</h3>
      <div class="stat"><span class="stat-label">Name</span><span class="stat-value">${character.name}</span></div>
      <div class="stat"><span class="stat-label">Model</span><span class="stat-value">${character.llm.model.replace('claude-', '').replace('-20251001', '')}</span></div>
      <div class="stat"><span class="stat-label">Tools</span><span class="stat-value">${character.tools.reduce((n, t) => n + t.endpoints.length, 0)}</span></div>
    </div>
    <div class="section">
      <h3>Usage</h3>
      <div id="usage">No calls yet</div>
    </div>
    <div class="section">
      <h3>Recent Tool Calls</h3>
      <div id="tools">None</div>
    </div>
    <div class="section">
      <h3>Logs</h3>
      <div id="logs"></div>
    </div>
  </div>
</div>
<script>
const ws = new WebSocket(\`\${location.protocol === 'https:' ? 'wss:' : 'ws:'}//$\{location.host}\`);
const msgs = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
let sending = false;

function addMsg(role, text, meta) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = '<div class="bubble">' + escapeHtml(text) + '</div>' + (meta ? '<div class="meta">' + meta + '</div>' : '');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function escapeHtml(s) { return s?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ''; }

async function send() {
  const text = input.value.trim();
  if (!text || sending) return;
  sending = true;
  sendBtn.disabled = true;
  input.value = '';
  addMsg('user', text);
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.textContent = character_name + ' is thinking...';
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    typing.remove();
    addMsg('assistant', data.reply, data.usage || '');
  } catch (e) {
    typing.remove();
    addMsg('assistant', 'Error: ' + e.message);
  }
  sending = false;
  sendBtn.disabled = false;
  input.focus();
}

const character_name = '${character.name}';
sendBtn.onclick = send;
input.onkeydown = (e) => { if (e.key === 'Enter') send(); };

ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'init') {
    // Restore conversations
    const d = event.data;
    (d.conversations || []).forEach(m => addMsg(m.role, m.text, m.meta || ''));
    // Restore tool calls
    const toolsEl = document.getElementById('tools');
    if (d.toolCalls?.length) {
      toolsEl.innerHTML = d.toolCalls.map(t => {
        const cls = t.status === 'ok' ? 'tool-ok' : 'tool-fail';
        return '<div class="tool-entry"><span class="tool-name">' + t.name + '</span><span class="' + cls + '">' + t.status + '</span><span>' + (t.latencyMs||'-') + 'ms</span></div>';
      }).join('');
    }
    // Restore logs
    const logsEl = document.getElementById('logs');
    (d.logs || []).forEach(l => {
      logsEl.innerHTML += '<div class="log-entry"><span class="time">' + (l.timestamp?.slice(11,19)||'') + '</span> ' + escapeHtml(l.message) + '</div>';
    });
    // Restore usage
    if (d.usage) document.getElementById('usage').innerHTML = d.usage;
    msgs.scrollTop = msgs.scrollHeight;
  }
  if (event.type === 'toolCall') {
    const el = document.getElementById('tools');
    const d = event.data;
    if (el.textContent === 'None') el.innerHTML = '';
    const cls = d.status === 'ok' ? 'tool-ok' : 'tool-fail';
    el.innerHTML = '<div class="tool-entry"><span class="tool-name">' + d.name + '</span><span class="' + cls + '">' + d.status + '</span><span>' + (d.latencyMs||'-') + 'ms</span></div>' + el.innerHTML;
  }
  if (event.type === 'log') {
    const el = document.getElementById('logs');
    const d = event.data;
    el.innerHTML += '<div class="log-entry"><span class="time">' + (d.timestamp?.slice(11,19)||'') + '</span> ' + escapeHtml(d.message) + '</div>';
    el.scrollTop = el.scrollHeight;
  }
  if (event.type === 'usage') {
    document.getElementById('usage').innerHTML = event.data;
  }
};
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/test') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  } else if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { message } = JSON.parse(body);

    dashboard.addLog('info', `Test message: ${message.slice(0, 80)}`);
    conversations.push({ role: 'user', text: message, timestamp: new Date().toISOString() });
    broadcast({ type: 'message', data: { role: 'user', text: message } });

    try {
      const response = await agent.process(message, {
        userId: 'test-user',
        userName: 'Test User',
        channelId: 'test',
        threadId: 'test-session',
        attachments: [],
      }, dashboard);

      const usage = getUsageSummary();
      conversations.push({ role: 'assistant', text: response, meta: usage, timestamp: new Date().toISOString() });
      broadcast({ type: 'message', data: { role: 'assistant', text: response, meta: usage } });
      broadcast({ type: 'usage', data: usage });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: response, usage }));
    } catch (err) {
      dashboard.addLog('error', `Error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: `Error: ${err.message}` }));
    }
  } else if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      character: { name: character.name, bio: character.bio },
      toolCalls: toolCalls.slice(-20),
      logs: logs.slice(-50),
      uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      usage: getUsageStats(),
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const conversations = []; // {role, text, meta, timestamp}

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'init', data: {
    conversations,
    toolCalls: toolCalls.slice(-20),
    logs: logs.slice(-50),
    usage: getUsageSummary(),
  }}));
  ws.on('close', () => wsClients.delete(ws));
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`[Automate-E] ${character.name} test mode running at http://localhost:${port}`);
  console.log(`[Automate-E] No Discord — chat via the web interface`);
});
