// 広尾親父RC bot 中継サーバー（Cloudflare Workers）
// 役割: API鍵を預かり、公開サイトの本文を知識ベースにして Claude に質問を渡す。
// 入口は2つ: /chat（サイトの小窓）と /line（LINE公式アカウントの webhook）。
// 設定は wrangler.toml（公開値）と `wrangler secret`（鍵・合言葉・LINEのトークン）。

const PAGES = [
  'about', 'run-guide', 'pain', 'races', 'races-2025', 'garmin', 'kintore',
  'links', 'swim-guide', 'bike-guide', 'trailrun-guide', 'triathlon-guide',
];
const PAGE_TITLES = {
  about: '部の紹介', 'run-guide': 'ランニング入門', pain: '痛み撲滅委員会',
  races: '年間レース表（今年度）', 'races-2025': '2025年レース表', garmin: 'Garmin活用',
  kintore: '筋トレ', links: 'リンク集', 'swim-guide': 'スイム入門', 'bike-guide': 'バイク入門',
  'trailrun-guide': 'トレラン入門', 'triathlon-guide': 'トライアスロン入門', history: '活動アーカイブ',
};
const KB_KEY = 'kb:v1';
const KB_TTL_SEC = 24 * 60 * 60;       // 知識ベースは1日ごとに取り直す
const MAX_QUESTION_CHARS = 400;
const HISTORY_KEEP = 6;                 // 直近の往復だけ渡す（トークン節約）
const PER_MINUTE_LIMIT = 10;            // 同じ相手から1分に10問まで

const SYSTEM_RULES = `あなたは「広尾親父RC bot」。広尾親父RC（東京・広尾の市民ランニングクラブ）のサイト案内役です。名前を聞かれたら「広尾親父RC bot」と答える。
部員からの質問に、次に渡す「サイト資料」だけを根拠に日本語で答えます。

守ること:
- 資料に書いてあることはその通りに答える。日付・記録・参加者は資料の表記を変えない。
- 資料にないことは「サイトには載っていない」と正直に言う。推測で埋めない。
- 一般的なランニングの知識（練習法・故障・装備）は、資料を優先しつつ常識の範囲で短く補ってよい。
- 部やランニングと関係ない話題（プログラミング、宿題、雑談の相手など）は丁寧に断る。
- 部員の本名・連絡先・住所など資料にない個人情報は答えない、推測もしない。
- 太字（**）や見出し記号（#）などのマークダウン記法は使わない。箇条書きは行頭「・」で書く。
- 回答は簡潔に。目安200字、箇条書きは最大6項目まで。該当が多いときは代表的なものに絞り、「他にも◯件あります。絞り込んで聞いてください」と添える。長い説明を求められたときだけ長くする。
- 関連するページがあれば、最後に「→ ページ名」の形で案内する（URLは書かない）。
- 医療的な判断（この痛みは走ってよいか等）は一般論にとどめ、整形外科など専門家への相談を勧める。`;

function siteBase(env) {
  return (env.SITE_BASE || 'https://morihiko.github.io/hiroopapa-rc/').replace(/\/?$/, '/');
}

// ---------- 知識ベース ----------
function htmlToText(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<[^>]+>/g, '\n');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  return s.trim();
}

function extractHistoryTable(html) {
  const i = html.indexOf('[{"id"');
  if (i < 0) return '';
  // 配列の終わりを括弧の対応で探す（文字列内の括弧は無視）
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) return '';
  let arr;
  try { arr = JSON.parse(html.slice(i, end)); } catch { return ''; }
  const cols = ['date', 'y', 'cat', 'title', 'desc', 'members', 'memory', 'rec'];
  const rows = arr.map(r => cols.map(k => String(r[k] ?? '').replace(/\s+/g, ' ')).join(' | '));
  return '=== 活動アーカイブ（列: 日付 | 年 | 種別 | 大会・活動名 | 内容 | 参加者 | 思い出 | 記録）===\n' + rows.join('\n');
}

async function buildKb(env) {
  const base = siteBase(env);
  const parts = [];
  for (const p of PAGES) {
    const res = await fetch(base + p + '.html', { cf: { cacheTtl: 3600 } });
    if (!res.ok) { console.log('kb fetch failed', p, res.status); continue; }
    parts.push(`=== ページ: ${PAGE_TITLES[p] || p} (${p}.html) ===\n` + htmlToText(await res.text()));
  }
  const hist = await fetch(base + 'history.html', { cf: { cacheTtl: 3600 } });
  if (hist.ok) parts.push(extractHistoryTable(await hist.text()));
  const kb = parts.join('\n\n');
  if (kb.length < 10000) throw new Error('knowledge base too small: ' + kb.length);
  return kb;
}

async function getKb(env, ctx) {
  const cached = await env.CHAT_KV.get(KB_KEY);
  if (cached) return cached;
  const kb = await buildKb(env);
  const save = env.CHAT_KV.put(KB_KEY, kb, { expirationTtl: KB_TTL_SEC });
  if (ctx && ctx.waitUntil) ctx.waitUntil(save); else await save;
  return kb;
}

// ---------- 上限 ----------
function jstDate() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function bump(kv, key, ttl) {
  const n = parseInt((await kv.get(key)) || '0', 10) + 1;
  await kv.put(key, String(n), { expirationTtl: ttl });
  return n;
}

// ---------- 本体 ----------
function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || 'https://morihiko.github.io').split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Club-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

async function askClaude(env, kb, messages) {
  const body = {
    model: env.MODEL || 'claude-haiku-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: SYSTEM_RULES },
      { type: 'text', text: 'サイト資料:\n\n' + kb, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `今日の日付: ${jstDate()}（日本時間）` },
    ],
    messages,
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.log('claude error', res.status, JSON.stringify(data).slice(0, 300));
    const err = new Error('claude ' + res.status); err.status = res.status; throw err;
  }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const u = data.usage || {};
  console.log(JSON.stringify({ usage: { input: u.input_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens, output: u.output_tokens }, stop: data.stop_reason }));
  if (data.stop_reason === 'refusal' || !text) return 'その質問にはお答えできません。ランニングや部の活動について聞いてください。';
  return text;
}

async function handleChat(request, env, ctx) {
  const origin = request.headers.get('Origin') || '';
  const cors = corsHeaders(env, origin);

  if (env.CLUB_TOKEN && request.headers.get('X-Club-Token') !== env.CLUB_TOKEN) {
    return json({ error: 'unauthorized' }, 401, cors);
  }

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? MAX_QUESTION_CHARS : 2000) }))
    .slice(-HISTORY_KEEP);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json({ error: 'no question' }, 400, cors);
  }
  if (messages[0].role !== 'user') messages.shift();
  const q = messages[messages.length - 1].content.trim();
  if (!q) return json({ error: 'empty' }, 400, cors);

  // 上限: 1日の総数と、同じ相手の1分あたり
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const perMin = await bump(env.CHAT_KV, `ip:${ip}:${minute}`, 120);
  if (perMin > PER_MINUTE_LIMIT) return json({ reply: '少し間をあけてから聞いてください。' }, 429, cors);
  const dailyLimit = parseInt(env.DAILY_LIMIT || '100', 10);
  const today = await bump(env.CHAT_KV, `day:${jstDate()}`, 2 * 24 * 3600);
  if (today > dailyLimit) return json({ reply: '今日の質問数が上限に達しました。明日また聞いてください。' }, 429, cors);

  try {
    const kb = await getKb(env, ctx);
    const reply = await askClaude(env, kb, messages);
    return json({ reply }, 200, cors);
  } catch (e) {
    console.log('chat failed', e.message);
    const msg = e.status === 429 || e.status >= 500 ? '今は混み合っています。少し待ってからもう一度どうぞ。' : 'うまく答えられませんでした。時間をおいて試してください。';
    return json({ reply: msg, error: e.message }, 502, cors);
  }
}


// ---------- LINE ----------
const LINE_API = 'https://api.line.me/v2/bot';
const LINE_HISTORY_TTL = 60 * 60;        // 会話の続きを覚えておく時間
const LINE_GREETING = 'こんにちは、広尾親父RC bot です。サイトに載っていること（レース表・練習の目安・活動アーカイブなど）なら答えられます。例:「来月のレース予定は？」「次の定例ランはいつ？」';
const LINE_GROUP_GREETING = '広尾親父RC bot です。グループでは「@広尾親父RC bot」と呼びかけたメッセージだけに答えます。';

async function lineVerify(secret, body, signature) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function lineApi(env, path, payload) {
  const res = await fetch(LINE_API + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.log('line api', path, res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

async function lineSend(env, replyToken, chatId, text) {
  const messages = [{ type: 'text', text: text.replace(/\*\*/g, '').slice(0, 4900) }];
  if (replyToken && await lineApi(env, '/message/reply', { replyToken, messages })) return;
  // 返信トークンが切れていたら push（無料枠の通数を1つ使う）
  await lineApi(env, '/message/push', { to: chatId, messages });
}

function lineQuestion(message) {
  // グループではメンションされたときだけ。メンション部分を本文から外す
  let text = message.text || '';
  const mentionees = (message.mention && message.mention.mentionees) || [];
  const toSelf = mentionees.some(m => m.isSelf === true);
  const ranges = mentionees.filter(m => m.isSelf === true).sort((a, b) => b.index - a.index);
  for (const r of ranges) text = text.slice(0, r.index) + text.slice(r.index + r.length);
  return { toSelf, text: text.trim() };
}

async function processLineEvents(events, env, ctx) {
  for (const ev of events) {
    try {
      const src = ev.source || {};
      const chatId = src.groupId || src.roomId || src.userId;
      const isGroup = src.type !== 'user';
      if (ev.type === 'follow') { await lineSend(env, ev.replyToken, chatId, LINE_GREETING); continue; }
      if (ev.type === 'join') { await lineSend(env, ev.replyToken, chatId, LINE_GROUP_GREETING); continue; }
      if (ev.type !== 'message') continue;
      if (ev.message.type !== 'text') { if (!isGroup) await lineSend(env, ev.replyToken, chatId, '文字で質問してください。'); continue; }

      const { toSelf, text } = lineQuestion(ev.message);
      if (isGroup && !toSelf) continue;
      if (!text) { await lineSend(env, ev.replyToken, chatId, '聞きたいことを文字で送ってください。'); continue; }

      const who = src.userId || chatId;
      const minute = Math.floor(Date.now() / 60000);
      if (await bump(env.CHAT_KV, `line:${who}:${minute}`, 120) > PER_MINUTE_LIMIT) { await lineSend(env, ev.replyToken, chatId, '少し間をあけてから聞いてください。'); continue; }
      const dailyLimit = parseInt(env.DAILY_LIMIT || '100', 10);
      if (await bump(env.CHAT_KV, `day:${jstDate()}`, 2 * 24 * 3600) > dailyLimit) { await lineSend(env, ev.replyToken, chatId, '今日の質問数が上限に達しました。明日また聞いてください。'); continue; }

      if (!isGroup) lineApi(env, '/chat/loading/start', { chatId, loadingSeconds: 20 }).catch(() => {});

      const histKey = `line:hist:${chatId}`;
      let history = [];
      try { history = JSON.parse((await env.CHAT_KV.get(histKey)) || '[]'); } catch { history = []; }
      const messages = [...history, { role: 'user', content: text.slice(0, MAX_QUESTION_CHARS) }].slice(-HISTORY_KEEP);
      if (messages[0].role !== 'user') messages.shift();

      let reply;
      try {
        const kb = await getKb(env, ctx);
        reply = await askClaude(env, kb, messages);
      } catch (e) {
        console.log('line chat failed', e.message);
        reply = '今はうまく答えられません。少し待ってからもう一度どうぞ。';
      }
      await lineSend(env, ev.replyToken, chatId, reply);
      await env.CHAT_KV.put(histKey, JSON.stringify([...messages, { role: 'assistant', content: reply }].slice(-HISTORY_KEEP)), { expirationTtl: LINE_HISTORY_TTL });
    } catch (e) {
      console.log('line event failed', e.message);
    }
  }
}

async function handleLine(request, env, ctx) {
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) return json({ error: 'line not configured' }, 503, {});
  const body = await request.text();
  if (!(await lineVerify(env.LINE_CHANNEL_SECRET, body, request.headers.get('x-line-signature')))) return json({ error: 'bad signature' }, 401, {});
  let data;
  try { data = JSON.parse(body); } catch { return json({ error: 'bad json' }, 400, {}); }
  const work = processLineEvents(data.events || [], env, ctx);
  if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  return json({ ok: true }, 200, {});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    if (url.pathname === '/health') return json({ ok: true, date: jstDate() }, 200, {});
    if (url.pathname === '/chat' && request.method === 'POST') return handleChat(request, env, ctx);
    if (url.pathname === '/line' && request.method === 'POST') return handleLine(request, env, ctx);
    return json({ error: 'not found' }, 404, {});
  },
};

export const _internal = { htmlToText, extractHistoryTable, buildKb, PAGES, lineVerify, lineQuestion };
