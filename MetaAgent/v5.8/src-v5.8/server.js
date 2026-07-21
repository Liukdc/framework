// MetaAgent v5.8 — server.js
// Web 界面后端。node server.js 启动后浏览器打开 http://localhost:3000
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from './index.js';

let PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

let agent = null;
let apiKey = process.env.DEEPSEEK_API_KEY || '';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`[${req.method}] ${url.pathname}`);

  // GET / → chat.html
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/chat.html')) {
    const html = readFileSync(join(__dirname, 'chat.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // GET /status — 检测 API key 是否已设置
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasKey: !!apiKey,
      hasAgent: !!agent,
      message: apiKey ? '就绪' : '请设置 API key'
    }));
    return;
  }

  // POST /set-key — 从浏览器接收 API key
  if (req.method === 'POST' && url.pathname === '/set-key') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        if (!key || !key.startsWith('sk-')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '无效的 API key（应以 sk- 开头）' }));
          return;
        }
        apiKey = key;
        agent = null; // 重建
        console.log('[server] API key 已设置');
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400); res.end('{}'); }
    });
    return;
  }

  // POST /start — 初始化 agent
  if (req.method === 'POST' && url.pathname === '/start') {
    try {
      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请先设置 API key' }));
        return;
      }
      if (!agent) agent = await createAgent({ apiKey });
      await agent.startSession('web');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: 'web', message: '元智能体已就绪。说出你的智能体设计想法。' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url.pathname === '/chat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { input } = JSON.parse(body);
        if (!agent) { res.writeHead(400); res.end(JSON.stringify({error:'请先调用 /start'})); return; }
        const resp = await agent.sendMessage(input);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ state: resp.state, intent: resp.intent, content: resp.content, turnType: resp.turnType }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && PORT < 3020) {
    console.log(`端口 ${PORT} 被占用，尝试 ${PORT + 1}...`);
    PORT++; server.listen(PORT);
  } else { console.error('服务错误:', err); process.exit(1); }
});

server.listen(PORT, () => {
  if (apiKey) {
    console.log(`\n  MetaAgent v5.8 Web 界面 (API key 已检测)`);
  } else {
    console.log(`\n  ⚠️  未检测到 API key。浏览器打开后在页面中输入。`);
  }
  console.log(`  浏览器打开: http://localhost:${PORT}\n`);
});
