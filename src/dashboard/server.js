import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory state — populated by the agent process
const state = {
  character: null,
  sessions: new Map(),    // threadId → {lastMessage, messageCount, startedAt}
  toolCalls: [],          // [{name, timestamp, status, latencyMs}] — last 100
  logs: [],               // [{level, message, timestamp}] — last 500
  startedAt: new Date(),
};

// WebSocket clients for live updates
const wsClients = new Set();

export function createDashboard(character, memory) {
  state.character = character;

  const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');

  const server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        character: { name: state.character?.name, bio: state.character?.bio },
        sessions: Object.fromEntries(state.sessions),
        toolCalls: state.toolCalls.slice(-20),
        logs: state.logs.slice(-50),
        uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
        memoryType: memory ? 'postgres' : 'in-memory',
      }));
    } else if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    // Send current state on connect
    ws.send(JSON.stringify({ type: 'init', data: {
      character: { name: state.character?.name, bio: state.character?.bio },
      sessions: Object.fromEntries(state.sessions),
      toolCalls: state.toolCalls.slice(-20),
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
    }}));
    ws.on('close', () => wsClients.delete(ws));
  });

  const port = process.env.DASHBOARD_PORT || 3000;
  server.listen(port, () => {
    console.log(`[Automate-E] Dashboard running on http://0.0.0.0:${port}`);
  });

  return { addLog, addToolCall, updateSession };
}

function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

export function addLog(level, message) {
  const entry = { level, message, timestamp: new Date().toISOString() };
  state.logs.push(entry);
  if (state.logs.length > 500) state.logs.shift();
  broadcast({ type: 'log', data: entry });
}

export function addToolCall(name, status, latencyMs) {
  const entry = { name, status, latencyMs, timestamp: new Date().toISOString() };
  state.toolCalls.push(entry);
  if (state.toolCalls.length > 100) state.toolCalls.shift();
  broadcast({ type: 'toolCall', data: entry });
}

export function updateSession(threadId, data) {
  const existing = state.sessions.get(threadId) || { messageCount: 0, startedAt: new Date().toISOString() };
  state.sessions.set(threadId, { ...existing, ...data, messageCount: existing.messageCount + 1, lastMessage: new Date().toISOString() });
  broadcast({ type: 'session', data: { threadId, ...state.sessions.get(threadId) } });
}
