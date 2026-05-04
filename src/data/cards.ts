export type CardData = {
  id: number;
  title: string;
  frontSrc: string;  // 表面
  backSrc: string;   // 裏面
};

export const ACTIVE_CARD_IDS = [
  1, 3, 8, 9, 10, 16, 17, 18, 23, 25,
] as const;

const ACTIVE_CARD_ID_SET: ReadonlySet<number> = new Set<number>(ACTIVE_CARD_IDS);

export const isActiveCardId = (id: number): boolean => ACTIVE_CARD_ID_SET.has(id);

const cardTitles = [
  "ジョーズ",
  "アミティ・ボードウォーク・ゲーム",
  "ウォーターワールド",
  "ザ・ドラゴン・パール",
  "ロンバーズ・ランディング",
  "ロストワールド・レストラン",
  "ジュラシック・パーク・ダイナソー・ミート&グリート",
  "ザ・フライング・ダイナソー",
  "名探偵コナン 4-D ライブ・ショー ~星空の宝石(ジュエル)~",
  "クロミ・ライブ",
  "パークサイド・グリル",
  "SAIDO",
  "デリシャス・ミー！ザ・クッキー・キッチン",
  "スペース・キラー",
  "ミニオン・ハチャメチャ・アイス",
  "ミニオン・ハチャメチャ・ライド",
  "マリオカート ~クッパの挑戦状~",
  "ヨッシー・アドベンチャー",
  "キノピオカフェ",
  "ピットストップ・ポップコーン",
  "三本の箒",
  "オリバンダーの店",
  "ハリー・ポッター・アンド・ザ・フォービドゥン・ジャーニー",
  "フライト・オブ・ザ・ヒッポグリフ",
  "ハリウッド・ドリーム・ザ・ライド",
  "プレイング・ウィズおさるのジョージ",
  "シング・オン・ツアー",
  "スタジオ・スターズ・レストラン",
  "ビバリーヒルズ・ブランジェリー",
  "ハローキティのコーナーカフェ",
  "スヌーピー・バックロット・カフェ",
  "ハローキティのリボン・コレクション",
  "エルモのゴーゴー・スケートボード",
  "エルモのバブル・バブル",
  "エルモのリトル・ドライブ",
  "ハローキティのカップケーキ・ドリーム",
  "ビッグバードのビッグトップ・サーカス",
  "フライング・スヌーピー",
  "モッピーのバルーン・トリップ",
];

export const cards: CardData[] = Array.from({ length: 39 }, (_, i) => {
  const id = i + 1;
  return {
    id,
    title: cardTitles[i],
    frontSrc: `/pngs/USJ_${id}_surface-1.png`,
    backSrc: `/pngs/back/USJ_${id}_back-1.png`,
  };
});

// 今後のゲームで使用するカード（選定済み）
export const activeCards: CardData[] = cards.filter((c) => isActiveCardId(c.id));
