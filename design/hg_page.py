"""ページの雛形。新しいページも移行もこれで組む（頭・合言葉の扉・ボット・フッターを毎回同じにする）。

    from hg_page import page, header
    html = page('ページ名 | 広尾親父RC', body_html, css='', auth=True, scripts='')
"""
import re

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Shippori+Mincho:wght@600;700;800&display=swap" rel="stylesheet">\n'
         '<link rel="stylesheet" href="./hg.css">\n')


def page(title, body, css='', auth=True, scripts='', bot=True):
    """css はこのページだけの並べ方（色・書体・大きさは書かない）。scripts はページ固有の <script>。"""
    style = f'<style>\n/* このページだけの並べ方（色・書体・大きさは hg.css） */\n{css.strip()}\n</style>\n' if css.strip() else ''
    gate = '<script src="./hg-auth.js"></script>\n' if auth else ''
    bot_tag = '<script src="chat.js" defer></script>\n' if bot else ''
    return (f'<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n'
            f'<meta name="robots" content="noindex, nofollow">\n'
            f'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            f'<title>{title}</title>\n{FONTS}{style}</head>\n<body class="hg">\n{gate}'
            f'{body.strip()}\n{scripts.strip()}\n{bot_tag}</body>\n</html>\n')


def header(back_href='./index.html', back_label='トップへ', logo='広尾親父RC'):
    return (f'<header class="hg-header">\n  <a class="hg-header__logo" href="./index.html">{logo}</a>\n'
            f'  <a class="hg-btn" href="{back_href}">{back_label}</a>\n</header>\n')


def strip_gate(html):
    """古い合言葉の扉（#auth-overlay と、そのスクリプトの即時関数）を取り除く。"""
    html = re.sub(r'<div id="auth-overlay".*?\n</div>\n', '', html, flags=re.S)
    html = re.sub(r"\(function\(\)\{\s*var PASS='\d+', KEY='hg-rc-auth';.*?\}\)\(\);\s*", '', html, flags=re.S)
    return html


def page_scripts(html):
    """ページ固有のスクリプト（chat.js と空の script を除く）を取り出す。"""
    out = []
    for m in re.finditer(r'<script>(.*?)</script>', html, flags=re.S):
        code = m.group(1).strip()
        if code:
            out.append(f'<script>\n{code}\n</script>')
    return '\n'.join(out)
