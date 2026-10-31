/* 広尾親父RC bot（画面右下の小窓）
   中継サーバー（chatbot/worker.js）に質問を送り、答えを表示する。
   設定: WORKER_URL は Cloudflare にデプロイしたあとの URL。CLUB_TOKEN は中継側の合言葉と同じ値。 */
(function () {
  var WORKER_URL = 'https://hiroopapa-rc-bot.hiroopapa-rc.workers.dev';
  var CLUB_TOKEN = 'hiroopapa-2026';
  if (WORKER_URL.indexOf('REPLACE_ME') >= 0) return; // 未設定なら何も出さない

  var css = '\
#hrc-chat-btn{position:fixed;right:16px;bottom:16px;z-index:9000;border:1px solid rgba(201,162,39,.45);background:linear-gradient(135deg,#1b5e35,#0d3d20);color:#fff;border-radius:999px;padding:12px 18px;font:700 14px/1 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer;-webkit-tap-highlight-color:transparent}\
#hrc-chat-btn:active{opacity:.85}\
#hrc-chat{position:fixed;right:16px;bottom:16px;z-index:9001;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 32px);background:#fff;border-radius:18px;border:1px solid rgba(201,162,39,.35);border-top:3px solid rgba(201,162,39,.7);box-shadow:0 12px 40px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif}\
#hrc-chat.open{display:flex}\
#hrc-chat .hrc-hd{position:static;width:auto;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(135deg,#1b5e35,#0d3d20);color:#fff}\
#hrc-chat .hrc-hd b{font-size:14px;letter-spacing:.04em}\
#hrc-chat .hrc-hd small{display:block;font-size:10px;opacity:.75;margin-top:2px}\
#hrc-chat .hrc-hd button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;padding:0 4px}\
#hrc-chat .hrc-log{flex:1;overflow-y:auto;padding:12px;background:#f6f7f5;-webkit-overflow-scrolling:touch}\
#hrc-chat .hrc-m{max-width:88%;margin-bottom:10px;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}\
#hrc-chat .hrc-m.hrc-u{margin-left:auto;background:#1b5e35;color:#fff;border-bottom-right-radius:4px}\
#hrc-chat .hrc-m.hrc-a{background:#fff;color:#222;border:1px solid #e3e6e1;border-bottom-left-radius:4px}\
#hrc-chat .hrc-m.hrc-a.hrc-wait{color:#888}\
#hrc-chat .hrc-ft{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e6e1;background:#fff}\
#hrc-chat textarea{position:static;width:auto;flex:1;resize:none;border:1px solid #cfd6cf;border-radius:12px;padding:9px 11px;font:14px/1.4 inherit;height:42px;max-height:96px;outline:none}\
#hrc-chat textarea:focus{border-color:#1b5e35}\
#hrc-chat .hrc-send{position:static;width:auto;border:0;background:#1b5e35;color:#fff;border-radius:12px;padding:0 16px;font-weight:700;font-size:14px;cursor:pointer}\
#hrc-chat .hrc-send:disabled{background:#9aa89f}\
#hrc-chat .hrc-link{display:inline-block;margin-left:6px;padding:1px 9px;border-radius:999px;background:#1b5e35;color:#fff;font-size:12px;text-decoration:none;vertical-align:1px}\
#hrc-chat .hrc-note{font-size:10px;color:#999;text-align:center;padding:0 10px 8px;background:#fff}\
@media (max-width:480px){#hrc-chat{right:0;bottom:0;width:100vw;max-width:100vw;height:80vh;border-radius:18px 18px 0 0}}';

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var btn = document.createElement('button'); btn.id = 'hrc-chat-btn'; btn.type = 'button'; btn.textContent = '🏃 広尾親父RC bot';
  var box = document.createElement('div'); box.id = 'hrc-chat';
  box.innerHTML =
    '<div class="hrc-hd"><div><b>広尾親父RC bot</b><small>レース・練習・アーカイブのことを聞けます</small></div><button type="button" aria-label="閉じる">×</button></div>' +
    '<div class="hrc-log"></div>' +
    '<div class="hrc-ft"><textarea placeholder="例: 来月のレース予定は？" maxlength="400"></textarea><button class="hrc-send" type="button">送る</button></div>' +
    '<div class="hrc-note">AIがサイトの内容をもとに答えます。間違うことがあります。</div>';
  document.body.appendChild(btn); document.body.appendChild(box);

  var log = box.querySelector('.hrc-log'), ta = box.querySelector('textarea'), send = box.querySelector('.hrc-send');
  var history = [], busy = false;

  // URL だけをリンクにして表示する（HTMLは解釈しない）
  function render(el, text) {
    el.textContent = '';
    var parts = String(text).split(/(https?:\/\/[^\s]+)/g);
    for (var i = 0; i < parts.length; i++) {
      if (/^https?:\/\//.test(parts[i])) { var a = document.createElement('a'); a.href = parts[i]; a.textContent = '開く'; a.target = '_blank'; a.rel = 'noopener'; a.className = 'hrc-link'; el.appendChild(a); }
      else el.appendChild(document.createTextNode(parts[i]));
    }
  }
  function add(role, text, cls) {
    var d = document.createElement('div'); d.className = 'hrc-m hrc-' + role + (cls ? ' hrc-' + cls : ''); render(d, text);
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  add('a', 'こんにちは。サイトに載っていること（レース表・練習の目安・活動アーカイブなど）なら答えられます。\n\n部員限定です。答えの転送は部内だけでお願いします。名前はサイトと同じ愛称だけで、本名・連絡先は答えません。質問の内容は運営者以外は見ません。');

  function open() { box.classList.add('open'); btn.style.display = 'none'; setTimeout(function () { ta.focus(); }, 50); }
  function close() { box.classList.remove('open'); btn.style.display = ''; }
  btn.onclick = open; box.querySelector('.hrc-hd button').onclick = close;

  function ask() {
    var q = ta.value.trim(); if (!q || busy) return;
    ta.value = ''; busy = true; send.disabled = true;
    add('u', q); history.push({ role: 'user', content: q });
    var wait = add('a', '考え中…', 'wait');
    fetch(WORKER_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Club-Token': CLUB_TOKEN },
      body: JSON.stringify({ messages: history.slice(-6) })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var reply = ((res.j && res.j.reply) || 'うまく答えられませんでした。').replace(/\*\*/g, '');
        render(wait, reply); wait.classList.remove('hrc-wait');
        if (res.ok) history.push({ role: 'assistant', content: reply }); else history.pop();
      })
      .catch(function () { wait.textContent = '通信できませんでした。電波の良いところで試してください。'; wait.classList.remove('hrc-wait'); history.pop(); })
      .then(function () { busy = false; send.disabled = false; });
  }
  send.onclick = ask;
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); } });

  // パスワード画面が出ている間は隠す（ページ側の合言葉ゲートを尊重する）
  var gate = document.getElementById('auth-overlay');
  if (gate) {
    var sync = function () { var hidden = gate.style.display === 'none'; btn.style.display = hidden && !box.classList.contains('open') ? '' : 'none'; if (!hidden) box.classList.remove('open'); };
    sync(); new MutationObserver(sync).observe(gate, { attributes: true, attributeFilter: ['style'] });
  }
})();
