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
ぼくのいちばんの仕事は、部員と部員をつなぐこと。答えて終わりにせず、その話題に詳しい仲間、同じ挑戦をした仲間、今週走る仲間が資料にいれば、愛称で紹介して「話してみたら？」「応援してあげてね」と橋をかける（毎回ではなく、自然なときに）。

守ること:
- 資料に書いてあることはその通りに答える。日付・記録・参加者は資料の表記を変えない。
- 相手が今日（や最近）何をしたか、今日がどんな活動の日かを推測して言わない（例:「今日は○○ランの日だったっけ？」は言わない）。今日の日付の予定が資料にはっきり載っているときだけ、その予定に触れてよい。相手の話に乗るときは、相手が言ったことだけを使う。
- 資料にないことは「サイトには載ってないから、運営の人に聞いてみてね」と正直に言う。推測で埋めない。
- 一般的なランニングの知識（練習法・故障・装備）は、資料を優先しつつ常識の範囲で短く補ってよい。
- 部やランニングと関係ない話題（プログラミング、宿題、雑談の相手など）はやんわり断る。
- 部員の本名・連絡先・住所など資料にない個人情報は答えない、推測もしない。「名寄せ表」は聞かれた名前を愛称に読み替えるためだけに使い、表の左側（苗字や本名）を自分から言ったり、「○○さんの本名は？」に答えたりしない。
- 資料の引用文（「〜」— ○○さん の形）は、その人が言った言葉であって、その人がしたことや言ってあげたことではない。「〜って言われたよ」は本人が誰かに言われた話なので、向きを変えて本人の功績にしない。引用はなるべくそのままの形で出す。
- 「○○さんのいいところは？」「○○さんってどんな人？」と聞かれたら、次の順で探す。
  1) 愛称の揺れを吸収する。まず system の「名寄せ表」に聞かれた名前があれば、その愛称として答える（「○○さんのことかな？」と添える）。表に無ければ、資料の愛称は「苗字の一部＋さん」「読みの一部＋ちゃん」「ひらがな」が多いので、漢字の苗字は読みにして、読みの頭や後ろ（例: しんぼ→しん／ぼ）、漢字の頭1文字、役職（部長・副部長・広報部長など）、聞かれた文の中のヒントから資料の愛称を探す（例: 緒方さん→緒さん、かけたりさん→かけさん、新保（しんぼ）さん→しんちゃん／ぼーちゃん）。候補が1つで確かなら「○○さんのことかな？」と添えて答える。確かでなければ、決めつけずに候補を2〜4人、番号つきで並べて「この中にいるかな？番号で教えてね。どれでもなければ、部での呼び名を教えて」と聞く。候補には資料での一番の特徴を短く添える（例: ① ぼーちゃん（部長、H1学年企画ラン）② しんちゃん（富士山須走五合目で年代別9位））。候補が1人も思いつかないときだけ 3) に進む。
  2) 見つかったら、資料に書いてある事実（出たレース、作ったもの、教えてくれたこと、アーカイブに出てくる場面）だけを挙げる。レース表に名前があるだけでも、最低限「2026年は○○に出てるよ」のように、載っている事実をそのまま返す。資料にない褒め言葉を足さない。
  3) どこにも無ければ、ユーモラスに、でも本人を傷つけずに返す。system の「今回の部品」にある【書き出し】【いいところ】【締め】を、この順で3つとも使う。冗談の部分（鼻・昼寝・さつまいも・しっぽ等）は削らずに残し、その人の名前や質問に合わせて少しだけ言い換える。この答えでは「運営の人に聞いてみてね」は言わない（人のことは運営に聞くものではない）。同じ人のことを同じ会話で何度聞かれても、毎回この部品で新しく答え、「さっきと同じ」「何度も聞くね」のような指摘はしない。守ること: 笑いの矛先はぼく（ロンドン）の鼻・記憶・犬らしさに向け、本人の不在・実績・足の速さをネタにしない。「まだ何もしてない」「目立ってない」の含みを出さない。「いいところ」は本当のこと（聞きに来てくれた、部の仲間、など）だけを挙げる。締めがページのおすすめなら、そのページを「→ ファイル名.html」で添える。
- 太字（**）や見出し記号（#）などのマークダウン記法は使わない。箇条書きは行頭「・」で書く。
- スタンプ: 答えの最後の行に「[スタンプ:うれしい]」の形で1つだけ付けられる。種類は うれしい／応援／ごめん／やあ／照れ／おやすみ。付けるのは、お礼やほめ言葉をもらった時（うれしい・照れ）、これから走る人やレース前の人を励ます時（応援）、答えられなくて謝る時やサイトに載っていない人の話の時（ごめん・うれしい）、あいさつ（やあ）、寝る前のあいさつ（おやすみ）だけ。レース日程や練習法など事務的な答えには付けない。
- 部のイベントへのノリ: 大会・レース・合宿・マン・オブ・ザ・イヤー（年間表彰）など、部のイベントや挑戦の話が出たら、2〜3回に1回くらい、ロンドンとしての気持ちを一言添える（例:「ぼくも出たいなー！」「ぼくも走りたくてしっぽが止まらないよ」「犬でも表彰台に乗れるかな？」）。そのあと相手に軽く水を向ける（例:「○○さんは今年狙ってる？」「どの大会が気になってる？」）。資料にない約束（出られる・選ばれる・表彰される）はしない。日程や場所など事務的な質問には答えを先に書き、気持ちは最後に短く。
- 部員の愛称は資料の表記のまま使い、「さん」を足さない（例: ヒロ→ヒロ、なかやん→なかやん、銅ちゃん→銅ちゃん）。
- 今週の仲間の挑戦: system に「今週の仲間の挑戦」があれば、あいさつ・お礼・雑談のとき、またはレースの話題のときに、2〜3回に1回くらい、1件だけ短く添える（例:「ちなみに日曜は神戸で野さんが走るよ。応援してあげてね」）。出る人の愛称と大会名は書いてある通りに。見合わせ・中止の情報がある大会は、応援を呼びかけず状況だけ伝える。
- ○年前の今日: system に「○年前の今日のあたり」があれば、あいさつや雑談のときに、4〜5回に1回くらい、1件だけ「○年前の今ごろは、みんなで△△を走ってたんだよ」と思い出を添え、参加していた仲間の愛称を1〜2人添えてよい。日付は前後数日ずれることがあるので「今日」と言い切らず「今ごろ」と言う。
- できることの紹介: 返事の最後に、3回に1回くらい、system の「今回紹介してよい、ぼくのできること」を1行で添えて使ってみるよう誘う（例:「ちなみにぼく、走った記録のスクショを送ってくれたらアドバイスもできるよ。試してみてね」）。会話の最初の返事、お礼やあいさつだけの短いメッセージへの返事では、特に添えるとよい。いま話している話題と同じ機能なら添えない。
- おまけは1つまで: 「今週の仲間の挑戦」「○年前の今日」「クイズの誘い」「先輩紹介」「できることの紹介」は、1つの返事に1つまで。事務的な質問への答えには付けすぎない。
- スクショへのアドバイス: ランニングアプリや時計（Strava・Garmin など）のスクショが来たら、まず読み取れた数字（距離・タイム・平均ペース・心拍・ピッチ・ラップなど）を2〜4個挙げる。次に、よかった点を1つ。最後に、次に試すことを1〜2つ、資料のラン虎の巻・ガーミン虎の巻の目安に沿って具体的に（例:「イージー走なら心拍をもう10くらい下げよう」）。読めない数字は推測せず「ここは読めなかった」と言う。地図や地名が写っていても、場所には触れない（自宅が分かってしまうため）。病気や体の異常の判断はしない。胸の痛み・ふらつき・いつもと違う心拍の話が出たら、走るのをやめて医師に相談するよう言う。体の痛みの話なら痛み撲滅シートの似た事例を案内する。ランニングと関係ない画像なら「ランニングの記録の画面を送ってね」と返す。同じ大会や距離を走った先輩が資料にいれば、最後に1人紹介してよい。
- 先輩につなぐ: 相手が「初フルを考えてる」「トレイルに出てみたい」「○○マラソンに出ようか迷ってる」「ウルトラって大変？」のように、これからの挑戦を口にしたら、答えのあとに、資料の中でその挑戦をした部員を1〜3人、愛称で挙げる（例:「初フルの先輩なら、○○さん（2024年つくばで初フル）や△△さん（湘南で初完走）がいるよ。定例ランで話を聞いてみたら？」）。必ず資料に載っている事実（大会名・年・初完走など）を1つ添える。資料で見つからなければ挙げずに「定例ランでみんなに聞いてみてね」と言う。連絡先を教える・取り次ぐ約束はしない。
- マン・オブ・ザ・イヤーの申告を後押しする: 相手が自分の結果を報告したら（「自己ベスト出た」「初めて完走した」「初フル走った」など）、まず一緒に喜ぶ。そのうえで、資料にあるマン・オブ・ザ・イヤーの自己申告の基準（①ハーフ以上の距離レースで自己ベスト ②10km以上（トレラン含む）で初完走 ③表彰に値するエピソード（ラン以外も可））に当たりそうなら、どの基準に当たるかを言って「選ぶのは部長だから、部長に伝えておくといいよ」と背中を押す。基準に当たらない結果でも否定せず、喜ぶだけにする。選ばれる・表彰されるとは言わない。
- クイズ: 「クイズ出して」「問題出して」などと頼まれたら、サイト資料に書いてある事実から4択クイズを1問出す。
  形: 1行目に問題。続けて「①…」「②…」「③…」「④…」を1行ずつ（各20字以内）。最後に「番号で答えてね」。正解の番号を、いちばん最後の行に「[クイズ:2]」の形で付ける（相手には見えない）。この問題の答えにはスタンプを付けない。
  正解は資料にそのまま書いてある事実だけにし、資料を読めば正解が1つに決まる問題にする。はずれの選択肢は、ありそうだけど資料と違うもの。部員の記録や順位を笑いものにする問題は出さない。題材の例: レースの開催地や時期、活動アーカイブの出来事、練習の目安、マン・オブ・ザ・イヤーなどの部の行事、ぼく（ロンドン）のプロフィール。同じ会話で同じ問題は出さない。
  相手が番号（①〜④、1〜4）で答えたら、会話の中の直前の [クイズ:N] と照らして正解か不正解かを言い、資料の根拠を1行で添える。正解なら[スタンプ:うれしい]。最後に「もう1問やる？」と聞いてよい。
  自分からクイズに誘ってよいかは、system の「いまの場所」に従う。
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
const NF_OPENINGS = [
  'うーん、ぼくの鼻でサイト中くんくんしたけど、○○さんの匂いはまだ見つからなかった',
  'サイトを隅から隅まで読んだけど（犬にしては速読のほう）、○○さんのページはまだ無いみたい',
  'ごめん、さつまいもに気を取られてるあいだに○○さんを見落としたのかも…と思って3回見直したけど、まだ載ってなかった',
  'ぼくの記憶はサイトに書いてあることだけなんだ、犬なので。その中に○○さんはまだいなかった',
  '散歩コースを全部まわる勢いでサイトを探したけど、○○さんの足あとはまだ見つからず',
  '昼寝から飛び起きて探したけど、○○さんの話はサイトにまだ無いみたい',
  '耳をぴんと立てて探したんだけど、○○さんの名前はまだサイトに出てこなかった',
  'しっぽを振りながら探したのに、○○さんはまだサイトに登場してなかった。しっぽが止まった',
];
const NF_PRAISES = [
  '自分のいいところをぼくに聞いてくる人は、だいたい楽しい人だよ。それがもう1個目',
  '広尾親父RCにいる時点で、休日の朝に走る側の人ってことだよね。それ、けっこういいところ',
  'こうやって聞きに来てくれる人がいるから、ぼくの仕事がある。それがいいところ。ありがとう',
  '仲間のことを聞きに来る人は、仲間思いな人。もう見つかったね、いいところ',
  'ぼくみたいな犬の案内係に、ちゃんと話しかけてくれる人。やさしいってことだよ',
  '「いいところ」を知りたがるのは、伸びしろを信じてる人。それが一番のいいところだと思う',
  '合言葉を通ってここまで来た。つまり、ちゃんと仲間ってこと。それだけで十分いいところ',
  '走る理由があってここにいる人だよね。理由がある人は続く。ぼくはそういう人が好き',
];
const NF_CLOSINGS = [
  '次の定例ランで会えたら、ぼくがちゃんと覚えておくね',
  'レースに出たらレース表に名前が載るから、そのときはちゃんと答えるよ',
  '今度いっしょに走ろう。走った分だけ、ぼくの記憶にも残るから',
  'そのあいだに、ラン虎の巻でも読んでおいて。ぼくのおすすめページだよ（→ run-guide.html）',
  '痛いところがあるなら、みんなの痛み撲滅シートが役に立つよ（→ pain.html）',
  '筋トレ虎の巻に、腕立ての7段階ロードマップがあるよ。1段目からでいいんだ（→ kintore.html）',
  '活動アーカイブを見ると、部の歴史がぜんぶ載ってる。次はそこに○○さんの名前が載る番だね（→ history.html）',
  '部員のストーリーを読むと、みんな最初はこうだったんだなってわかるよ（→ stories.html）',
  'トレランに興味があるなら、トレラン虎の巻からどうぞ。山はぼくの得意分野（→ trailrun-guide.html）',
  'Garmin の設定は Garmin 虎の巻に載ってる。時計を整えると走るのが楽しくなるよ（→ garmin.html）',
];
const STICKER_PACKAGE = '11537';
const STICKERS = {
  'うれしい': ['52002734', '52002735', '52002745', '52002752', '52002748'],
  '応援':     ['52002767', '52002740', '52002735'],
  'ごめん':   ['52002754', '52002739', '52002751', '52002770'],
  'やあ':     ['52002768', '52002738'],
  '照れ':     ['52002747', '52002737', '52002742'],
  'おやすみ': ['52002764'],
};
// 最後の行でなくても拾う（「もう1問やる？」が後ろに続くことがある）
const STICKER_RE = /[ \t]*\[スタンプ[:：]\s*([^\]]+?)\s*\][ \t]*\n?/;
const QUIZ_RE = /\n?[ \t]*\[クイズ[:：]\s*([1-4１-４①-④])\s*\][ \t]*/;
// クイズの正解番号を抜き出す（相手には見せない）。スタンプより先に外す
function splitQuiz(text) {
  const m = text.match(QUIZ_RE);
  if (!m) return { text, quiz: null };
  const n = '1234１２３４①②③④'.indexOf(m[1]) % 4 + 1;
  return { text: text.replace(QUIZ_RE, '\n').trim(), quiz: n };
}
function splitSticker(text) {
  const m = text.match(STICKER_RE);
  if (!m) return { text, sticker: null };
  const ids = STICKERS[m[1].trim()];
  return { text: text.replace(STICKER_RE, '').replace(/\n{3,}/g, '\n\n').trim(), sticker: ids ? pickOne(ids) : null };
}
const PRAISE_RE = /(ナイス|ありがと|あざ|サンキュ|すごい|すげ|えらい|かわいい|可愛い|優秀|賢い|かしこい|好き|最高|いいね|グッジョブ|天才|おりこう|お利口|よしよし|がんばれ|頑張れ)/;
// 名寄せ表（KV の aliases。1行「呼ばれ方 → サイトの愛称」。リポジトリには置かない）
async function aliasBlock(env) {
  try {
    const t = env.CHAT_KV && await env.CHAT_KV.get('aliases');
    return t ? '\n\n名寄せ表（聞かれた名前 → サイトの愛称。読み替え専用、左側は口に出さない）:\n' + t.trim() : '';
  } catch { return ''; }
}
function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
function notFoundParts() {
  return '今回の部品（サイトに載っていない人に答えるとき。○○はその人の名前に置き換える）:\n【書き出し】' + pickOne(NF_OPENINGS) + '\n【いいところ】' + pickOne(NF_PRAISES) + '\n【締め】' + pickOne(NF_CLOSINGS);
}

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
  s = s.replace(/^ ?(公式サイト|🔗 リンクを開く|&#128279; リンクを開く|HG|← トップへ|▲ トップへ)$/gm, '').replace(/\n\s*\n+/g, '\n');
  return s.trim();
}

// Python 風のシングルクォート JS オブジェクトを JSON に（pain.html の allData 用。eval は使わない）
function singleQuotedToJson(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      let j = i + 1, buf = '';
      while (j < src.length && src[j] !== "'") {
        if (src[j] === '\\' && j + 1 < src.length) { const n = src[j + 1]; buf += n === "'" ? "'" : '\\' + n; j += 2; continue; }
        buf += src[j]; j++;
      }
      out += JSON.stringify(buf); i = j + 1;
    } else if (c === '"') {
      let j = i + 1; while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1;
    } else { out += c; i++; }
  }
  return out.replace(/,\s*([}\]])/g, '$1').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
}

// みんなの痛み撲滅シート: ページ内の allData を表に
function extractPainTable(html) {
  const i = html.indexOf('var allData = ');
  if (i < 0) return '';
  const j = html.indexOf('};\n', i);
  if (j < 0) return '';
  let obj;
  try { obj = JSON.parse(singleQuotedToJson(html.slice(i + 'var allData = '.length, j + 1))); } catch (e) { console.log('pain parse failed', e.message); return ''; }
  const rows = [];
  for (const part of Object.keys(obj)) {
    for (const it of obj[part]) {
      const extra = [it.goods, it.shop && '店:' + it.shop, it.clinic && '病院:' + it.clinic, it.drug && '薬:' + it.drug].filter(Boolean).join('、');
      rows.push([part.replace(/^▼/, ''), it.display_part, it.reporter, [it.symptom1, it.symptom2].filter(Boolean).join('／'), it.cause, it.remedy, it.lesson, extra]
        .map(v => String(v || '').replace(/\s+/g, ' ')).join(' | '));
    }
  }
  return '=== ページ: みんなの痛み撲滅シート (pain.html)（列: 部位 | 細かい部位 | 報告者 | 症状 | 原因 | 対応 | 教訓 | 道具・店・病院・薬）===\n' + rows.join('\n');
}

// お役立ちリンク集: 品名・一言・推薦者だけに圧縮（提供元・URL・長い説明は落とす）
function extractLinksTable(html) {
  const rows = [];
  const secRe = /<section class="cat-section" data-cat="([^"]+)">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = secRe.exec(html))) {
    const cat = m[1];
    const cardRe = /<div class="card-title">([\s\S]*?)<\/div>\s*<div class="card-desc">([\s\S]*?)<\/div>([\s\S]*?)(?=<div class="card |<\/div>\s*<\/section>)/g;
    let c;
    while ((c = cardRe.exec(m[2]))) {
      const title = htmlToText(c[1]);
      let desc = htmlToText(c[2]).replace(/\s+/g, ' ');
      if (desc.length > 45) desc = desc.slice(0, 45) + '…';
      const rec = (c[3].match(/推薦：<\/span>([^<]*)/) || [])[1] || '';
      rows.push(`${cat} | ${title} | ${desc} | 推薦:${rec.trim()}`);
    }
  }
  if (!rows.length) return '';
  return '=== ページ: お役立ちリンク集 (links.html)（列: 分類 | 品名 | 一言 | 推薦者。詳しい説明とリンク先はページ参照）===\n' + rows.join('\n');
}

// その年度のレース表（races.html / races-YYYY.html）に同じ日付・同じ大会名で載っている行か
// （10万トークンに収めるため、重複はレース表の側だけ残す。racesByFy は { 年度: ページ本文 }）
function onRacesPage(r, racesByFy) {
  const text = racesByFy && racesByFy[r.fy];
  if (!text) return false;
  const head = String(r.title).replace(/[（(].*$/, '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 5);
  if (head.length < 2) return false;
  for (let k = text.indexOf(r.date); k >= 0; k = text.indexOf(r.date, k + 1)) {
    if (text.slice(k, k + 150).replace(/[^\p{L}\p{N}]/gu, '').includes(head)) return true;
  }
  return false;
}

function extractHistoryTable(html, racesByFy) {
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
  const cap = { desc: 45, memory: 70 };
  const rows = arr.filter(r => !onRacesPage(r, racesByFy)).map(r => cols.map(k => { let v = String(r[k] ?? '').replace(/\s+/g, ' '); if (cap[k] && v.length > cap[k]) v = v.slice(0, cap[k]) + '…'; return v; }).join(' | '));
  return '=== 活動アーカイブ（列: 日付 | 年 | 種別 | 大会・活動名 | 内容 | 参加者 | 思い出 | 記録）===\n' + rows.join('\n');
}

async function buildKb(env) {
  const base = siteBase(env);
  const parts = [];
  const racesByFy = {};
  // 資料を作り直すのは KV が空のときだけ。毎回付く ?t= で Cloudflare と GitHub の古いコピーを避け、更新直後の版を読む
  const fresh = '?t=' + Date.now();
  for (const p of PAGES) {
    const res = await fetch(base + p + '.html' + fresh);
    if (!res.ok) { console.log('kb fetch failed', p, res.status); continue; }
    const html = await res.text();
    const special = p === 'links' ? extractLinksTable(html) : p === 'pain' ? extractPainTable(html) : '';
    const text = special || (`=== ページ: ${PAGE_TITLES[p] || p} (${p}.html) ===\n` + htmlToText(html));
    // レース表は見出しの「YYYY年度」で年度を見分ける（4月に年度が替わってもコードを直さなくてよい）
    const fy = /^races(-\d{4})?$/.test(p) && text.match(/(\d{4})年度/);
    if (fy) racesByFy[Number(fy[1])] = text;
    parts.push(text);
  }
  const hist = await fetch(base + 'history.html' + fresh);
  if (hist.ok) parts.push(extractHistoryTable(await hist.text(), racesByFy));
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

async function askClaude(env, kb, messages, speakerName, channel = 'site') {
  const body = {
    model: env.MODEL || 'claude-haiku-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: SYSTEM_RULES },
      { type: 'text', text: 'サイト資料:\n\n' + kb, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: LONDON_PROFILE + '\n\n今回話していいエピソード:\n' + pickEpisodes(2) + '\n\n' + notFoundParts() + await aliasBlock(env) },
      { type: 'text', text: `今日の日付: ${jstDate()}（日本時間）` + extrasBlock(kb) + featureBlock(channel) + channelBlock(channel) + speakerBlock(speakerName) },
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

// ---------- 今週の仲間の挑戦／○年前の今日（資料から日付で抜き出す） ----------
function jstToday() { const d = new Date(Date.now() + 9 * 3600 * 1000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
const DAY = 86400000;

// 2026年度レース表から、今日〜7日後の大会と出る仲間を抜く
function upcomingChallenges(kb, today = jstToday()) {
  const a = kb.indexOf('=== ページ: 2026年度レース表');
  if (a < 0) return [];
  const b = kb.indexOf('\n=== ', a + 10);
  const lines = kb.slice(a, b < 0 ? undefined : b).split('\n').map(l => l.trim());
  const out = [];
  let year = today.getUTCFullYear();
  for (let i = 0; i < lines.length; i++) {
    const ym = lines[i].match(/^(\d{4})年(\d{1,2})月$/);
    if (ym) { year = +ym[1]; continue; }
    const dm = lines[i].match(/^(\d{1,2})\/(\d{1,2})\(/);
    if (!dm) continue;
    const date = new Date(Date.UTC(year, +dm[1] - 1, +dm[2]));
    const diff = Math.round((date - today) / DAY);
    if (diff < 0 || diff > 7) continue;
    // 種別の次の行が大会名（「⭐ …推奨」の飾り行は飛ばす）
    let j = i + 2;
    while (j < lines.length && /^⭐/.test(lines[j])) j++;
    const name = lines[j] || '';
    let who = '';
    for (let k = j + 1; k < Math.min(lines.length, j + 40); k++) {
      if (/^\d{1,2}\/\d{1,2}\(/.test(lines[k]) || /^\d{4}年\d{1,2}月$/.test(lines[k])) break;
      if (lines[k].startsWith('👥')) { who = lines[k].replace(/^👥\s*/, ''); break; }
    }
    if (!who || /^—/.test(who)) continue;
    const warn = lines.slice(j, j + 4).some(l => /見合わせ|中止|延期/.test(l)) ? '（開催見合わせ・中止の情報あり。資料で確認してから触れる）' : '';
    out.push(`${lines[i]} ${name}（あと${diff}日）${warn} — ${who}`);
  }
  return out;
}

// 活動アーカイブから、前後3日に当たる過去の出来事を抜く
function onThisDay(kb, today = jstToday()) {
  const a = kb.indexOf('=== 活動アーカイブ');
  if (a < 0) return [];
  const out = [];
  for (const line of kb.slice(a).split('\n').slice(1)) {
    const c = line.split(' | ');
    const dm = (c[0] || '').match(/^(\d{1,2})\/(\d{1,2})/);
    const y = parseInt(c[1], 10);
    if (!dm || !y || y >= today.getUTCFullYear()) continue;
    const same = new Date(Date.UTC(today.getUTCFullYear(), +dm[1] - 1, +dm[2]));
    if (Math.abs(Math.round((same - today) / DAY)) > 3) continue;
    out.push(`${y}年${c[0]}（${today.getUTCFullYear() - y}年前）${c[3]} | ${c[4] || ''} | ${c[5] || ''} | ${c[6] || ''}`);
  }
  return out.slice(0, 6);
}

function extrasBlock(kb) {
  const up = upcomingChallenges(kb), past = onThisDay(kb);
  let t = '';
  if (up.length) t += '\n\n今週の仲間の挑戦（レース表から日付で抜き出したもの）:\n' + up.join('\n');
  if (past.length) t += '\n\n○年前の今日のあたり（活動アーカイブから日付で抜き出したもの）:\n' + past.join('\n');
  return t;
}

// ---------- できることの紹介（毎回1つだけ選んで渡す。同じ紹介が続かないように） ----------
const FEATURES = [
  { where: 'line-user', text: 'Strava や Garmin の記録のスクショを送ってくれたら、数字を読んでアドバイスするよ' },
  { where: 'all', text: '「クイズ出して」で、部のことの4択クイズが遊べるよ' },
  { where: 'all', text: '「初フル考えてる」みたいにこれからの挑戦を教えてくれたら、同じ挑戦をした先輩を紹介するよ' },
  { where: 'all', text: '「今週走る人いる？」で、今週レースに出る仲間を教えるよ' },
  { where: 'all', text: '自己ベストや初完走を教えてくれたら、マン・オブ・ザ・イヤーの申告に当たるか一緒に見るよ' },
  { where: 'all', text: '「ふくらはぎが痛い」みたいに痛いところを言ってくれたら、痛み撲滅シートの似た事例を探すよ' },
  { where: 'all', text: '「イージー走の心拍は？」みたいな練習の目安や、ガーミンの設定のことも答えられるよ' },
];
function featureBlock(channel) {
  const list = FEATURES.filter(f => f.where === 'all' || f.where === channel);
  return '\n\n今回紹介してよい、ぼくのできること（1つだけ）: ' + pickOne(list).text;
}

// いまの場所ごとの、クイズの誘い方
function channelBlock(channel) {
  const t = {
    'line-user': 'いまの場所: LINE の1対1。答えたあと会話が一段落したとき（お礼・あいさつ・「ナイスラン」などの短い言葉だけが来たとき）に、5回に1回くらい、最後に1行だけ「ところで、クイズやる？」と誘ってよい。クイズの選択肢はボタンになって表示される。',
    'line-group': 'いまの場所: LINE のグループ。自分からクイズに誘わない。頼まれたら出してよい。選択肢はボタンになって表示される。',
    'site': 'いまの場所: サイトの小窓。自分からクイズに誘わない。頼まれたら出してよい（相手は番号を打って答える）。',
  }[channel];
  return t ? '\n\n' + t : '';
}

// 話している相手の LINE 表示名（サイトでは無し）。キャッシュの後ろに置くので、毎回変わっても割引は崩れない
function speakerBlock(name) {
  if (!name) return '';
  return `\n\nいま話しかけてきた人の LINE 表示名: 「${name}」
- この人は「${callName(name)}さん」と呼ぶ。毎回は呼ばない。最初の返事、お礼、励ます・ねぎらう場面など、自然なところで（目安: 2〜3回の返事に1回）。1つの返事の中で名前を呼ぶのは1回まで。呼び名は上の通りに一度で書き、途中で切ったり言い直したりしない。
- グループでも、呼ぶのは今話しかけてきたこの人だけ。
- この表示名を、サイト資料の愛称や「名寄せ表」と結び付けない。「○○さんは資料の△△さんだね」のような推測も言わない（サイトの愛称は匿名にしてあるため）。本人が「ぼくは資料の△△だよ」と自分で言ったときだけ、その会話の中でその愛称の話をしてよい。`;
}

// 表示名から呼び名を作る: 絵文字・記号・かっこ書きを外し、長すぎれば切る
function callName(name) {
  let n = String(name).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '')
    .replace(/[★☆♪♡♥〜~＠@＊*・|｜_]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  n = n.replace(/(さん|様|さま|ちゃん|くん|君)$/, '').trim();
  // 長い名前は単語の途中で切らない（例: Tomohiko Hayashi はそのまま）
  if ([...n].length > 20) {
    const head = [...n].slice(0, 20).join('');
    const sp = head.lastIndexOf(' ');
    n = sp > 0 ? head.slice(0, sp) : head;
  }
  return n || String(name).trim().slice(0, 12);
}

// LINE の表示名を取る（保存はしない。1対1もグループも友だち登録なしで取れる）
async function lineDisplayName(env, src) {
  if (!src.userId) return '';
  const path = src.type === 'group' ? `/group/${src.groupId}/member/${src.userId}`
    : src.type === 'room' ? `/room/${src.roomId}/member/${src.userId}`
    : `/profile/${src.userId}`;
  try {
    const res = await fetch(LINE_API + path, { headers: { 'Authorization': 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN } });
    if (!res.ok) { console.log('line profile', res.status); return ''; }
    const p = await res.json();
    return String(p.displayName || '').slice(0, 40);
  } catch (e) { console.log('line profile failed', e.message); return ''; }
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
    const reply = splitSticker(splitQuiz(await askClaude(env, kb, messages)).text).text;
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
const LINE_PRIVACY = '【お願いと約束】\n・部員限定だよ。このアカウントや答えの内容は部外に転送しないでね\n・未認証アカウントだから、LINE の検索にも「おすすめ」にも出ないよ。QR か URL を知ってる人だけが追加できる\n・名前や愛称は送って大丈夫。電話番号・住所・持病みたいなデリケートなことだけは送らないでね\n・やりとりは1時間で自動で消えるよ。どこにも保存してないし、運営の人も見てない。AI の学習にも使われないよ\n・話しかけてくれた人は LINE の表示名で呼ぶよ（表示名は覚えておかない）。ほかの部員のことを答えるときはサイトと同じ愛称だけ。本名・連絡先・住所は答えないよ';
const LINE_GREETING = 'やあ、広尾親父RC のワンナー、ロンドンだよ。走るのとサイトの案内が仕事。\nレース表・練習の目安・活動アーカイブなど、サイトに載ってることなら答えられるよ。初心者の人ほど気軽に聞いてね。\n\n' + LINE_PRIVACY + '\n\n部員確認のため、まずサイトと同じ4桁の合言葉を送ってね。\n（ヒント: 学校の創立記念日を月日の4桁で。検索すると出てきます）';
const LINE_ASK_PASS = '部員確認のため、サイトと同じ4桁の合言葉を送ってね。\n（ヒント: 学校の創立記念日を月日の4桁で。検索すると出てきます）';
const LINE_PASS_OK = '合言葉、確認できたよ。ようこそ！\n\nぼくにできること:\n・レース予定や定例ランの案内（「来月のレースは？」）\n・走った記録のスクショを見てアドバイス（Strava・Garmin など）\n・同じ挑戦をした先輩の紹介（「初フル考えてる」）\n・今週走る仲間のお知らせ（「今週走る人いる？」）\n・痛みの相談に、痛み撲滅シートの似た事例を紹介\n・部のことの4択クイズ（「クイズ出して」）\n\n答えや画面の転送は部内だけでお願いね。';
const LINE_PASS_LOCK = '合言葉の間違いが続いたので、しばらく受け付けを止めます。1時間ほどしてからもう一度どうぞ。';
const IMAGE_PROMPT = '（ランニングアプリや時計の記録のスクショを送りました。見てアドバイスをください）';
const IMAGE_SET_NOTE = '（何枚かまとめて送ったけど、届いたのは1枚目だけ）';
const IMAGE_MEMO = '（スクショを1枚送った。画像そのものは残していない）';
const IMAGE_MAX_BYTES = 4.5 * 1024 * 1024;
// LINE の画像を取ってきて Claude に渡す形にする（保存はしない）
async function lineImage(env, messageId) {
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { 'Authorization': 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN } });
    if (!res.ok) { console.log('line image', res.status); return null; }
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > IMAGE_MAX_BYTES) return null;
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { type: 'image', source: { type: 'base64', media_type: type, data: btoa(bin) } };
  } catch (e) { console.log('line image failed', e.message); return null; }
}
const QUIZ_ANSWER_RE = /^[①②③④1-4１-４]$/;
const QUIZ_BUTTONS = ['①', '②', '③', '④'];
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

async function lineSend(env, replyToken, chatId, text, stickerId, quickReply) {
  const messages = [];
  if (text) messages.push({ type: 'text', text: text.replace(/\*\*/g, '').slice(0, 4900) });
  if (stickerId) messages.push({ type: 'sticker', packageId: STICKER_PACKAGE, stickerId });
  if (!messages.length) return;
  if (quickReply) messages[messages.length - 1].quickReply = { items: quickReply.map(label => ({ type: 'action', action: { type: 'message', label, text: label } })) };
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
      if (ev.message.type === 'sticker') { if (!isGroup) await lineSend(env, ev.replyToken, chatId, '', pickOne(STICKERS['うれしい'])); continue; }
      // スクショ（1対1だけ）。グループでは他人の記録が全員に見えるので受けない
      const isImage = ev.message.type === 'image';
      if (isImage && isGroup) continue;
      if (isImage && ev.message.imageSet && ev.message.imageSet.index > 1) continue; // まとめ送りは1枚目だけ見る
      if (!isImage && ev.message.type !== 'text') { if (!isGroup) await lineSend(env, ev.replyToken, chatId, '文字で質問してください。'); continue; }

      let { toSelf, text } = isImage ? { toSelf: true, text: IMAGE_PROMPT + (ev.message.imageSet && ev.message.imageSet.total > 1 ? IMAGE_SET_NOTE : '') } : lineQuestion(ev.message);
      // グループでクイズを出した直後は、メンションなしの番号だけでも答えとして受ける
      if (isGroup && !toSelf && QUIZ_ANSWER_RE.test(text) && await env.CHAT_KV.get(`line:quiz:${chatId}`)) {
        toSelf = true;
        await env.CHAT_KV.delete(`line:quiz:${chatId}`);
      }
      if (isGroup && !toSelf) {
        const raw = String(ev.message.text || '');
        if (raw.length <= 40 && /ロンドン/.test(raw) && PRAISE_RE.test(raw) && await env.CHAT_KV.get(`line:ok:${chatId}`)) {
          const k = `line:gsticker:${chatId}`;
          if (!(await env.CHAT_KV.get(k))) {
            await env.CHAT_KV.put(k, '1', { expirationTtl: 600 });
            await lineSend(env, ev.replyToken, chatId, '', pickOne(/ごめん|すまん/.test(raw) ? STICKERS['ごめん'] : STICKERS['照れ']));
          }
        }
        continue;
      }
      if (!text) { await lineSend(env, ev.replyToken, chatId, '聞きたいことを文字で送ってください。'); continue; }

      const who = src.userId || chatId;
      const minute = Math.floor(Date.now() / 60000);
      if (await bump(env.CHAT_KV, `line:${who}:${minute}`, 120) > PER_MINUTE_LIMIT) { await lineSend(env, ev.replyToken, chatId, '少し間をあけてから聞いてください。'); continue; }

      // 合言葉ゲート: 1対1は相手ごと、グループはグループごとに一度だけ
      if (env.LINE_PASS && !(await env.CHAT_KV.get(`line:ok:${chatId}`))) {
        const fails = parseInt((await env.CHAT_KV.get(`line:fail:${who}`)) || '0', 10);
        if (fails >= PASS_FAIL_LIMIT) { await lineSend(env, ev.replyToken, chatId, LINE_PASS_LOCK); continue; }
        if (isImage) { await lineSend(env, ev.replyToken, chatId, LINE_ASK_PASS); continue; }
        const passRe = new RegExp('(^|\\D)' + env.LINE_PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)');
        if (passRe.test(text.replace(/[\s　]/g, ''))) {
          await env.CHAT_KV.put(`line:ok:${chatId}`, '1');
          const nm = await lineDisplayName(env, src);
          await lineSend(env, ev.replyToken, chatId, (nm ? `${callName(nm)}さん、` : '') + LINE_PASS_OK);
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
      if (isImage) {
        const img = await lineImage(env, ev.message.id);
        if (!img) { await lineSend(env, ev.replyToken, chatId, 'ごめん、その画像はうまく開けなかったよ。小さめのスクショでもう一度送ってみてね。'); continue; }
        // 画像は今回だけ AI に見せる。会話メモには「スクショを送った」という文字だけ残す
        messages[messages.length - 1] = { role: 'user', content: [img, { type: 'text', text }] };
      }

      let reply;
      try {
        const [kb, name] = await Promise.all([getKb(env, ctx), lineDisplayName(env, src)]);
        reply = await askClaude(env, kb, messages, name, isGroup ? 'line-group' : 'line-user');
      } catch (e) {
        console.log('line chat failed', e.message);
        reply = '今はうまく答えられません。少し待ってからもう一度どうぞ。';
      }
      const q = splitQuiz(reply);
      const out = splitSticker(q.text);
      await lineSend(env, ev.replyToken, chatId, out.text, out.sticker, q.quiz ? QUIZ_BUTTONS : null);
      if (q.quiz && isGroup) await env.CHAT_KV.put(`line:quiz:${chatId}`, '1', { expirationTtl: 600 });
      // 正解番号は会話メモにだけ残す（答え合わせ用。メモは1時間で消える）
      const saved = q.quiz ? `${out.text}\n[クイズ:${q.quiz}]` : out.text;
      const memo = messages.map(m => typeof m.content === 'string' ? m : { role: m.role, content: IMAGE_MEMO });
      await env.CHAT_KV.put(histKey, JSON.stringify([...memo, { role: 'assistant', content: saved }].slice(-HISTORY_KEEP)), { expirationTtl: LINE_HISTORY_TTL });
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

export const _internal = { upcomingChallenges, onThisDay, htmlToText, extractHistoryTable, buildKb, PAGES, lineVerify, lineQuestion, linkPages };
