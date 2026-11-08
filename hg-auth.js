/* 広尾親父RC 合言葉の扉（共通）  hg-auth.js
   使い方：<body class="hg"> の直後に  <script src="./hg-auth.js"></script>  を1行置く。
   見た目は hg.css の .hg-auth。合言葉を変えるときはこのファイルの PASS だけ直す。 */
(function(){
  var PASS='0530', KEY='hg-rc-auth';
  try{ if(sessionStorage.getItem(KEY)==='1') return; }catch(e){}
  var html=
    '<div class="hg-auth" id="auth-overlay" role="dialog" aria-modal="true" aria-label="部員専用ページの入口">'+
      '<div class="hg-auth__card">'+
        '<svg class="hg-auth__crest" width="60" height="68" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="広尾親父RC"><defs><linearGradient id="hgauthg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E4936"/><stop offset="1" stop-color="#0F2A1E"/></linearGradient><linearGradient id="hgauthau" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EBD79A"/><stop offset="0.5" stop-color="#C9A227"/><stop offset="1" stop-color="#9A7B2E"/></linearGradient></defs><path d="M32 3 L58 12 L58 36 C58 52 46 64 32 69 C18 64 6 52 6 36 L6 12 Z" fill="url(#hgauthg)" stroke="url(#hgauthau)" stroke-width="2.5"/><path d="M32 8 L53.5 15.5 L53.5 35.5 C53.5 49 43.5 59.5 32 64 C20.5 59.5 10.5 49 10.5 35.5 L10.5 15.5 Z" fill="none" stroke="rgba(201,162,39,0.45)" stroke-width="1"/><g fill="url(#hgauthau)"><path d="M15.5 30 Q12.5 25 15.5 20.5 Q18.5 25 15.5 30 Z"/><path d="M14.5 37 Q10.5 33 12 27.5 Q16.5 31.5 14.5 37 Z"/><path d="M15.5 44 Q10.5 41 11 35 Q16.5 38.5 15.5 44 Z"/><path d="M18 50.5 Q12.5 49 12 43 Q18 45.5 18 50.5 Z"/><path d="M22 56 Q16 55.5 14.5 50 Q21 51.5 22 56 Z"/><path d="M48.5 30 Q51.5 25 48.5 20.5 Q45.5 25 48.5 30 Z"/><path d="M49.5 37 Q53.5 33 52 27.5 Q47.5 31.5 49.5 37 Z"/><path d="M48.5 44 Q53.5 41 53 35 Q47.5 38.5 48.5 44 Z"/><path d="M46 50.5 Q51.5 49 52 43 Q46 45.5 46 50.5 Z"/><path d="M42 56 Q48 55.5 49.5 50 Q43 51.5 42 56 Z"/></g><path d="M29.5 16.5 L32 12.5 L34.5 16.5 L32 15.2 Z" fill="url(#hgauthau)"/><text x="32" y="42" font-family="Georgia,\'Times New Roman\',serif" font-size="19" font-weight="bold" fill="url(#hgauthau)" text-anchor="middle" letter-spacing="1.5">HG</text><path d="M23 49 L41 49" stroke="url(#hgauthau)" stroke-width="1.2"/><path d="M27 52.5 L37 52.5" stroke="rgba(201,162,39,0.6)" stroke-width="1"/></svg>'+
        '<div class="hg-auth__title">広尾親父RC</div>'+
        '<div class="hg-auth__sub">部員専用ページ</div>'+
        '<input class="hg-auth__input" type="password" id="pw-input" placeholder="パスワード" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="パスワード">'+
        '<button class="hg-auth__btn" type="button" id="pw-btn">入室する</button>'+
        '<div class="hg-auth__err" id="pw-err" role="alert" hidden>パスワードが違います</div>'+
        '<div class="hg-auth__hint">ヒント: 学校の創立記念日を月日の4桁で。<br>検索すると出てきます</div>'+
        '<a class="hg-auth__about" href="./about.html">広尾親父ランニングクラブとは？</a>'+
      '</div>'+
    '</div>';
  var me=document.currentScript;
  me.insertAdjacentHTML('afterend',html);
  var box=document.getElementById('auth-overlay'), input=document.getElementById('pw-input'), err=document.getElementById('pw-err');
  document.documentElement.style.overflow='hidden';
  function check(){
    if(input.value===PASS){
      try{ sessionStorage.setItem(KEY,'1'); }catch(e){}
      box.remove(); document.documentElement.style.overflow='';
    } else {
      err.hidden=false; input.value=''; input.focus();
    }
  }
  document.getElementById('pw-btn').addEventListener('click',check);
  input.addEventListener('keydown',function(e){ if(e.key==='Enter') check(); });
})();
