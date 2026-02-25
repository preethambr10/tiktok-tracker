/**
 * TikTok Outreach Bot Server
 * ─────────────────────────────────────────────
 * TeleBotHost Version - Uses webhooks instead of polling
 * 
 * HOW TO USE ON TELEBOTHOST:
 * 1. Create new bot on TeleBotHost
 * 2. Paste this entire code
 * 3. Set environment variables (BOT_TOKEN, CHAT_ID)
 * 4. Launch!
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');

// ── CONFIG ────────────────────────────────────────────────────────
// TeleBotHost will set these automatically
const BOT_TOKEN    = process.env.BOT_TOKEN || '8701558725:AAEHFB0hMfDlCVWKVHrTngXwcnegNbMUsIA';
const CHAT_ID      = process.env.CHAT_ID || '2112600021';
const REACHED_FILE = path.join(__dirname, 'reached.json');

// ── INIT reached.json ─────────────────────────────────────────────
if (!fs.existsSync(REACHED_FILE)) {
  fs.writeFileSync(REACHED_FILE, JSON.stringify({ reached: [], lastUpdated: null }, null, 2));
  console.log('✅ Created reached.json');
}

// ── Serve reached.json for dashboard ─────────────────────────────
// TeleBotHost automatically serves files from the 'public' folder
// Create a 'public' folder and put your reached.json there, or use their built-in storage

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

// ── TELEBOTHOST WEBHOOK HANDLER ──────────────────────────────────
// This is the main function that TeleBotHost calls when a message arrives
Bot.onWebhook((update) => {
  try {
    console.log('📩 Received update:', update);
    
    const msg = update.message;
    if (!msg || !msg.text) return;

    // Optional: Uncomment to restrict to specific chat
    // const fromId = String(msg.chat.id);
    // if (fromId !== CHAT_ID) return;

    const text = msg.text.trim();

    // ── Commands ──
    if (text === '/start' || text === '/help') {
      Bot.sendMessage(
        `👋 <b>TikTok Outreach Bot</b>\n\n` +
        `Send me a TikTok link or @username to mark it as reached.\n\n` +
        `You can also send <b>multiple links</b>, one per line!\n\n` +
        `Commands:\n` +
        `/stats — outreach stats\n` +
        `/list — last 10 reached\n` +
        `/reset — clear all data`
      );
      return;
    }

    if (text === '/stats') {
      const d = loadReached();
      const pct = (d.reached.length / 10000 * 100).toFixed(1);
      Bot.sendMessage(
        `📊 <b>Outreach Stats</b>\n\n` +
        `✅ Reached: <b>${d.reached.length.toLocaleString()}</b> / 10,000\n` +
        `📈 Progress: <b>${pct}%</b>\n` +
        `⏳ Remaining: <b>${(10000 - d.reached.length).toLocaleString()}</b>\n` +
        `🕒 Last updated: ${d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : 'never'}`
      );
      return;
    }

    if (text === '/list') {
      const d = loadReached();
      const last10 = d.reached.slice(-10).reverse();
      if (!last10.length) { 
        Bot.sendMessage('No accounts reached yet.'); 
        return; 
      }
      const list = last10.map((r, i) => `${i+1}. @${r.username}`).join('\n');
      Bot.sendMessage(`📋 <b>Last 10 Reached:</b>\n\n${list}`);
      return;
    }

    if (text === '/reset') {
      saveReached({ reached: [], lastUpdated: new Date().toISOString() });
      Bot.sendMessage('🔄 All reached accounts cleared. Dashboard reset.');
      return;
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
      console.log(`Reached: @${username} (total: ${d.reached.length})`);
    }

    if (newCount > 0) {
      saveReached(d);
    }

    const summary = results.join('\n');
    const total = d.reached.length;
    const pct = (total / 10000 * 100).toFixed(1);
    Bot.sendMessage(
      `${summary}\n\n📊 Total reached: <b>${total.toLocaleString()}</b> / 10,000 (${pct}%)`
    );
  } catch (err) {
    console.error('Error processing webhook:', err);
  }
});

// ── Serve reached.json for dashboard ─────────────────────────────
// TeleBotHost can serve static files - put reached.json in the 'public' folder
// or use their built-in database. For simplicity, we'll keep using file storage

// Start message
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🤖 TikTok Outreach Bot Server');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Bot Token set    : ${BOT_TOKEN ? '✅ Yes' : '❌ No'}`);
console.log(`  Telegram Chat ID : ${CHAT_ID}`);
console.log(`  Reached file     : ${REACHED_FILE}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('✅ Bot ready for TeleBotHost! Waiting for webhooks...');
