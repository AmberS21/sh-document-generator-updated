/**
 * DocGen Backend API
 * Securely proxies requests to Anthropic and Ezekia APIs
 * API keys are stored as environment variables — never exposed to frontend
 */

const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── CORS (same-origin in prod, but needed for local dev) ─────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    claude: !!process.env.ANTHROPIC_API_KEY,
    ezekia: !!process.env.EZEKIA_API_KEY,
    ezekiaBaseUrl: process.env.EZEKIA_BASE_URL || 'https://ezekia.com/api'
  });
});

// ── Config endpoint (returns non-sensitive config to frontend) ────────────────
app.get('/api/config', (req, res) => {
  res.json({
    hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
    hasEzekiaKey: !!process.env.EZEKIA_API_KEY,
    ezekiaBaseUrl: process.env.EZEKIA_BASE_URL || 'https://ezekia.com/api',
    proxyUrl: '/api/proxy'
  });
});

// ── Anthropic proxy ───────────────────────────────────────────────────────────
function handleAnthropicProxy(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const body = JSON.stringify(req.body);

  const options = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!['transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Anthropic proxy error:', err.message);
    res.status(502).json({ error: 'Failed to reach Anthropic API', detail: err.message });
  });

  proxyReq.write(body);
  proxyReq.end();
}

app.post('/api/claude', handleAnthropicProxy);
// Legacy route used by existing frontend code
app.post('/api/proxy', handleAnthropicProxy);

// ── Ezekia proxy ──────────────────────────────────────────────────────────────
app.all(['/api/ezekia', '/api/ezekia/*'], (req, res) => {
  const apiKey = process.env.EZEKIA_API_KEY;
  const baseUrl = process.env.EZEKIA_BASE_URL || 'https://ezekia.com/api';

  if (!apiKey) {
    return res.status(500).json({ error: 'EZEKIA_API_KEY not configured on server' });
  }

  // Strip /api/ezekia prefix and forward to Ezekia while preserving base path.
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const ezekiaPath = req.path.replace(/^\/api\/ezekia\/?/, '');
  const qIndex = req.originalUrl.indexOf('?');
  const queryString = qIndex >= 0 ? req.originalUrl.slice(qIndex) : '';
  const targetUrl = new URL(ezekiaPath + queryString, normalizedBaseUrl);

  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const body = req.method !== 'GET' ? JSON.stringify(req.body) : null;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
    }
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!['transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Ezekia proxy error:', err.message);
    res.status(502).json({ error: 'Failed to reach Ezekia API', detail: err.message });
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
});

// ── Generic external proxy (replaces Val Town proxy) ─────────────────────────
app.get('/api/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  // Validate URL is safe to proxy
  let parsed;
  try { parsed = new URL(targetUrl); } 
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { 'User-Agent': 'DocGen/1.0', 'Accept': 'text/html,application/json' }
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/plain');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'Proxy error', detail: err.message });
  });

  proxyReq.end();
});


// ── Usage Logging ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, 'usage_logs.json');

function readLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch { return []; }
}

function writeLogs(logs) {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(logs)); } catch {}
}

// POST /api/proxy/log — save a usage entry
app.post('/api/proxy/log', (req, res) => {
  try {
    const { userName, template, inputMethod, status, timestamp } = req.body;
    const logs = readLogs();
    logs.push({
      id: Date.now(),
      user: userName || 'Unknown',
      template: template || '',
      inputMethod: inputMethod || '',
      status: status || '',
      timestamp: timestamp || new Date().toISOString()
    });
    // Keep last 10000 entries
    if (logs.length > 10000) logs.splice(0, logs.length - 10000);
    writeLogs(logs);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/proxy/logs — return all logs as JSON
app.get('/api/proxy/logs', (req, res) => {
  try {
    const logs = readLogs();
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/proxy/logs/csv — download all logs as CSV
app.get('/api/proxy/logs/csv', (req, res) => {
  try {
    const logs = readLogs();
    const headers = ['ID','User','Template','Input Method','Status','Timestamp'];
    const rows = logs.map(r => [r.id, r.user, r.template, r.inputMethod, r.status, r.timestamp]
      .map(v => '"' + String(v||'').replace(/"/g, '""') + '"').join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="SH_DocGen_Usage_' + new Date().toISOString().slice(0,10) + '.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// In the container, nginx owns public port 80 and proxies to Node on 3000.
// Azure may inject PORT=80, so use a dedicated backend port variable.
const PORT = Number(process.env.BACKEND_PORT || 3000);
app.listen(PORT, () => console.log(`DocGen API running on port ${PORT}`));
