/**
 * TikTok Outreach Bot Server
 * ─────────────────────────────────────────────
 * 1. Polls Telegram every 2s for new messages
 * 2. Extracts TikTok usernames from links you send
 * 3. Saves them to reached.json
 * 4. Serves reached.json at PUBLIC URL
 *    so the GitHub Pages dashboard can read it
 *
 * HOW TO RUN ON RAILWAY:
 *   Just deploy! Railway will use the start script
 */

const fs      = require('fs');
const path    = require('path');
const http    = require('http');
const https   = require('https');

// ── CONFIG ────────────────────────────────────────────────────────
// Use environment variables on Railway, fallback to hardcoded for local
const BOT_TOKEN    = process.env.BOT_TOKEN || '8701558725:AAEHFB0hMfDlCVWKVHrTngXwcnegNbMUsIA';
const CHAT_ID      = process.env.CHAT_ID || '2112600021';
const REACHED_FILE = path.join(__dirname, 'reached.json');
const PORT         = process.env.PORT || 3001;  // Railway sets PORT env variable
const POLL_MS      = 2000;

// ── INIT reached.json ─────────────────────────────────────────────
if (!fs.existsSync(REACHED_FILE)) {
  fs.writeFileSync(REACHED_FILE, JSON.stringify({ reached: [], lastUpdated: null }, null, 2));
  console.log('✅ Created reached.json');
}

// ── HTTP SERVER (serves reached.json to dashboard) ────────────────
const server = http.createServer((req, res) => {
  // Allow any origin to fetch (GitHub Pages, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { 
    res.writeHead(204); 
    res.end(); 
    return; 
  }

  if (req.url === '/reached' || req.url === '/reached.json') {
    try {
      const data = fs.readFileSync(REACHED_FILE, 'utf8');
      res.writeHead(200);
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Could not read reached.json' }));
    }
  } else if (req.url === '/status') {
    const data = loadReached();
    res.writeHead(200);
    res.end(JSON.stringify({ 
      ok: true, 
      reachedCount: data.reached.length, 
      lastUpdated: data.lastUpdated 
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found. Use /reached' }));
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Server running at https://your-railway-app.up.railway.app`);
  console.log(`   Dashboard should fetch reached accounts from /reached\n`);
});

// ── Telegram API helpers ──────────────────────────────────────────
function tgRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(params).toString();
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}?${query}`,
      method: 'GET',
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { 
          const parsed = JSON.parse(body);
          if (!parsed.ok) {
            reject(new Error(`Telegram API error: ${parsed.description}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('JSON parse error'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sendMessage(text) {
  return tgRequest('sendMessage', { 
    chat_id: CHAT_ID, 
    text, 
    parse_mode: 'HTML' 
  }).catch(err => {
    console.error('Failed to send message:', err.message);
  });
}

// ── Extract TikTok username ───────────────────────────────────────
function extractUsername(text) {
  // Handles: https://tiktok.com/@user, @user, tiktok.com/@user, plain "user"
  const patterns = [
    /tiktok\.com\/@?([a-zA-Z0-9_.]+)/i,
    /^@([a-zA-Z0-9_.]+)$/,
    /^([a-zA-Z0-9_.]{3,30})$/,
  ];
  for (const p of patterns) {
    const m = text.trim().match(p);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// ── Load / Save ───────────────────────────────────────────────────
function loadReached() {
  try { 
    return JSON.parse(fs.readFileSync(REACHED_FILE, 'utf8')); 
  } catch { 
    return { reached: [], lastUpdated: null }; 
  }
}

function saveReached(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REACHED_FILE, JSON.stringify(data, null, 2));
}

// ── Telegram Poll Loop ────────────────────────────────────────────
let offset = 0;

async function poll() {
  try {
    const data = await tgRequest('getUpdates', { 
      offset, 
      timeout: 10,  // Longer timeout for cloud
      allowed_updates: ['message'] 
    });
    
    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      offset = update.update_id + 1;
      const msg = update.message;
      if (!msg || !msg.text) continue;

      // const fromId = String(msg.chat.id);
      // Commented out so anyone can use - remove // if you want to restrict

      const text = msg.text.trim();

      // ── Commands ──
      if (text === '/start' || text === '/help') {
        await sendMessage(
          `👋 <b>TikTok Outreach Bot</b>\n\n` +
          `Send me a TikTok link or @username to mark it as reached.\n\n` +
          `You can also send <b>multiple links</b>, one per line!\n\n` +
          `Commands:\n` +
          `/stats — outreach stats\n` +
          `/list — last 10 reached\n` +
          `/reset — clear all data`
        );
        continue;
      }

      if (text === '/stats') {
        const d = loadReached();
        const pct = (d.reached.length / 10000 * 100).toFixed(1);
        await sendMessage(
          `📊 <b>Outreach Stats</b>\n\n` +
          `✅ Reached: <b>${d.reached.length.toLocaleString()}</b> / 10,000\n` +
          `📈 Progress: <b>${pct}%</b>\n` +
          `⏳ Remaining: <b>${(10000 - d.reached.length).toLocaleString()}</b>\n` +
          `🕒 Last updated: ${d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : 'never'}`
        );
        continue;
      }

      if (text === '/list') {
        const d = loadReached();
        const last10 = d.reached.slice(-10).reverse();
        if (!last10.length) { 
          await sendMessage('No accounts reached yet.'); 
          continue; 
        }
        const list = last10.map((r, i) => `${i+1}. @${r.username}`).join('\n');
        await sendMessage(`📋 <b>Last 10 Reached:</b>\n\n${list}`);
        continue;
      }

      if (text === '/reset') {
        saveReached({ reached: [], lastUpdated: new Date().toISOString() });
        await sendMessage('🔄 All reached accounts cleared. Dashboard reset.');
        continue;
      }

      // ── Handle single or multiple links (one per line) ──
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const d = loadReached();
      const results = [];
      let newCount = 0;

      for (const line of lines) {
        const username = extractUsername(line);
        if (!username) {
          results.push(`❌ Couldn't parse: ${line}`);
          continue;
        }
        const already = d.reached.find(r => r.username === username);
        if (already) {
          results.push(`⚠️ Already reached: @${username}`);
          continue;
        }
        d.reached.push({ 
          username, 
          timestamp: new Date().toISOString(), 
          link: `https://tiktok.com/@${username}` 
        });
        results.push(`✅ Marked: @${username}`);
        newCount++;
        console.log(`[${new Date().toLocaleTimeString()}] Reached: @${username} (total: ${d.reached.length})`);
      }

      if (newCount > 0) {
        saveReached(d);
      }

      const summary = results.join('\n');
      const total = d.reached.length;
      const pct = (total / 10000 * 100).toFixed(1);
      await sendMessage(
        `${summary}\n\n📊 Total reached: <b>${total.toLocaleString()}</b> / 10,000 (${pct}%)`
      );
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Poll error:`, err.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🤖 TikTok Outreach Bot Server');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Bot Token set    : ${BOT_TOKEN ? '✅ Yes' : '❌ No'}`);
console.log(`  Telegram Chat ID : ${CHAT_ID}`);
console.log(`  Polling every    : ${POLL_MS}ms`);
console.log(`  Reached file     : ${REACHED_FILE}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Send startup message (silently fail if not needed)
sendMessage('🤖 <b>Outreach Bot is online on Railway!</b>\nSend me TikTok links to mark accounts as reached. Use /help for commands.').catch(() => {});

// Start polling
setInterval(poll, POLL_MS);
poll();