#!/usr/bin/env python3
"""虎の巻ページを hg.css の部品に移す変換。

使い方: python3 design/migrate_guide.py run-guide.html [...]
  - 古いクラス名を hg- の部品に置き換える（下の MAP が対応表）
  - ページ内の <style> を外し、hg.css を読み込む
  - 英字ラベルを、目次（step-nav）の日本語に置き換える
  - 節の地の色を「紙→交互→紙…」に並べ直す。暗い緑は締めだけ
  - 対応表にないクラスが残ったら一覧で知らせる
"""
import re, sys, os

MAP = {
    # 枠
    'hd': 'hg-header', 'hd-logo': 'hg-header__logo', 'hd-btn': 'hg-btn',
    'hero': 'hg-hero', 'hc': '', 'badge': 'hg-badge', 'hero-title': 'hg-hero__title',
    'hero-sub': 'hg-hero__sub', 'hero-badges': 'hg-chips', 'hb': 'hg-chip',
    'disclaimer': 'hg-note', 'step-nav': 'hg-pills', 'sn': 'hg-pill',
    'sec': 'hg-section', 'sec-bg-off': '', 'sec-bg-dark': '', 'sec-bg-night': '',
    'sec-bg-navy': '', 'sec-bg-deep': '', 'si': 'hg-wrap',
    'lbl': 'hg-label', 'lbl-w': 'hg-label', 'lbl-blue': 'hg-label', 'lbl-org': 'hg-label',
    'ttl': 'hg-title', 'ttl-w': '', 'ttl-sub': 'hg-subtitle',
    'body-text': 'hg-text', 'body-text-w': 'hg-text',
    'cta-sec': 'hg-section hg-section--dark hg-center', 'cta-title': 'hg-title',
    'cta-sub': 'hg-text', 'cta-btn': 'hg-btn', 'ft-copy': '', 'ft-logo': '',
    'tip-link': '',
    # カード（項目）
    'info-cards': '', 'ic': 'hg-card hg-card--row', 'ic-icon': 'hg-card__icon',
    'ic-ttl': 'hg-card__title', 'ic-desc': 'hg-card__text',
    'gear-list': '', 'gear-item': 'hg-card hg-card--row', 'gear-icon': 'hg-card__icon',
    'gear-name': 'hg-card__title', 'gear-desc': 'hg-card__text',
    'camp-card': 'hg-card', 'camp-ttl': 'hg-card__title', 'camp-desc': 'hg-card__text',
    'drill-grid': '', 'dg': 'hg-card', 'dg-num': 'hg-card__meta', 'dg-ttl': 'hg-card__title',
    'dg-desc': 'hg-card__text',
    'practice-grid': 'hg-grid', 'pg': 'hg-card', 'pg-day': 'hg-card__meta',
    'pg-act': 'hg-card__title', 'pg-detail': 'hg-card__text',
    'race-list': '', 'rl': 'hg-card hg-card--row', 'rl-date': 'hg-date',
    'rl-month': 'hg-date__month', 'rl-day': 'hg-date__day', 'rl-info': '',
    'rl-name': 'hg-card__title', 'rl-meta': 'hg-card__text',
    'sport-cards': '', 'sc': 'hg-card', 'sc-swim': 'hg-card--swim', 'sc-bike': 'hg-card--bike',
    'sc-run': 'hg-card--run', 'sc-head': 'hg-card__head', 'sc-icon': 'hg-card__icon',
    'sc-ttl-area': '', 'sc-num': 'hg-card__meta', 'sc-ttl': 'hg-card__title',
    'sc-dist': 'hg-card__meta', 'sc-body': '', 'sc-tips': 'hg-bullets', 'sc-note': 'hg-note',
    'rules': 'hg-card', 'rules-ttl': 'hg-card__title',
    # タグ
    'ic-tag': 'hg-tag', 'gear-tag': 'hg-tag', 'camp-tag': 'hg-tag', 'rl-tag': 'hg-tag',
    'tag-key': 'hg-tag--key', 'tag-must': 'hg-tag--key', 'tag-warn': 'hg-tag--warn',
    'tag-tip': '', 'tag-nice': '', 'tag-ok': '', 'tag-beginner': '', 'tag-mid': '', 'tag-soon': '',
    # ひとこと・注意書き
    'tip-list': '', 'tip': 'hg-tip', 'tip-icon': 'hg-tip__icon', 'tip-ttl': 'hg-tip__title',
    'tip-desc': 'hg-tip__text',
    'note': 'hg-note', 'note-ttl': 'hg-note__title', 'note-desc': 'hg-note__text',
    'callout': 'hg-note', 'callout-ttl': 'hg-note__title', 'callout-desc': 'hg-note__text',
    'alert-light': 'hg-note hg-note--warn', 'a-ttl': 'hg-note__title', 'a-desc': 'hg-note__text',
    'pool-spec': 'hg-spec',
    # 段取り（順番に意味があるもの）
    'ladder': 'hg-steps', 'rung': 'hg-step', 'rung-num': 'hg-step__num',
    'rung-ttl': 'hg-step__title', 'rung-desc': 'hg-step__text',
    'race-steps': 'hg-steps hg-steps--labeled', 'rs': 'hg-step', 'rs-num': 'hg-step__num', 'rs-emoji': '',
    'rs-cont': '', 'rs-ttl': 'hg-step__title', 'rs-desc': 'hg-step__text', 'rs-tip': 'hg-step__tip',
    'rule-list': 'hg-steps', 'rl-item': 'hg-step', 'rl-ttl': 'hg-step__title',
    'rl-num': 'hg-step__num', 'rl-desc': 'hg-step__text',
    # 声・質問
    'voice-list': '', 'vc': 'hg-quote', 'vc-text': 'hg-quote__text', 'vc-name': 'hg-quote__who',
    'faq-list': '', 'fq': 'hg-faq', 'fq-q': 'hg-faq__q', 'fq-a': 'hg-faq__a',
}

INLINE = [  # インラインの見た目指定 → 部品
    (r'style="margin-top:\d+px;padding:[^"]*border[^"]*"', 'class="hg-note"'),
    (r'style="font-size:12px;font-weight:700;[^"]*"', 'class="hg-note__title"'),
    (r'style="font-size:12\.5px;[^"]*"', 'class="hg-note__text"'),
    (r'style="font-size:28px;margin-bottom:12px"', 'class="hg-emoji"'),
]

HEAD_LINKS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
              '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
              '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Shippori+Mincho:wght@600;700;800&display=swap" rel="stylesheet">\n'
              '<link rel="stylesheet" href="./hg.css">\n')

def convert(src):
    head, body = src.split('<body', 1)
    # --- head：ページ内スタイルとフォント読み込みを外して、共通の読み込みに差し替え
    head = re.sub(r'<style[^>]*>.*?</style>\s*', '', head, flags=re.S)
    head = re.sub(r'<link[^>]*fonts\.(googleapis|gstatic)[^>]*>\s*', '', head)
    head = head.replace('</head>', HEAD_LINKS + '</head>')

    # --- body：装飾の SVG（扉の波・山・背景、ヘッダーのロゴ）を外す
    body = re.sub(r'(<a[^>]*class="hd-logo"[^>]*>)\s*<svg.*?</svg>', r'\1', body, flags=re.S)
    body = re.sub(r'(<section class="hero"[^>]*>)\s*(<div class="hero-bg-svg"[^>]*>)?\s*<svg.*?</svg>\s*(</div>)?', r'\1', body, flags=re.S)
    body = re.sub(r'<svg[^>]*class="hero-(wave|ridge|bg-svg)".*?</svg>', '', body, flags=re.S)

    # --- インラインの見た目
    for pat, rep in INLINE:
        body = re.sub(pat, rep, body)
    body = re.sub(r'\s*style="[^"]*"', lambda m: '' if '<svg' not in m.group(0) else m.group(0), body)
    body = re.sub(r'(<div) class="hg-note"([^>]*) class="', r'\1\2 class="hg-note ', body)

    # --- 英字ラベルの「METHOD 01 — 」などの飾りを外す
    body = re.sub(r'(<div class="dg-num">)\s*METHOD\s*\d+\s*—\s*', r'\1', body)

    # --- 英字ラベル → 目次の日本語
    nav = dict(re.findall(r'<a href="#([^"]+)" class="sn">([^<]+)</a>', body))
    unlabeled = []
    def relabel(m):
        sec_open, inner = m.group(1), m.group(2)
        sid = re.search(r'id="([^"]+)"', sec_open)
        def fix(lm):
            txt = re.sub(r'<[^>]+>', '', lm.group(2)).strip()
            if sid and sid.group(1) in nav:
                return f'{lm.group(1)}{nav[sid.group(1)]}</div>'
            if re.search(r'[A-Za-z]{3,}', txt) and not re.search(r'[ぁ-んァ-ン一-龥]', txt):
                unlabeled.append(txt)
            return lm.group(0)
        inner = re.sub(r'(<div class="lbl[^"]*">)(.*?)</div>', fix, inner, count=1, flags=re.S)
        return sec_open + inner
    body = re.sub(r'(<section class="sec[^"]*"[^>]*>)(.*?)(?=<section|<footer)', relabel, body, flags=re.S)

    # --- 節の地の色：紙→交互→紙…（締めの cta は暗い緑のまま）
    n = [0]
    def bg(m):
        cls = m.group(1)
        n[0] += 1
        return f'<section class="hg-section{" hg-section--alt" if n[0] % 2 == 0 else ""}"'
    body = re.sub(r'<section class="(sec(?: sec-bg-\w+)?)"', bg, body)

    # --- 番号つきの決まり：番号を題の外に出す
    body = re.sub(r'(<div class="rl-ttl">)\s*<span class="rl-num">([^<]+)</span>', r'<span class="rl-num">\2</span>\1', body)

    # --- クラス名の置き換え
    left = set()
    def mapcls(m):
        out = []
        for c in m.group(1).split():
            if c in MAP:
                out += MAP[c].split()
            elif c.startswith('hg'):
                out.append(c)
            else:
                left.add(c); out.append(c)
        out = list(dict.fromkeys(out))
        return f' class="{" ".join(out)}"' if out else ''
    body = re.sub(r' class="([^"]*)"', mapcls, body)
    body = body.replace('<footer>', '<footer class="hg-footer">')
    body = '<body class="hg"' + body  # body は「<body」の直後から始まる

    # --- 目次の「今いる場所」：スクリプトの名前を合わせる
    body = body.replace("querySelectorAll('.sn')", "querySelectorAll('.hg-pill')")
    body = body.replace("classList.toggle('active'", "classList.toggle('is-active'")
    return head + body, left, unlabeled

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for f in sys.argv[1:]:
        p = os.path.join(root, f)
        out, left, unlabeled = convert(open(p, encoding='utf-8').read())
        open(p, 'w', encoding='utf-8').write(out)
        print(f'{f}: 残ったクラス={sorted(left) or "なし"} 英字ラベル={unlabeled or "なし"}')

if __name__ == '__main__':
    main()
