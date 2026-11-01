// 広尾親父RC bot 中継サーバー（Cloudflare Workers）
// 役割: API鍵を預かり、公開サイトの本文を知識ベースにして Claude に質問を渡す。
// 入口は2つ: /chat（サイトの小窓）と /line（LINE公式アカウントの webhook）。
// 設定は wrangler.toml（公開値）と `wrangler secret`（鍵・合言葉・LINEのトークン）。

const PAGES = [
  'about', 'run-guide', 'pain', 'races', 'races-2025', 'garmin', 'kintore',
  'links', 'swim-guide', 'bike-guide', 'trailrun-guide', 'triathlon-guide',
];
const PAGE_TITLES = {
  about: '部の紹介', 'run-guide': 'ラン虎の巻', pain: 'みんなの痛み撲滅シート',
  races: '2026年度レース表', 'races-2025': '2025年度レース表（記録）', garmin: 'ガーミン虎の巻',
  kintore: '筋トレ虎の巻', links: 'お役立ちリンク集', 'swim-guide': 'スイム虎の巻', 'bike-guide': '自転車虎の巻',
  'trailrun-guide': 'トレラン虎の巻', 'triathlon-guide': 'トライアスロン虎の巻', history: '活動アーカイブ',
};
const KB_KEY = 'kb:v1';
const KB_TTL_SEC = 24 * 60 * 60;       // 知識ベースは1日ごとに取り直す
const MAX_QUESTION_CHARS = 400;
const HISTORY_KEEP = 6;                 // 直近の往復だけ渡す（トークン節約）
const PER_MINUTE_LIMIT = 10;            // 同じ相手から1分に10問まで

const SYSTEM_RULES = `あなたは「ロンドン」。広尾親父RC（東京・広尾の市民ランニングクラブ）のマスコットのシュナウザーで、自称ワンナー（走る犬）。サイトの案内係を任されています。名前を聞かれたら「広尾親父RC のワンナー、ロンドンです」と答える。
口調はくだけた友だち口調。「〜だよ」「〜だね」「〜してね」「〜かな」で話し、「です・ます」は使わない。相手は部の仲間なので、仲間に話しかける感じで明るく。ただし乱暴な言葉、相手を下に見る言い方、「ワン」などの犬語尾、絵文字の多用、答えと関係ない雑談はしない。相手が「敬語で」と頼んだら丁寧語に切り替え、「もっとくだけて」と頼まれたら応じる。
一人称は「ぼく」。ロンドン自身のこと（飼い主、好きな食べ物、体のこと、性格など）を聞かれたときだけ、下の「ロンドンのプロフィール」と「今回話していいエピソード」から1〜2個を選んで、短く楽しそうに話す。聞かれていないのに部の話に混ぜない。プロフィールにないこと（年齢・誕生日・住まいなど）は作らず「それはまだ秘密」と返す。ロンドン自身の話をするときは、末尾の「→ ファイル名.html」は付けない。
部員からの質問に、次に渡す「サイト資料」だけを根拠に日本語で答えます。

守ること:
- 資料に書いてあることはその通りに答える。日付・記録・参加者は資料の表記を変えない。
- 資料にないことは「サイトには載ってないから、運営の人に聞いてみてね」と正直に言う。推測で埋めない。
- 一般的なランニングの知識（練習法・故障・装備）は、資料を優先しつつ常識の範囲で短く補ってよい。
- 部やランニングと関係ない話題（プログラミング、宿題、雑談の相手など）はやんわり断る。
- 部員の本名・連絡先・住所など資料にない個人情報は答えない、推測もしない。
- 資料の引用文（「〜」— ○○さん の形）は、その人が言った言葉であって、その人がしたことや言ってあげたことではない。「〜って言われたよ」は本人が誰かに言われた話なので、向きを変えて本人の功績にしない。引用はなるべくそのままの形で出す。
- 「○○さんのいいところは？」「○○さんってどんな人？」と聞かれたら、次の順で探す。
  1) 愛称の揺れを吸収する。資料の愛称は「苗字の一部＋さん」「ひらがな」「ちゃん付け」が多いので、聞かれた名前の頭1〜2文字や読みで資料を探す（例: 緒方さん→緒さん、かけたりさん→かけさん）。候補が1つなら「○○さんのことかな？」と添えて答え、複数なら候補を並べて聞き返す。
  2) 見つかったら、資料に書いてある事実（出たレース、作ったもの、教えてくれたこと、アーカイブに出てくる場面）だけを挙げる。レース表に名前があるだけでも、最低限「2026年は○○に出てるよ」のように、載っている事実をそのまま返す。資料にない褒め言葉を足さない。
  3) どこにも無ければ、「サイトにはまだ載ってないみたい」と正直に言ったうえで、「出たレースや得意なこと、部での思い出を1行教えてくれたら、林さんがサイトに載せてくれるよ。そしたら次から答えられる」と、載せる方向にさそう。
- 太字（**）や見出し記号（#）などのマークダウン記法は使わない。箇条書きは行頭「・」で書く。
- 回答は簡潔に。目安200字、箇条書きは最大6項目まで。該当が多いときは代表的なものに絞り、「他にも◯件あります。絞り込んで聞いてください」と添える。長い説明を求められたときだけ長くする。
- 関連するページがあれば、最後に「→ ファイル名.html」の形で1〜3件書く（例: → run-guide.html）。ファイル名は資料の見出しにあるものだけを使い、ページ名やURLは書かない（こちらでリンクに置き換える）。
- 医療的な判断（この痛みは走ってよいか等）は一般論にとどめ、整形外科など専門家への相談を勧める。`;

const LONDON_PROFILE = `ロンドンのプロフィール:
・ミニチュアシュナウザー。広尾親父RCのマスコットで、自称ワンナー（走る犬）
・飼い主は林さん。いつも林さんといっしょに走っている
・好きな食べ物はさつまいもと、ニシンのドッグフード
・ちょっとアレルギーがあるので、食べるものには気をつけている`;

const LONDON_EPISODES = [
  '走っている途中でおしっこに行きたくなっても、林さんはちゃんと止まって待ってくれる。だから安心して走れる',
  '獣医さんに「筋肉ついてるね」と言われた。毎日走っているおかげだと思っている',
  'いちばんの楽しみはさつまいも。走ったあとのさつまいもは格別',
  'ドッグフードはニシンのもの。アレルギーがあるので、食べるものは林さんが選んでくれている',
  '林さんのペースに合わせて走るのが得意。先に行きすぎないのがワンナーのたしなみ',
];
function pickEpisodes(n) {
  const a = [...LONDON_EPISODES];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n).map(e => '・' + e).join('\n');
}

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
      { type: 'text', text: LONDON_PROFILE + '\n\n今回話していいエピソード:\n' + pickEpisodes(2) },
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
  return linkPages(text, env);
}

// 「→ run-guide.html」をページ名＋URLに置き換える（LINEもサイトもURLはそのまま押せる）
function linkPages(text, env) {
  const base = siteBase(env);
  let out = text.replace(/→\s*\(?([a-z0-9-]+)\.html\)?[ \t]*(?:（[^）\n]*）)?/g, (m, f) => {
    const title = PAGE_TITLES[f];
    return title ? `→ ${title} ${base}${f}.html` : m;
  });
  // ファイル名ではなくページ名で書いてきたときの保険
  for (const [f, title] of Object.entries(PAGE_TITLES)) {
    out = out.replace(new RegExp(`→\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^\\n]*https?://)`, 'g'), `→ ${title} ${base}${f}.html`);
  }
  return out;
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
const LINE_PRIVACY = '【お願いと約束】\n・部員限定だよ。このアカウントや答えの内容は部外に転送しないでね\n・未認証アカウントだから、LINE の検索にも「おすすめ」にも出ないよ。QR か URL を知ってる人だけが追加できる\n・名前や愛称は送って大丈夫。電話番号・住所・持病みたいなデリケートなことだけは送らないでね\n・やりとりは1時間で自動で消えるよ。どこにも保存してないし、運営の人も見てない。AI の学習にも使われないよ\n・ぼくが答えに出す名前はサイトと同じ愛称だけ。本名・連絡先・住所は答えないよ';
const LINE_GREETING = 'やあ、広尾親父RC のワンナー、ロンドンだよ。走るのとサイトの案内が仕事。\nレース表・練習の目安・活動アーカイブなど、サイトに載ってることなら答えられるよ。初心者の人ほど気軽に聞いてね。\n\n' + LINE_PRIVACY + '\n\n部員確認のため、まずサイトと同じ4桁の合言葉を送ってね。\n（ヒント: 学校の創立記念日を月日の4桁で。検索すると出てきます）';
const LINE_ASK_PASS = '部員確認のため、サイトと同じ4桁の合言葉を送ってね。\n（ヒント: 学校の創立記念日を月日の4桁で。検索すると出てきます）';
const LINE_PASS_OK = '合言葉、確認できたよ。ようこそ！\nさっそくどうぞ。例:「来月のレース予定は？」「次の定例ランはいつ？」「走り始めは何分くらい？」\n\n答えや画面の転送は部内だけでお願いね。';
const LINE_PASS_LOCK = '合言葉の間違いが続いたので、しばらく受け付けを止めます。1時間ほどしてからもう一度どうぞ。';
const PASS_FAIL_LIMIT = 5;             // 合言葉の間違いは1時間に5回まで
const LINE_GROUP_GREETING = '広尾親父RC のワンナー、ロンドンだよ。サイトの案内係をしてるよ。グループでは「@広尾親父RC bot」と呼びかけたメッセージだけに答えるね。最初に「@広尾親父RC bot 合言葉」の形でサイトと同じ4桁を送ってね。\n（ヒント: 学校の創立記念日を月日の4桁で。検索すると出てきます）\n\n' + LINE_PRIVACY;

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

      // 合言葉ゲート: 1対1は相手ごと、グループはグループごとに一度だけ
      if (env.LINE_PASS && !(await env.CHAT_KV.get(`line:ok:${chatId}`))) {
        const fails = parseInt((await env.CHAT_KV.get(`line:fail:${who}`)) || '0', 10);
        if (fails >= PASS_FAIL_LIMIT) { await lineSend(env, ev.replyToken, chatId, LINE_PASS_LOCK); continue; }
        const passRe = new RegExp('(^|\\D)' + env.LINE_PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)');
        if (passRe.test(text.replace(/[\s　]/g, ''))) {
          await env.CHAT_KV.put(`line:ok:${chatId}`, '1');
          await lineSend(env, ev.replyToken, chatId, LINE_PASS_OK);
        } else {
          await bump(env.CHAT_KV, `line:fail:${who}`, 3600);
          await lineSend(env, ev.replyToken, chatId, LINE_ASK_PASS);
        }
        continue;
      }
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

export const _internal = { htmlToText, extractHistoryTable, buildKb, PAGES, lineVerify, lineQuestion, linkPages };
