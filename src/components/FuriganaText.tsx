import React from "react";

type FuriganaPart = {
  base: string;
  reading?: string;
};

type FuriganaTextProps = {
  parts: FuriganaPart[];
};

const phraseMap: Record<string, FuriganaPart[]> = {
  "行きたい": [
    { base: "行", reading: "い" },
    { base: "きたい" },
  ],
  "行きたくない": [
    { base: "行", reading: "い" },
    { base: "きたくない" },
  ],
  "行く": [{ base: "行", reading: "い" }, { base: "く" }],
  "行かない": [{ base: "行", reading: "い" }, { base: "かない" }],
  "カード一覧": [{ base: "カード" }, { base: "一覧", reading: "いちらん" }],
  "残りカード一覧": [{ base: "残", reading: "のこ" }, { base: "りカード" }, { base: "一覧", reading: "いちらん" }],
  "全カード一覧": [{ base: "全" }, { base: "カード" }, { base: "一覧", reading: "いちらん" }],
  "履歴": [{ base: "履歴", reading: "りれき" }],
  "ルーム作成": [{ base: "ルーム" }, { base: "作成", reading: "さくせい" }],
  "作成中...": [{ base: "作成中", reading: "さくせいちゅう" }, { base: "..." }],
  "参加する": [{ base: "参加", reading: "さんか" }, { base: "する" }],
  "名前": [{ base: "名前", reading: "なまえ" }],
  "部屋": [{ base: "部屋", reading: "へや" }],
  "ゲスト参加": [{ base: "ゲスト" }, { base: "参加", reading: "さんか" }],
  "トップへ戻る": [{ base: "トップへ" }, { base: "戻", reading: "もど" }, { base: "る" }],
  "ユーザ名": [{ base: "ユーザ" }, { base: "名", reading: "めい" }],
  "ゲーム開始": [{ base: "ゲーム" }, { base: "開始", reading: "かいし" }],
  "まだ履歴がありません": [{ base: "まだ" }, { base: "履歴", reading: "りれき" }, { base: "がありません" }],
  "戻す": [{ base: "戻", reading: "もど" }, { base: "す" }],
  "次のページへ": [{ base: "次", reading: "つぎ" }, { base: "のページへ" }],
  "閉じる": [{ base: "閉", reading: "と" }, { base: "じる" }],
  "振り分け結果": [
    { base: "振", reading: "ふ" },
    { base: "り" },
    { base: "分", reading: "わ" },
    { base: "け" },
    { base: "結果", reading: "けっか" },
  ],
  "カードに付箋をつけよう！": [{ base: "カードに" }, { base: "付箋", reading: "ふせん" }, { base: "をつけよう！" }],
  "カードを振り分けて旅行計画を立てていこう！": [
    { base: "カードを" },
    { base: "振", reading: "ふ" },
    { base: "り" },
    { base: "分", reading: "わ" },
    { base: "けて" },
    { base: "旅行", reading: "りょこう" },
    { base: "計画", reading: "けいかく" },
    { base: "を" },
    { base: "立", reading: "た" },
    { base: "てていこう！" },
  ],
  "すべて振り分けました": [
    { base: "すべて" },
    { base: "振", reading: "ふ" },
    { base: "り" },
    { base: "分", reading: "わ" },
    { base: "けました" },
  ],
  "付箋": [{ base: "付箋", reading: "ふせん" }],
  "理由": [{ base: "理由", reading: "りゆう" }],
  "振り分け理由": [
    { base: "振", reading: "ふ" },
    { base: "り" },
    { base: "分", reading: "わ" },
    { base: "け" },
    { base: "理由", reading: "りゆう" },
  ],
  "理由（付箋）": [
    { base: "理由", reading: "りゆう" },
    { base: "（" },
    { base: "付箋", reading: "ふせん" },
    { base: "）" },
  ],
  "理由を選択": [{ base: "理由", reading: "りゆう" }, { base: "を" }, { base: "選択", reading: "せんたく" }],
  "理由を入力": [{ base: "理由", reading: "りゆう" }, { base: "を入力", reading: "をにゅうりょく" }],
  "付箋をつける/外す": [
    { base: "付箋", reading: "ふせん" },
    { base: "をつける/" },
    { base: "外", reading: "はず" },
    { base: "す" },
  ],
  "付箋をつけてなぜそう思うのか表現してみよう！": [
    { base: "付箋", reading: "ふせん" },
    { base: "をつけてなぜそう" },
    { base: "思", reading: "おも" },
    { base: "うのか" },
    { base: "表現", reading: "ひょうげん" },
    { base: "してみよう！" },
  ],
  "カードに付箋をつけて振り分けた理由を表現しよう！": [
    { base: "カードに" },
    { base: "付箋", reading: "ふせん" },
    { base: "をつけて" },
    { base: "振", reading: "ふ" },
    { base: "り" },
    { base: "分", reading: "わ" },
    { base: "けた" },
    { base: "理由", reading: "りゆう" },
    { base: "を" },
    { base: "表現", reading: "ひょうげん" },
    { base: "しよう！" },
  ],
  "議論へ": [{ base: "議論", reading: "ぎろん" }, { base: "へ" }],
  "次のページに進んで話し合いをする！": [
    { base: "次", reading: "つぎ" },
    { base: "のページに" },
    { base: "進", reading: "すす" },
    { base: "んで" },
    { base: "話", reading: "はな" },
    { base: "し" },
    { base: "合", reading: "あ" },
    { base: "いをする！" },
  ],
  "議論していきましょう！": [{ base: "議論", reading: "ぎろん" }, { base: "していきましょう！" }],
  "議論を開始する": [{ base: "議論", reading: "ぎろん" }, { base: "を" }, { base: "開始", reading: "かいし" }, { base: "する" }],
  "議論中（VS）": [{ base: "議論中", reading: "ぎろんちゅう" }, { base: "（VS）" }],
  "VS": [{ base: "VS" }],
  "話し合いの前に、、、": [{ base: "話", reading: "はな" }, { base: "し" }, { base: "合", reading: "あ" }, { base: "いの" }, { base: "前", reading: "まえ" }, { base: "に、、、" }],
  "最終確認": [{ base: "最終", reading: "さいしゅう" }, { base: "確認", reading: "かくにん" }],
  "最終結果": [{ base: "最終", reading: "さいしゅう" }, { base: "結果", reading: "けっか" }],
  "個人の考えの整理はここで終了です。良いですか？": [
    { base: "個人", reading: "こじん" },
    { base: "の" },
    { base: "考", reading: "かんが" },
    { base: "えの" },
    { base: "整理", reading: "せいり" },
    { base: "はここで" },
    { base: "終了", reading: "しゅうりょう" },
    { base: "です。" },
    { base: "良", reading: "よ" },
    { base: "いですか？" },
  ],
  "他の人を待ちます。付箋をつけられるのはここまで！つけ忘れはない？": [
    { base: "他", reading: "ほか" },
    { base: "の" },
    { base: "人", reading: "ひと" },
    { base: "を" },
    { base: "待", reading: "ま" },
    { base: "ちます。" },
    { base: "付箋", reading: "ふせん" },
    { base: "をつけられるのはここまで！つけ" },
    { base: "忘", reading: "わす" },
    { base: "れはない？" },
  ],
  "他の人を待つよ！付箋をつけられるのはここまで！つけ忘れはない？": [
    { base: "他", reading: "ほか" },
    { base: "の" },
    { base: "人", reading: "ひと" },
    { base: "を" },
    { base: "待", reading: "ま" },
    { base: "つよ！" },
    { base: "付箋", reading: "ふせん" },
    { base: "をつけられるのはここまで！つけ" },
    { base: "忘", reading: "わす" },
    { base: "れはない？" },
  ],
  "他の参加者を待っています…": [
    { base: "他", reading: "ほか" },
    { base: "の" },
    { base: "参加者", reading: "さんかしゃ" },
    { base: "を" },
    { base: "待", reading: "ま" },
    { base: "っています…" },
  ],
  "移動先を選択": [{ base: "移動先", reading: "いどうさき" }, { base: "を" }, { base: "選択", reading: "せんたく" }],
  "カード移動": [{ base: "カード" }, { base: "移動", reading: "いどう" }],
  "移動しました": [{ base: "移動", reading: "いどう" }, { base: "しました" }],
  "保存": [{ base: "保存", reading: "ほぞん" }],
  "付箋を消しますか？": [{ base: "付箋", reading: "ふせん" }, { base: "を" }, { base: "消", reading: "け" }, { base: "しますか？" }],
  "この付箋を消してもいいですか？": [{ base: "この" }, { base: "付箋", reading: "ふせん" }, { base: "を" }, { base: "消", reading: "け" }, { base: "してもいいですか？" }],
  "消さない": [{ base: "消", reading: "け" }, { base: "さない" }],
  "消す": [{ base: "消", reading: "け" }, { base: "す" }],
  "写真映え": [{ base: "写真映", reading: "しゃしんば" }, { base: "え" }],
  "スリル": [{ base: "スリル" }],
  "体験": [{ base: "体験", reading: "たいけん" }],
  "時間": [{ base: "時間", reading: "じかん" }],
  "コスパ": [{ base: "コスパ" }],
  "友達と一緒に": [{ base: "友達", reading: "ともだち" }, { base: "と" }, { base: "一緒", reading: "いっしょ" }, { base: "に" }],
  "家族向け": [{ base: "家族", reading: "かぞく" }, { base: "向", reading: "む" }, { base: "け" }],
  "リラックス": [{ base: "リラックス" }],
  "その他": [{ base: "その" }, { base: "他", reading: "た" }],
  "結果を見る": [{ base: "結果", reading: "けっか" }, { base: "を" }, { base: "見", reading: "み" }, { base: "る" }],
  "今回行く場所はこちら！": [
    { base: "今回", reading: "こんかい" },
    { base: "行", reading: "い" },
    { base: "く" },
    { base: "場所", reading: "ばしょ" },
    { base: "はこちら！" },
  ],
  "行くカードが決まったよ！": [
    { base: "行", reading: "い" },
    { base: "くカードが" },
    { base: "決", reading: "き" },
    { base: "まったよ！" },
  ],
  "みんなが行きたいカードがそろったよ！": [
    { base: "みんなが" },
    { base: "行", reading: "い" },
    { base: "きたいカードがそろったよ！" },
  ],
  "確認中...": [{ base: "確認", reading: "かくにん" }, { base: "中", reading: "ちゅう" }, { base: "..." }],
  "まだみんなが行きたい場所は決まっていないよ": [
    { base: "まだみんなが" },
    { base: "行", reading: "い" },
    { base: "きたい" },
    { base: "場所", reading: "ばしょ" },
    { base: "は" },
    { base: "決", reading: "き" },
    { base: "まっていないよ" },
  ],
  "全員が行きたい場所はなかったみたいだ、、、！これは、、、！": [
    { base: "全員", reading: "ぜんいん" },
    { base: "が" },
    { base: "行", reading: "い" },
    { base: "きたい" },
    { base: "場所", reading: "ばしょ" },
    { base: "はなかったみたいだ、、、！これは、、、！" },
  ],
  "行くカードはなかったみたいだ、、、！これは、、、！": [
    { base: "行", reading: "い" },
    { base: "くカードはなかったみたいだ、、、！これは、、、！" },
  ],
  "つぎへ": [{ base: "つぎへ" }],
  "ミッション発生！": [{ base: "ミッション" }, { base: "発生", reading: "はっせい" }, { base: "！" }],
  "ミッション！": [{ base: "ミッション！" }],
  "ミッション達成！": [{ base: "ミッション" }, { base: "達成", reading: "たっせい" }, { base: "！" }],
  "全ミッション達成！": [{ base: "全", reading: "ぜん" }, { base: "ミッション" }, { base: "達成", reading: "たっせい" }, { base: "！" }],
  "ミッション、意見が分かれてるカードをどうするか話し合おう！": [
    { base: "ミッション、" },
    { base: "意見", reading: "いけん" },
    { base: "が" },
    { base: "分", reading: "わ" },
    { base: "かれてるカードをどうするか" },
    { base: "話", reading: "はな" },
    { base: "し" },
    { base: "合", reading: "あ" },
    { base: "おう！" },
  ],
  "意見が分かれてるカードをどうするか話し合おう！": [
    { base: "意見", reading: "いけん" },
    { base: "が" },
    { base: "分", reading: "わ" },
    { base: "かれてるカードをどうするか" },
    { base: "話", reading: "はな" },
    { base: "し" },
    { base: "合", reading: "あ" },
    { base: "おう！" },
  ],
  "意見が分かれているカードを話し合って解決しよう！": [
    { base: "意見", reading: "いけん" },
    { base: "が" },
    { base: "分", reading: "わ" },
    { base: "かれているカードを" },
    { base: "話", reading: "はな" },
    { base: "し" },
    { base: "合", reading: "あ" },
    { base: "って" },
    { base: "解決", reading: "かいけつ" },
    { base: "しよう！" },
  ],
  "残りミッションカード": [
    { base: "残", reading: "のこ" },
    { base: "りミッションカード" },
  ],
  "全員で意見を合わせることでミッションを達成できるよ！": [
    { base: "全員", reading: "ぜんいん" },
    { base: "で" },
    { base: "意見", reading: "いけん" },
    { base: "を" },
    { base: "合", reading: "あ" },
    { base: "わせることでミッションを" },
    { base: "達成", reading: "たっせい" },
    { base: "できるよ！" },
  ],
  "みんなの意見がそろったよ！": [
    { base: "みんなの" },
    { base: "意見", reading: "いけん" },
    { base: "がそろったよ！" },
  ],
  "人の投票を待っているよ": [
    { base: "人", reading: "にん" },
    { base: "の" },
    { base: "投票", reading: "とうひょう" },
    { base: "を" },
    { base: "待", reading: "ま" },
    { base: "っているよ" },
  ],
  "まだ意見がそろっていないよ。話し合って合わせよう！": [
    { base: "まだ" },
    { base: "意見", reading: "いけん" },
    { base: "がそろっていないよ。" },
    { base: "話", reading: "はな" },
    { base: "し" },
    { base: "合", reading: "あ" },
    { base: "って" },
    { base: "合", reading: "あ" },
    { base: "わせよう！" },
  ],
  "話し合いへ": [{ base: "話", reading: "はな" }, { base: "し" }, { base: "合", reading: "あ" }, { base: "いへ" }],
  "選択中": [{ base: "選択中", reading: "せんたくちゅう" }],
  "参加者": [{ base: "参加者", reading: "さんかしゃ" }],
  "合致度サマリー": [{ base: "合致度", reading: "がっちど" }, { base: "サマリー" }],
  "投票しました": [{ base: "投票", reading: "とうひょう" }, { base: "しました" }],
  "あなたの投票": [{ base: "あなたの" }, { base: "投票", reading: "とうひょう" }],
  "未投票": [{ base: "未投票", reading: "みとうひょう" }],
  "保留": [{ base: "保留", reading: "ほりゅう" }],
  "mobile2の振り分け（理由）": [
    { base: "mobile2の" },
    { base: "振", reading: "ふ" },
    { base: "り" },
    { base: "分", reading: "わ" },
    { base: "け" },
    { base: "（" },
    { base: "理由", reading: "りゆう" },
    { base: "）" },
  ],
  "mobile2の最終結果": [{ base: "mobile2の" }, { base: "最終", reading: "さいしゅう" }, { base: "結果", reading: "けっか" }],
  "全て解消しないと終了できません": [
    { base: "全", reading: "ぜん" },
    { base: "て" },
    { base: "解消", reading: "かいしょう" },
    { base: "しないと" },
    { base: "終了", reading: "しゅうりょう" },
    { base: "できません" },
  ],
  "誰も選択していません": [{ base: "誰", reading: "だれ" }, { base: "も" }, { base: "選択", reading: "せんたく" }, { base: "していません" }],
  "未分類": [{ base: "未分類", reading: "みぶんるい" }],
  "準備ができたら開始してください": [
    { base: "準備", reading: "じゅんび" },
    { base: "ができたら" },
    { base: "開始", reading: "かいし" },
    { base: "してください" },
  ],
  "開始する": [{ base: "開始", reading: "かいし" }, { base: "する" }],
  "わかった": [{ base: "わかった" }],
};

const cardTitleMap: Record<string, FuriganaPart[]> = {
  "名探偵コナン 4-D ライブ・ショー ~星空の宝石(ジュエル)~": [
    { base: "名探偵", reading: "めいたんてい" },
    { base: "コナン 4-D ライブ・ショー ~" },
    { base: "星空", reading: "ほしぞら" },
    { base: "の" },
    { base: "宝石", reading: "ジュエル" },
    { base: "(ジュエル)~" },
  ],
  "マリオカート ~クッパの挑戦状~": [
    { base: "マリオカート ~クッパの" },
    { base: "挑戦状", reading: "ちょうせんじょう" },
    { base: "~" },
  ],
};

export function FuriganaText({ parts }: FuriganaTextProps) {
  return (
    <>
      {parts.map((part, index) =>
        part.reading ? (
          <ruby key={`${part.base}-${index}`} style={{ rubyAlign: "center" }}>
            {part.base}
            <rt style={{ fontSize: "0.55em", lineHeight: 1, fontWeight: 700 }}>{part.reading}</rt>
          </ruby>
        ) : (
          <React.Fragment key={`${part.base}-${index}`}>{part.base}</React.Fragment>
        )
      )}
    </>
  );
}

export function getFuriganaText(text: string): React.ReactNode {
  const parts = phraseMap[text];
  return parts ? <FuriganaText parts={parts} /> : text;
}

export function getCardTitleText(title: string): React.ReactNode {
  const parts = cardTitleMap[title] || phraseMap[title];
  return parts ? <FuriganaText parts={parts} /> : title;
}
