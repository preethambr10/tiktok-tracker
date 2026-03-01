/**
 * TikTok Outreach Bot Server - Final Version
 * For Render deployment - 100% FREE forever
 */

const { MongoClient } = require('mongodb');
const https = require('https');
const http = require('http');
const url = require('url');

// ── CONFIG (ALL from environment variables – set these in Render) ──
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID   = process.env.CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3001;

// Total number of accounts in your dashboard (update this if your list changes)
const TOTAL_ACCOUNTS = 2479;

// Exit if critical env vars are missing
if (!BOT_TOKEN || !CHAT_ID || !MONGODB_URI) {
  console.error('❌ Missing required environment variables. Exiting.');
  process.exit(1);
}

// ── MongoDB Connection ────────────────────────────────────────────
let db;
let reachedCollection;

async function connectToMongo() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');
    db = client.db('tiktok_bot');
    reachedCollection = db.collection('reached');
    await reachedCollection.createIndex({ username: 1 }, { unique: true });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// ── Load / Save Functions ─────────────────────────────────────────
async function loadReached() {
  try {
    const reached = await reachedCollection.find({}).toArray();
    const lastUpdated = await db.collection('metadata').findOne({ key: 'lastUpdated' });
    return {
      reached: reached || [],
      lastUpdated: lastUpdated?.value || null
    };
  } catch {
    return { reached: [], lastUpdated: null };
  }
}

async function saveReached(username) {
  const timestamp = new Date().toISOString();
  await reachedCollection.insertOne({
    username: username.toLowerCase(),
    timestamp,
    link: `https://tiktok.com/@${username}`
  });
  await db.collection('metadata').updateOne(
    { key: 'lastUpdated' },
    { $set: { value: timestamp } },
    { upsert: true }
  );
  return await reachedCollection.countDocuments();
}

async function checkIfExists(username) {
  const result = await reachedCollection.findOne({ username: username.toLowerCase() });
  return !!result;
}

async function resetAll() {
  await reachedCollection.deleteMany({});
  await db.collection('metadata').updateOne(
    { key: 'lastUpdated' },
    { $set: { value: new Date().toISOString() } },
    { upsert: true }
  );
}

// ── HTTP Server for Dashboard ─────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/reached' || parsedUrl.pathname === '/reached.json') {
    try {
      const data = await loadReached();
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Could not read from database' }));
    }
  } else if (parsedUrl.pathname === '/status') {
    const data = await loadReached();
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
  return tgRequest('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML' })
    .catch(err => console.error('Failed to send message:', err.message));
}

// ── Extract TikTok username ───────────────────────────────────────
function extractUsername(text) {
  const patterns = [
    /tiktok\.com\/@?([a-zA-Z0-9_.]+)/i,
    /^@([a-zA-Z0-9_.]+)$/
  ];
  for (const p of patterns) {
    const m = text.trim().match(p);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// ── Telegram Poll Loop ────────────────────────────────────────────
let offset = 0;

async function poll() {
  try {
    const data = await tgRequest('getUpdates', { offset, timeout: 10, allowed_updates: ['message'] });
    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      offset = update.update_id + 1;
      const msg = update.message;
      if (!msg || !msg.text) continue;

      const text = msg.text.trim();

      // Commands
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
        const data = await loadReached();
        const pct = (data.reached.length / TOTAL_ACCOUNTS * 100).toFixed(1);
        await sendMessage(
          `📊 <b>Outreach Stats</b>\n\n` +
          `✅ Reached: <b>${data.reached.length.toLocaleString()}</b> / ${TOTAL_ACCOUNTS}\n` +
          `📈 Progress: <b>${pct}%</b>\n` +
          `⏳ Remaining: <b>${(TOTAL_ACCOUNTS - data.reached.length).toLocaleString()}</b>\n` +
          `🕒 Last updated: ${data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'never'}`
        );
        continue;
      }

      if (text === '/list') {
        const data = await loadReached();
        const last10 = data.reached.slice(-10).reverse();
        if (!last10.length) {
          await sendMessage('No accounts reached yet.');
          continue;
        }
        const list = last10.map((r, i) => `${i+1}. @${r.username}`).join('\n');
        await sendMessage(`📋 <b>Last 10 Reached:</b>\n\n${list}`);
        continue;
      }

      if (text === '/reset') {
        await resetAll();
        await sendMessage('🔄 All reached accounts cleared. Dashboard reset.');
        continue;
      }

      // Handle usernames
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const results = [];
      let newCount = 0;

      for (const line of lines) {
        const username = extractUsername(line);
        if (!username) {
          results.push(`❌ Couldn't parse: ${line}`);
          continue;
        }

        const exists = await checkIfExists(username);
        if (exists) {
          results.push(`⚠️ Already reached: @${username}`);
          continue;
        }

        const total = await saveReached(username);
        results.push(`✅ Marked: @${username}`);
        newCount++;
        console.log(`[${new Date().toLocaleTimeString()}] Reached: @${username} (total: ${total})`);
      }

      const total = await reachedCollection.countDocuments();
      const pct = (total / TOTAL_ACCOUNTS * 100).toFixed(1);
      const summary = results.join('\n');
      await sendMessage(
        `${summary}\n\n📊 Total reached: <b>${total.toLocaleString()}</b> / ${TOTAL_ACCOUNTS} (${pct}%)`
      );
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Poll error:`, err.message);
  }
}

// ── Start Everything ──────────────────────────────────────────────
async function start() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🤖 TikTok Outreach Bot Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  await connectToMongo();
  
  server.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`   Your Render URL is: https://your-app.onrender.com (check Render dashboard)`);
  });
  
  sendMessage('🤖 <b>Outreach Bot is online on Render!</b>\nSend me TikTok links to mark accounts as reached. Use /help for commands.');
  
  setInterval(poll, 2000);
  poll();
}

start();
