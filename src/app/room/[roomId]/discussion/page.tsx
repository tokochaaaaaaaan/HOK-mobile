"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import MapButton from "@/components/MapButton";
import NoteWindow from "../components/NoteWindow";
import styles from "../play/page.module.css";
import { cards as allCards } from "@/data/cards";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";

export default function DiscussionPage() {
  const { roomId } = useParams();
  const { userName } = useUser();

  // ブラウザの戻るボタン無効化（play1の仕様を踏襲）
  usePreventBack();

  // ページ更新を防止（確認ダイアログ表示）
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // 参加者情報の取得
  const [participants, setParticipants] = useState<Array<{ id: string; userName: string }>>([]);

  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;

    const unsub = onSnapshot(
      doc(db, "rooms", roomId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setParticipants([]);
          return;
        }
        const data = snapshot.data();
        const parts = data?.participants || {};
        const list = Object.entries(parts).map(([id, value]) => {
          const valueData = value as any;
          const name = typeof valueData === 'string' 
            ? (valueData.trim().length > 0 ? valueData.trim() : id)
            : (valueData?.name?.trim() || id);
          return {
            id,
            userName: name,
          };
        });
        setParticipants(list);
      }
    );

    return () => unsub();
  }, [roomId]);

  // カード情報（概要と詳細） — playのUIから流用
  const cardInfo: { [key: string]: { overview: string; details: string } } = {
    "ジョーズ": {
      overview:
        "巨大な人喰いザメに襲われる恐怖のボートツアー。平和な港町の楽しいボートツアーが一転。突如巨大な人喰いザメが現れ、 生死を分ける恐怖のツアーへと変わり果てる。 映画『ジョーズ』の海を舞台にした恐怖のツアー。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい、小さなお子さまと一緒に楽しめる、水に濡れる可能性あり\nサービス: フォトサービス\n身長制限: 122cm\n付き添い者同伴の場合: 身長制限なし\n所要時間: 約7分\n定員: 48名(6名×8列)\nアトラクション利用基準: 小さなお子さまも一人で着席が必要\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、シングルライダー可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ55分、雨25分",
    },
    "アミティ・ボードウォーク・ゲーム": {
      overview:
        "カーニバルゲームに挑戦。アミティ・ビレッジのラグーンの近くにあるこちらでは、カーニバルゲームに挑戦できるよ。アトラクション、ショーめぐりの合間や、お腹いっぱい食べた後などに、ぜひ体を動かして、ゲームにチャレンジしてみてね。かわいい景品がもらえるチャンス。",
      details: "料金: 有料\n身長制限: なし\nアトラクションタイプ: ゲーム",
    },
    "ウォーターワールド": {
      overview:
        "この面白さ、命がけ。体験者数、累計1億人を突破。映画そのままの壮絶スタントに息をのむ、大人気のアクション・ショーが進化。一新されたサラウンド音響システムにより、爆発や銃撃に巻き込まれたかのような圧倒的臨場感に包まれる。緊迫感あふれる水上バトルの真っただ中に、今、放り込まれる。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい、水に濡れる可能性あり\n身長制限: なし\n所要時間: 約20分\n定員: 3220名(立ち見120名、車イス、電動車イススペース22台)\nアトラクションタイプ: ショー・アトラクション\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、妊娠中可、車イス可",
    },
    "ザ・ドラゴン・パール": {
      overview: "サンフランシスコのチャイナタウンにある中国料理店",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、中華、麺類\n支払い方法: クレジットカード利用可\n営業時間: 10:00~17:00\n価格帯: ￥1000～￥2000",
    },
    "ロンバーズ・ランディング": {
      overview:
        "おいしいメニューと極上のエンターテイメントが融合。シーズンイベントやアトラクションと連動したお食事と エンターテイメントを楽しめる、パークならではのレストラン。期間限定でオープンします。",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー\n営業時間: 営業時間はクルーにお問合わせください。\n価格帯: 不明",
    },
    "ロストワールド・レストラン": {
      overview: "ジャングルにひそむ秘密のレストラン",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、サンドウィッチ・ハンバーガー\n支払い方法: クレジットカード利用可\n営業時間: 10:30~18:00\n価格帯: ￥1000～￥2000",
    },
    "ジュラシック・パーク・ダイナソー・ミート&グリート": {
      overview:
        "亜熱帯のジャングルでド迫力の大型恐竜や、赤ちゃん恐竜とふれ合う驚愕体験。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\n年齢制限: なし\n身長制限: なし\nアクションタイプ: ステージ・ショー&ストリート・ショー",
    },
    "ザ・フライング・ダイナソー": {
      overview:
        "ナマ身でぶっ飛べ。想像を絶する高低差と長さを誇る、最新鋭のフライング・コースター。暴走する恐竜プテラノドンに背中を掴まれ、全身むき出しで空を飛ぶ。ジュラシック・パークの世界のなかを360度振り回される、日常が吹っ飛ぶ「ありえない」スリル体験が、ここに。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい\nサービス: フォトサービス\n身長制限: 132cm以上および198cm以下\n付き添い者同伴の場合: 身長制限は132cm以上\n荷物の持込み禁止: ロッカーあり、金属探知機によるチェックあり\n所要時間: 約3分\nアトラクション利用基準: 安全バー、座席幅確認\nサポート: シングルライダー可、チャイルドスイッチ可、車イス可\nアクションタイプ: ライド・アクション\n25/11月の平均混雑時間: 晴れ72分、雨28分",
    },
    "名探偵コナン 4-D ライブ・ショー ~星空の宝石(ジュエル)~": {
      overview:
        "今宵、超ど迫力の新次元劇場（ネオディメンション・シアター）へご招待。「名探偵コナン」の世界へ体ごと入り込む、まったく新しい、究極のシアター型アトラクション、出現。あなたの目の前に現れるリアルな登場人物、巨大スクリーンで展開する圧巻の3D映像×五感を刺激するエフェクト、そのハイクオリティなトリックに、ハラハラドキドキが止まらない。未だ見たことのない新次元の体験が、あなたを待つ。",
      details:
        "アトラクションの特徴: 小さなお子さまと一緒に楽しめる、3D&4D、水に濡れる可能性あり\n身長制限: なし\n所要時間: 約30分\n定員: 750名(車イス、電動車イススペース8台)\nアトラクション利用基準: 小さなお子さまも一人で着席が必要\nアトラクションタイプ: ショー・アトラクション\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、車イス可\n25/11月の平均混雑時間: 晴れ42分、雨36分",
    },
    "クロミ・ライブ": {
      overview:
        "マイメロディ＆クロミのキュートでロックなステージに、歌って踊って大盛り上がり。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\n年齢制限: なし\n身長制限: なし\nアトラクションタイプ: ステージ・ショー",
    },
    "パークサイド・グリル": {
      overview:
        "眺めの良い店内でいただく、本格エイジング・ビーフ（熟成肉）とビールで贅沢な時間を。",
      details:
        "サービスタイプ: フルサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、洋食、バー・お酒、プラントベースメニュー、プレミアム アレルギーメニュー\nサービス: レストラン優先案内\n支払い方法: クレジットカード利用可\n営業時間: 10:30~19:30\n価格帯: ￥3000～",
    },
    "SAIDO": {
      overview:
        "マンハッタンのアパートメントを外観に持つ、スタイリッシュなジャパニーズ・レストラン。",
      details:
        "サービスタイプ: フルサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、和食、麺類、ご飯類、バー・お酒、プレミアム アレルギーメニュー\n支払い方法: クレジットカード利用可\n営業時間: 10:30~20:00\n価格帯: ￥2000～￥3000",
    },
    "デリシャス・ミー！ザ・クッキー・キッチン": {
      overview:
        "くいしん坊ミニオンたちの大発明。「クッキー・マシン」で作る絶品サンド。「クッキー製造マシン」で作るクッキー・サンドのほか、サンデーやドリンクも。",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: スウィーツ・ミニオン・フードもあり\n支払い方法: クレジットカード利用可\n営業時間: 09:30~18:00\n価格帯: ～￥1000",
    },
    "スペース・キラー": {
      overview:
        "三姉妹が大好きなあのバズーカ・ゲームにチャレンジ。ミニオンたちは、三姉妹が大好きなあのゲームを、 ミニオン・パークにもオープン。挑戦して、景品をゲットしよう。",
      details: "料金: 有料\n身長制限: なし\nアトラクションタイプ: ゲーム",
    },
    "ミニオン・ハチャメチャ・アイス": {
      overview:
        "凍って、スベって、ハチャメチャな氷上レース。ミニオン・パークの熱気で、パーク内のプールが沸騰。あわてたミニオンたち、巨大凍らせ銃を持ち出して、レイトウコウセン、ハッシャ～。突如出現したアイスリンクに、ミニオンたちの遊び心がバクハツ。製氷車を走らせて、あっちへツルツル、こっちへツルツル、予測不能にハチャメチャ全開な、氷上レースが始まった。",
      details:
        "アトラクション特徴: キッズにおすすめ、水に濡れる可能性あり\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は92cm以上\n所要時間: 約1分30秒\n定員: 4名(2名×2列)\nアトラクション利用基準: 安全バー、座席幅確認\nサポート: ウィッグ着用可、チャイルドスイッチ可、車イス可\nアトラクションタイプ: ライド・アトラクション\n25/11月の平均混雑時間: 晴れ42分、雨19分",
    },
    "ミニオン・ハチャメチャ・ライド": {
      overview:
        "かわいくておかしくて、大興奮。ハチャメチャ大騒動のど真ん中へ。ミニオンたちが巻き起こすハチャメチャ大騒動に、巨大ドームスクリーンに映し出された臨場映像で究極巻き込まれる、大興奮のライドに乗り込もう。",
      details:
        "アトラクションの特徴: キッズにおすすめ、絶叫/スリルいっぱい\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は102cm以上\n所要時間: 約25分\n定員: 8名(4名×2列)\nアトラクション利用基準: 安全バー、座席幅確認\nサポート: ウィッグ着用可、シングルライダー可、チャイルドスイッチ可、車イス可\nアトラクションタイプ: ライド・アトラクション\n25/11月の平均混雑時間: 晴れ57分、雨39分",
    },
    "マリオカート ~クッパの挑戦状~": {
      overview:
        "あのマリオカートの世界が、驚きいっぱいのコースの数々が、目の前に現れる。こうらを投げ、敵を撃退しながらマリオやピーチ姫とともに突き進め。パークならではの最新技術で叶う世界初のマリオカート体験に、ワクワクと興奮が止まらない。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は107cm以上\n所要時間: 約5分\n定員: 4名(2名×2列)\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、シングルライダー可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ100分、雨95分",
    },
    "ヨッシー・アドベンチャー": {
      overview:
        "ヨッシーと冒険の旅へ。ヨッシーの背中に乗り、キノピオ隊長を追って、お宝探しの冒険へ出発。隊長が忘れた地図を頼りに、あちこちに潜む3つのタマゴを見つけだそう。マウント・ビーンポールからキノコ王国をながめたり、かわいいあの子たちに出会ったり、楽しさいっぱい。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\nサービス: フォトサービス\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は92cm以上\n所要時間: 約5分\n定員: 2名(2名×1列)\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ72分、雨52分",
    },
    "キノピオカフェ": {
      overview:
        "キノピオハウスが、遊び心満載のハッピーなレストランに。とっても陽気ではたらき者なシェフキノピオが腕をふるう遊び心いっぱいの食事をめし上がれ。窓を覗いたら、キノコ王国の楽しい様子が見られるよ。",
      details:
        "特徴: 当日の状況により整理券を配布します。整理券は予定数に達し次第、配布を終了します\nサービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、洋食、サンドウィッチ・ハンバーガー、プラントベースメニュー、プレミアム アレルギーメニュー\n支払い方法: クレジットカード利用可\n営業時間: 09:00~21:00\n価格帯: ￥1000～￥2000",
    },
    "ピットストップ・ポップコーン": {
      overview:
        "白熱のカートレースを楽しんだら、ピットで元気を補給しよう。みんな大好き、おいしいポップコーン専門店。",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: スナック\n支払い方法: クレジットカード利用可\n営業時間: 08:30~21:30\n価格帯: ￥3000～",
    },
    "三本の箒": {
      overview:
        "ホグワーツ魔法魔術学校の先生や生徒たちもお気に入りの、ホグズミードの「老舗パブ兼宿屋」。ホグズミードにある三本の箒は、ホグワーツ魔法魔術学校の先生や生徒たちもお気に入りの「老舗パブ兼宿屋」です。驚くほど高い天井を見上げれば、木製の階段やバルコニーが無造作に入り混じる不思議な空間に、だれもが圧倒されることでしょう。",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、プラントベースメニュー\n支払い方法: クレジットカード利用可\n営業時間: 09:30~20:30\n価格帯: ￥2000～￥3000",
    },
    "オリバンダーの店": {
      overview:
        "「杖が魔法使いを選ぶ」様子を体験できます。無数の杖の箱が天井まで高く積み上げられた埃っぽい小さな店の中で、杖の番人と一緒に、「杖が魔法使いを選ぶ」様子を体験することができます。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\n身長制限: なし\n所要時間: 約10分\nアトラクションタイプ: ショー・アトラクション\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、妊娠中可、車イス可\n25/11月の平均混雑時間: 晴れ21分、雨17分",
    },
    "ハリー・ポッター・アンド・ザ・フォービドゥン・ジャーニー": {
      overview:
        "ハリー・ポッターと魔法の冒険へ。世界No.1ライドの栄誉を過去5年連続受賞、ハリー・ポッターの世界を全身で駆ける圧倒的体感ライドが、さらに進化。リアリティを極めた超臨場映像により、もはや3Dメガネは必要なし。さらにパワーアップした魔法の効果で、ドラゴンの炎が、ディメンターの冷気が、全身を直撃。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい\nサービス: フォトサービス\n身長制限: 122cm以上\n荷物の持ち込み禁止: ロッカーあり\n所要時間: 約5分\n定員: 4名\nサポート: ウィッグ着用可、シングルライダー可、チャイルドスイッチ可、車イス可\nアトラクションタイプ: ライド・アトラクション\n25/11月の平均混雑時間: 晴れ92分",
    },
    "フライト・オブ・ザ・ヒッポグリフ": {
      overview:
        "魔法界の生き物と空を翔けよう。魔法界の生き物であるヒッポグリフと空を翔けるこのライドは、家族でも楽しむことができるアトラクションです。ハグリッドからヒッポグリフへの正しい近づき方を教えてもらった後、飛行訓練を始めましょう。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい\n身長制限: 122cm以上および195cm以下\n付き添い者同伴の場合: 身長制限は92cm以上\n荷物の持ち込み禁止: ロッカーなし\n所要時間: 約2分\n定員: 16名\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\nサポート: チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ78分、雨46分",
    },
    "ハリウッド・ドリーム・ザ・ライド": {
      overview:
        "全身を突き抜けるスリル。空飛ぶような爽快コースターユニバーサル・スタジオ・ジャパンと世界屈指のコースターメーカーの独創性と最先端技術が集結した空飛ぶような爽快ライド。お気に入りのBGMをバックに、目の覚めるようなスリルが全身を突き抜ける。",
      details:
        "アトラクションの特徴: 絶叫/スリルいっぱい\n身長制限: 132cm以上\n付き添い者同伴の場合: 身長制限は132cm以上\n荷物の持ち込み禁止: ロッカーあり、金属探知機によるチェックあり\n所要時間: 約3分\n定員: 36名(4名×9列)\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\nサポート: シングルライダー可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ88分、雨54分",
    },
    "プレイング・ウィズおさるのジョージ": {
      overview:
        "LET'S GEORGE。～その顔、いただきっ。～かわいいジョージとワクワク遊ぼう。いつだって、なんだって、知りたいことばっかり。そんな好奇心いっぱいの愛らしい姿が世界中で人気の「おさるのジョージ」がアトラクションに。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\n身長制限: なし\n所要時間: 約20分\n定員: 300名(車イス、電動車イススペース2台)\nアトラクションタイプ: ショー・アトラクション\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、妊娠中可、車イス可",
    },
    "シング・オン・ツアー": {
      overview:
        "ホンモノ、来日。すべての生き物のみなさま。ついに、世界的ミュージカル・ショー「シング・オン・ツアー」が、ここイルミネーション・シアターで開幕。あの『SING』に登場した、すばらしいシンガーの「ホンモノ」たちが、おなじみの大ヒットナンバーを、パワフルかつソウルフルに目の前で大熱唱。",
      details:
        "アトラクションの特徴: キッズにおすすめ\n身長制限: なし\n所要時間: 約20分\n定員: 506名(車イス、電動車イススペース3台)\nアトラクションタイプ: ショー・アトラクション\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、妊娠中可、車イス可",
    },
    "スタジオ・スターズ・レストラン": {
      overview:
        "映画スタジオ内のカフェテリア。キッズもパパも、家族みんなが満足できる豊富なメニューに加え、ベビーフードの販売や席案内など、ママにうれしいサービスも満載。",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、洋食、ご飯類、離乳食あり、ノンポーク・ノンアルコール対応メニュー、プレミアムアレルゲンメニュー\n支払い方法: クレジットカード利用可\n営業時間: 09:00~21:00\n価格帯: ￥1000～￥2000",
    },
    "ビバリーヒルズ・ブランジェリー": {
      overview:
        "ビバリーヒルズの街角、フレンチスタイルのカフェで、サンドウィッチやスウィーツを",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: スウィーツ、サンドウィッチ・ハンバーガー、プラントベースメニュー\n支払い方法: クレジットカード利用可\n営業時間: 08:00~22:00\n価格帯: ￥1000～￥2000",
    },
    "ハローキティのコーナーカフェ": {
      overview: "とびきりキュートなフードが色々。",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: スウィーツ、スナック\n支払い方法: クレジットカード利用可\n営業時間: 08:00~22:00\n価格帯: ～￥1000",
    },
    "スヌーピー・バックロット・カフェ": {
      overview: "スヌーピーたちが集まるカフェ",
      details:
        "サービスタイプ: クイックサービス\n提供メニュー: 低アレルゲンメニュー、キッズメニュー、スウィーツ、麺類、パスタ、サンドウィッチ・ハンバーガー、離乳食あり\n支払い方法: クレジットカード利用可\n営業時間: 09:00~20:00\n価格帯: ￥1000～￥2000",
    },
    "ハローキティのリボン・コレクション": {
      overview:
        "ハローキティと一緒に記念撮影しよう。みんなのために、スタジオを開放してくれたハローキティ。最新ファッション・アイテムやハイヒールのすべり台で楽しんだら、キティと一緒に記念撮影。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\nサービス: フォトサービス\n推奨年齢: 3歳～6歳までのお子さま\n年齢制限: なし\n身長制限: なし\nアトラクションタイプ: プレイランド・その他\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、妊娠中可、車イス可\n25/11月の平均混雑時間: 晴れ44分、雨34分",
    },
    "エルモのゴーゴー・スケートボード": {
      overview:
        "エルモと一緒に斜面を縦横無尽に駆け抜けよう。エルモと一緒にスケートボードに乗って、斜面を爽快に駆け抜けよう。巨大なスケートボードの予測できないダイナミックな動きに子どもはワクワク、大人も思わず叫んじゃう。",
      details:
        "アトラクションの特徴: キッズにおすすめ、絶叫/スリルいっぱい\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は92cm以上\n所要時間: 約2分\n定員: 32名\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、シングルライダー可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ41分、雨17分",
    },
    "エルモのバブル・バブル": {
      overview:
        "小さなボートで水の上を巡ろう。エルモの夢の世界にようこそ。ペットの金魚ドロシーに乗って、水の上の小さな旅に出発。エルモが作るシャボン玉を見ながらゆったりクルージング。夢心地の屋内ライド・アトラクション。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる、水に濡れる可能性あり\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は92cm以上\n所要時間: 約3分\n定員: 2名\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ56分、雨37分",
    },
    "エルモのリトル・ドライブ": {
      overview:
        "3歳～5歳向けのゴーカート。3歳のキッズから運転を満喫できるライド・アトラクション。かわいいエルモのデザインの車で、周回コースをドライブしよう。",
      details:
        "アトラクションの特徴: キッズにおすすめ\n推奨年齢: 3歳～5歳までのお子さま(6歳の未就学児含む。大人不可)\n身長制限: なし\n所要時間: 約2分\n定員: 1名\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、車イス可\n25/11月の平均混雑時間: 晴れ22分、雨8分",
    },
    "ハローキティのカップケーキ・ドリーム": {
      overview:
        "くるくる回りながら、ハローキティのキュートな世界を楽しもう。ハローキティのケーキ・パーティにご招待。色とりどりに並んでいるカップケーキから、みんなはどれを選ぶかな。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限なし\n所要時間: 約2分\n定員: 5名\nアトラクション利用基準: 小さなお子さま一人で着席が必要\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ20分、雨6分",
    },
    "ビッグバードのビッグトップ・サーカス": {
      overview:
        "セサミストリートの世界を回るカラフルなメリーゴーラウンド。ビッグバードが、サーカスの団長に。団長の合図でぐるぐる回り出す、たくさんの動物たちの背中に乗って。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限なし\n所要時間: 約2分\n定員: 71名(乗り物は1名乗りです。4人乗りのシャリオットもあります。)\nアトラクションタイプ: ライド・アトラクション\nサポート: アシスティング・ドック同伴可、ウィッグ着用可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ26分、雨12分",
    },
    "フライング・スヌーピー": {
      overview:
        "上昇したり低空飛行したり、自分で操縦しながら、スヌーピーと一緒に空を飛ぼう。スヌーピーと一緒に空を飛ぼう。ピーナッツの仲間たちの周りを、自分で操縦して、上昇したり、低空飛行したり。高く舞い上がって、雲の上にいるようなフワフワ気分を味わって。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\nサービス: よやくのり\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は92cm以上\n所要時間: 約2分\n定員: 2名\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\nサポート: ウィッグ着用可、チャイルドスイッチ可、車イス可\n25/11月の平均混雑時間: 晴れ55分、雨25分",
    },
    "モッピーのバルーン・トリップ": {
      overview:
        "気球に乗ってワンダーランドの上空を旅しよう。モッピーがみんなを、楽しい気球の旅に招待してくれたよ。青い空に舞い上がり、眼下に広がるワンダーランドのキュートな世界を満喫。ハンドルを回せばゴンドラもクルクル、みんな一緒に大はしゃぎ。",
      details:
        "アトラクションの特徴: キッズにおすすめ、小さなお子さまと一緒に楽しめる\nサービス: よやくのり\n身長制限: 122cm以上\n付き添い者同伴の場合: 身長制限は92cm以上\n所要時間: 約2分\n定員: 4名\nアトラクション利用基準: 安全バー、座席幅確認\nアトラクションタイプ: ライド・アトラクション\n25/11月の平均混雑時間: 晴れ44分、雨19分",
    },
  };

  // 表示用カード一覧（全39枚）
  const [cards] = useState(allCards);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentCard = useMemo(() => cards[selectedIndex] ?? null, [cards, selectedIndex]);
  const [showAll, setShowAll] = useState(false);
  const [cardPreview, setCardPreview] = useState<typeof allCards[number] | null>(null);
  const [indexBeforeModal, setIndexBeforeModal] = useState<number>(0); // モーダルを開く前のインデックスを記憶

  // 画面の高さに合わせて全UIを縮小して収める（playと同様）
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const updateScale = () => {
      const h = window.innerHeight || 0;
      if (h < 720) setScale(0.85);
      else if (h < 820) setScale(0.9);
      else if (h < 900) setScale(0.95);
      else setScale(1);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // 条件・投票ボタン・ログ関連のUIと処理は削除（議論のみ）

  if (!currentCard) return null;

  return (
    <div className={styles.wrapper}>
      {/* 参加者リスト（右上） */}
      <div
        style={{
          position: "fixed",
          top: "12px",
          right: "12px",
          padding: "12px 16px",
          backgroundColor: "#fff",
          border: "2px solid #3b82f6",
          borderRadius: "8px",
          fontSize: "0.85rem",
          fontWeight: "bold",
          zIndex: 100,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          maxHeight: "calc(100vh - 24px)",
          overflowY: "auto",
        }}
      >
        <div style={{ color: "#3b82f6", marginBottom: "8px", fontSize: "0.9rem" }}>
          参加者
        </div>
        {participants.map((p) => (
          <div
            key={p.id}
            style={{
              color: "#374151",
              paddingLeft: "4px",
              marginBottom: "4px",
              whiteSpace: "nowrap",
            }}
          >
            ・{p.userName}
          </div>
        ))}
      </div>

      <div className={styles.mainCardSection} style={{ transform: `scale(${scale})` }}>
        <div className={styles.cardTitle}>{currentCard.title}</div>

        {/* メインコンテンツエリア */}
        <div className={styles.contentWrapper}>
          {/* 左側: カード画像 */}
          <div className={styles.cardContainer}>
            <div className={styles.largeCard} onClick={() => setCardPreview(currentCard)}>
              <img src={currentCard.frontSrc} alt={currentCard.title} />

              {/* 拡大アイコン */}
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  width: 36,
                  height: 36,
                  backgroundColor: "rgba(59, 130, 246, 0.9)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setCardPreview(currentCard);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 20, height: 20 }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </div>
            </div>
          </div>

          {/* 右側: 概要/詳細 */}
          <div className={styles.infoPanel}>
            <div className={styles.infoSection}>
              <h3 className={styles.infoTitle}>概要</h3>
              <div className={styles.infoContent} style={{ textAlign: "left" }}>
                {cardInfo[currentCard.title]?.overview
                  ? cardInfo[currentCard.title].overview
                      .split(/(。|  +)/)
                      .filter((s) => s && s !== "。" && !/^  +$/.test(s))
                      .map((line, i) => (
                        <React.Fragment key={i}>
                          {line}
                          <br />
                        </React.Fragment>
                      ))
                  : ""}
              </div>
            </div>
            <div className={styles.infoSection}>
              <h3 className={styles.infoTitle}>詳細</h3>
              <div className={styles.infoContent} style={{ whiteSpace: "pre-line", textAlign: "left" }}>
                {cardInfo[currentCard.title]?.details || ""}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 横スクロール可能なカード一覧 */}
      <div className={styles.cardScrollContainer}>
        <div className={styles.cardScrollWrapper}>
          {cards.map((card, index) => (
            <div
              key={card.id}
              className={`${styles.scrollCard} ${index === selectedIndex ? styles.scrollCardSelected : ""}`}
              onClick={() => {
                setSelectedIndex(index);
              }}
            >
              <img src={card.frontSrc} alt={card.title} />
              <div className={styles.scrollCardTitle}>{card.title}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 「すべて見る」ボタン */}
      <div style={{ textAlign: 'center', margin: '20px 0' }}>
        <button
          onClick={() => {
            setIndexBeforeModal(selectedIndex);
            setShowAll(true);
          }}
          style={{
            padding: '12px 32px',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
          }}
        >
          すべて見る
        </button>
      </div>
      {showAll && (
        <div className={styles.modalOverlay} onClick={() => {
          setSelectedIndex(indexBeforeModal); // 元のインデックスに戻す
          setShowAll(false);
        }}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            {cards.map((c, i) => (
              <div
                key={c.id}
                className={styles.modalCard}
                onClick={() => {
                  setSelectedIndex(i);
                  setShowAll(false);
                }}
              >
                <img src={c.frontSrc} alt={c.title} />
                <div className={styles.modalCardTitle}>{c.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* カードプレビューモーダル（表裏並べて表示） */}
      {cardPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: "20px",
          }}
          onClick={() => setCardPreview(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "90vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                color: "#fff",
                textAlign: "center",
                textShadow: "0 2px 8px rgba(0,0,0,0.5)",
              }}
            >
              {cardPreview.title}
            </div>

            <div
              style={{
                display: "flex",
                gap: "20px",
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "flex-start",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: "600",
                    color: "#fff",
                    marginBottom: "8px",
                    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
                  }}
                >
                  表
                </div>
                <img
                  src={cardPreview.frontSrc}
                  alt={`${cardPreview.title} - 表`}
                  style={{
                    width: "auto",
                    maxWidth: "350px",
                    maxHeight: "60vh",
                    height: "auto",
                    borderRadius: "12px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  }}
                />
              </div>

              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: "600",
                    color: "#fff",
                    marginBottom: "8px",
                    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
                  }}
                >
                  裏
                </div>
                <img
                  src={cardPreview.backSrc}
                  alt={`${cardPreview.title} - 裏`}
                  style={{
                    width: "auto",
                    maxWidth: "350px",
                    maxHeight: "60vh",
                    height: "auto",
                    borderRadius: "12px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  }}
                />
              </div>
            </div>

            <button
              onClick={() => setCardPreview(null)}
              style={{
                padding: "12px 32px",
                fontSize: "1rem",
                fontWeight: "bold",
                backgroundColor: "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* マップボタン＆ノート */}
      <MapButton />
      <NoteWindow currentPage="discussion" />
    </div>
  );
}
