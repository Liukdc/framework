// MetaAgent v5.8 — server.js
// Web 界面后端。node server.js 启动后浏览器打开 http://localhost:3000
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from './index.js';

const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// 全局 agent 实例（单例）
let agent = null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`[${req.method}] ${url.pathname}`);

  // 静态文件: / → chat.html
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/chat.html')) {
    const html = readFileSync(join(__dirname, 'chat.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // POST /start — 初始化 agent
  if (req.method === 'POST' && url.pathname === '/start') {
    try {
      if (!agent) agent = await createAgent();
      await agent.startSession('web');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: 'web', message: '元智能体已就绪。说出你的智能体设计想法。' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /chat — 一轮对话
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

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 被占用。换端口启动: PORT=3001 node src-v5.8/server.js`);
    console.error(`   或者先杀掉占用进程: cmd /c "for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT}') do taskkill /F /PID %a"`);
    process.exit(1);
  }
  console.error('服务错误:', err);
});

server.listen(PORT, () => {
  console.log(`\n  MetaAgent v5.8 Web 界面`);
  console.log(`  浏览器打开: http://localhost:${PORT}\n`);
});
